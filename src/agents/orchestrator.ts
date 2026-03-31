import { geminiJson, type Message } from '../lib/gemini'
import { executeTool, STATUS_LABEL } from '../tools/tasks'
import { serperSearch } from '../tools/search'
import { deepResearch } from './researcher'

interface OrchestratorResponse {
  action: Action | null
  reply: string
}

interface Action {
  type: 'create_task' | 'list_tasks' | 'get_task' | 'update_task' | 'delete_task'
       | 'web_search' | 'deep_research'
       | 'admin_list_users' | 'admin_get_user' | 'admin_get_user_tasks' | 'admin_get_user_messages'
  // task fields
  title?: string
  description?: string
  status?: string
  id?: number
  // search fields
  query?: string
  // admin fields
  target_user_id?: string
}

interface Task {
  id: number
  title: string
  description: string | null
  status: string
  created_at: string
  updated_at: string | null
}

const ADMIN_SCHEMA = `
【超级管理员专属操作】
- 列出所有用户: {"type":"admin_list_users"}
- 查看指定用户详情: {"type":"admin_get_user","target_user_id":"..."}
- 查看指定用户的任务: {"type":"admin_get_user_tasks","target_user_id":"..."}
- 查看指定用户的消息历史: {"type":"admin_get_user_messages","target_user_id":"..."}
`

const ACTION_SCHEMA = `
你必须严格以 JSON 格式回复，结构如下：
{"action": <操作对象或null>, "reply": "<对用户的自然语言回复>"}

支持的操作类型：
- 创建任务: {"type":"create_task","title":"...","description":"...（可选）"}
- 列出任务: {"type":"list_tasks","status":"all|todo|in_progress|done|cancelled"}
- 查看单个任务: {"type":"get_task","id":<数字>}
- 更新任务: {"type":"update_task","id":<数字>,"title":"...","description":"...","status":"todo|in_progress|done|cancelled"}
- 删除任务: {"type":"delete_task","id":<数字>}
- 网络搜索: {"type":"web_search","query":"..."}（只要用户提到：搜索、查一下、查找、公开资料、最新信息、是什么、怎么样、有什么等，均应使用此操作）
- 深度研究: {"type":"deep_research","query":"..."}（用户提到：深度研究、详细分析、写报告、综合分析、全面了解等，使用此操作）
- 无需操作: null（仅限任务管理操作或纯闲聊）

重要规则：当用户提及"公开资料"、"资料"、"搜索"、"查"、"最新"、"研究"等关键词，必须使用 web_search 或 deep_research，不得直接凭已有知识回答。

reply 字段必须始终包含对用户的友好回复。
list_tasks 时 reply 只写一句概述（如"为你找到 3 条任务"），不要在 reply 里列出任务详情，任务列表由系统渲染。
get_task 时 reply 只写一句"为你找到任务详情"，详情由系统渲染。
歧义与确认规则（重要）：
- 若用户描述的任务无法唯一确定（如关键词模糊、可能匹配多条），必须返回 action:null，在 reply 中列出候选任务或请用户提供 ID/更精确描述
- 只有在能唯一确定目标任务时，才执行 update_task 或 delete_task
- 删除和修改操作均需二次确认：若用户未明确说"确认"，先返回 get_task 展示任务详情，reply 中说明将要执行的操作并询问"确认吗？"；等用户确认后再执行 delete_task 或 update_task
- 多个不同 ID 的写操作必须逐轮处理：每轮只处理一个任务（展示→确认→执行），用户确认第一个后，再进入下一个任务的展示+确认流程，不得在同一轮中顺带执行其他任务
- 例外：用户明确说明是批量操作（如"把所有待办标为完成"）时，可合并为一次执行，无需逐条确认
只输出合法 JSON，不加 markdown 代码块。
`

async function handleAdminAction(action: Action, db: D1Database, reply: string): Promise<string> {
  switch (action.type) {
    case 'admin_list_users': {
      const rows = await db.prepare(
        'SELECT user_id, name, email, created_at, last_login FROM users ORDER BY created_at DESC'
      ).all<{ user_id: string; name: string | null; email: string | null; created_at: string; last_login: string | null }>()
      if (rows.results.length === 0) return '系统中暂无用户。'
      const lines = rows.results.map(u =>
        `| ${u.user_id} | ${u.name ?? '—'} | ${u.email ?? '—'} | ${toCST(u.created_at)} | ${u.last_login ? toCST(u.last_login) : '从未'} |`
      ).join('\n')
      return `${reply}\n\n| 用户ID | 姓名 | 邮箱 | 注册时间 | 最后登录 |\n|---|---|---|---|---|\n${lines}`
    }
    case 'admin_get_user': {
      const t = action.target_user_id
      if (!t) return '请指定用户 ID。'
      const row = await db.prepare(
        'SELECT u.user_id, u.name, u.email, u.created_at, u.last_login, a.nickname FROM users u LEFT JOIN ai_config a ON a.user_id = u.user_id WHERE u.user_id = ?'
      ).bind(t).first<{ user_id: string; name: string | null; email: string | null; created_at: string; last_login: string | null; nickname: string | null }>()
      if (!row) return `找不到用户 ${t}。`
      return `**用户详情**\n- ID：${row.user_id}\n- 姓名：${row.name ?? '未设置'}\n- 邮箱：${row.email ?? '未设置'}\n- AI昵称：${row.nickname ?? 'Orbita'}\n- 注册时间：${toCST(row.created_at)}\n- 最后登录：${row.last_login ? toCST(row.last_login) : '从未'}`
    }
    case 'admin_get_user_tasks': {
      const t = action.target_user_id
      if (!t) return '请指定用户 ID。'
      const rows = await db.prepare(
        'SELECT id, title, description, status, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC'
      ).bind(t).all<Task>()
      return `${reply}\n\n${formatTaskTable(rows.results)}`
    }
    case 'admin_get_user_messages': {
      const t = action.target_user_id
      if (!t) return '请指定用户 ID。'
      const rows = await db.prepare(
        'SELECT role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
      ).bind(t).all<{ role: string; content: string; created_at: string }>()
      if (rows.results.length === 0) return `用户 ${t} 暂无消息记录。`
      const lines = rows.results.reverse().map(m =>
        `**[${m.role === 'user' ? '用户' : 'AI'}]** ${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}`
      ).join('\n\n')
      return `${reply}\n\n${lines}`
    }
    default:
      return reply
  }
}

function toCST(s: string): string {
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z')
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16)
}

function formatTaskTable(tasks: Task[]): string {
  if (tasks.length === 0) return '目前没有任务。'
  const fmt = toCST
  const rows = tasks.map(t =>
    `| ${t.id} | ${t.title} | ${STATUS_LABEL[t.status] ?? t.status} | ${t.description ?? '—'} | ${fmt(t.created_at)} | ${t.updated_at ? fmt(t.updated_at) : '—'} |`
  ).join('\n')
  return `| ID | 任务 | 状态 | 描述 | 创建时间 | 更新时间 |\n|---|---|---|---|---|---|\n${rows}`
}

export async function orchestrate(
  apiKey: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  db: D1Database,
  userId: string,
  serperApiKey: string | undefined,
  userContext?: string,
): Promise<string> {
  const schema = userId === 'superadmin' ? `${ACTION_SCHEMA}${ADMIN_SCHEMA}` : ACTION_SCHEMA
  const { action, reply } = await geminiJson<OrchestratorResponse>(
    apiKey,
    `${systemPrompt}\n\n${schema}`,
    history,
    userMessage,
  )

  if (!action || !action.type) return reply

  // 搜索 / 深度研究
  if (action.type === 'web_search' || action.type === 'deep_research') {
    if (!action.query) return reply
    if (!serperApiKey) return `搜索功能未配置（缺少 SERPER_API_KEY）。`
    try {
      if (action.type === 'web_search') {
        const results = await serperSearch(serperApiKey, action.query)
        return `${reply}\n\n${results}`
      } else {
        return await deepResearch(apiKey, serperApiKey, action.query, userContext)
      }
    } catch (e) {
      return `搜索失败：${e instanceof Error ? e.message : '未知错误'}`
    }
  }

  // 管理员操作（仅 superadmin）
  if (action.type.startsWith('admin_')) {
    if (userId !== 'superadmin') return '权限不足。'
    return await handleAdminAction(action, db, reply)
  }

  // 后端保障：update/delete 必须有明确 ID，且任务必须存在
  if (action.type === 'update_task' || action.type === 'delete_task') {
    if (!action.id) {
      return `我无法确定你指的是哪个任务，请提供任务 ID，或者先说"列出任务"查看列表。`
    }
    const task = await db
      .prepare('SELECT id, title FROM tasks WHERE id = ? AND user_id = ?')
      .bind(action.id, userId)
      .first<{ id: number; title: string }>()
    if (!task) {
      return `找不到 ID 为 ${action.id} 的任务，请确认后重试。`
    }
  }

  const result = await executeTool(
    { name: action.type, args: action as unknown as Record<string, unknown> },
    db,
    userId,
  ) as Record<string, unknown>

  if (action.type === 'list_tasks') {
    const tasks = (result.tasks ?? []) as Task[]
    return `${reply}\n\n${formatTaskTable(tasks)}`
  }

  if (action.type === 'get_task') {
    const task = result.task as Task | null
    if (!task) return `找不到 ID 为 ${action.id} 的任务。`
    return `${reply}\n\n${formatTaskTable([task])}`
  }

  return reply
}
