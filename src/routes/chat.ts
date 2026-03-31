import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth'
import { type Message } from '../lib/gemini'
import { orchestrate } from '../agents/orchestrator'
import { recall, remember } from '../agents/memory'
import { STATUS_LABEL } from '../tools/tasks'
import type { Bindings } from '../index'

const chat = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

chat.use('*', authMiddleware)

const SESSION_MAX = 10   // KV 中保留的最大消息条数
const SESSION_TTL = 86400 // 24h

chat.get('/history', async (c) => {
  const userId = c.get('userId')
  const rows = await c.env.DB.prepare(
    'SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100'
  ).bind(userId).all<{ role: string; content: string }>()
  return c.json(rows.results)
})

chat.post('/', async (c) => {
  const userId = c.get('userId')
  const { message } = await c.req.json<{ message: string }>()
  if (!message?.trim()) return c.json({ error: '消息不能为空' }, 400)

  // 1. 并行拉取 profile、对话历史、任务列表
  const sessionKey = `session:${userId}`
  const [profile, raw, taskRows] = await Promise.all([
    c.env.DB.prepare(`
      SELECT u.name, u.email, a.nickname AS aiNickname
      FROM users u LEFT JOIN ai_config a ON a.user_id = u.user_id
      WHERE u.user_id = ?
    `).bind(userId).first<{ name: string | null; email: string | null; aiNickname: string | null }>(),
    c.env.KV.get(sessionKey),
    c.env.DB.prepare(
      'SELECT id, title, description, status FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'
    ).bind(userId).all<{ id: number; title: string; description: string | null; status: string }>(),
  ])

  const userName = profile?.name ?? userId
  const aiNickname = profile?.aiNickname ?? 'Orbita'

  // 2. 构建 system prompt（含任务快照）
  const userEmail = profile?.email ?? null
  const systemPrompt = buildSystemPrompt(aiNickname, userName, userEmail, taskRows.results)

  // 3. 解析对话历史：KV 命中直接用；KV miss 则从 D1 重建并回填
  let history: Message[]
  if (raw) {
    try { history = JSON.parse(raw) as Message[] } catch { history = [] }
  } else {
    const recent = await c.env.DB.prepare(
      'SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(userId, SESSION_MAX).all<{ role: string; content: string }>()
    history = recent.results.reverse().map(m => ({
      role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: m.content }] as [{ text: string }],
    }))
    if (history.length > 0) {
      await c.env.KV.put(sessionKey, JSON.stringify(history), { expirationTtl: SESSION_TTL })
    }
  }

  // 4. 召回语义记忆 + 调用 Orchestrator
  // prompt 结构：system（含任务快照）→ 语义记忆（可选）
  const memoryCtx = await recall(c.env, userId, message)
  const promptWithMemory = memoryCtx ? `${systemPrompt}${memoryCtx}` : systemPrompt

  let reply: string
  try {
    reply = await orchestrate(c.env.GEMINI_API_KEY, promptWithMemory, history, message, c.env.DB, userId, c.env.SERPER_API_KEY, systemPrompt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误'
    return c.json({ error: `AI 服务异常：${msg}` }, 502)
  }

  // 异步保存本轮对话到向量库（不阻塞响应）
  c.executionCtx.waitUntil(remember(c.env, userId, message, reply))

  // 5. 更新 KV 历史（截断到最近 SESSION_MAX 条，剥掉链接减少 token）
  const updated: Message[] = [
    ...history,
    { role: 'user' as const, parts: [{ text: message }] as [{ text: string }] },
    { role: 'model' as const, parts: [{ text: stripLinks(reply) }] as [{ text: string }] },
  ].slice(-SESSION_MAX)
  await c.env.KV.put(sessionKey, JSON.stringify(updated), { expirationTtl: SESSION_TTL })

  // 6. 持久化到 D1（用于历史消息渲染）
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)')
      .bind(userId, 'user', message),
    c.env.DB.prepare('INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)')
      .bind(userId, 'assistant', reply),
  ])

  return c.json({ reply })
})

function stripLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
}

const TASK_CONTEXT_BUDGET = 800  // chars

function buildTaskContext(tasks: { id: number; title: string; description: string | null; status: string }[]): string {
  const lines: string[] = []
  let budget = TASK_CONTEXT_BUDGET
  for (const t of tasks) {
    const status = STATUS_LABEL[t.status] ?? t.status
    const desc = t.description ? '：' + t.description.slice(0, 60) + (t.description.length > 60 ? '…' : '') : ''
    const line = `- [ID:${t.id}] ${t.title}（${status}）${desc}`
    if (budget - line.length < 0) {
      lines.push(`（还有 ${tasks.length - lines.length} 条任务未显示，可说"列出任务"查看全部）`)
      break
    }
    lines.push(line)
    budget -= line.length
  }
  return lines.join('\n')
}

function buildSystemPrompt(
  aiNickname: string,
  userName: string,
  userEmail: string | null,
  tasks: { id: number; title: string; description: string | null; status: string }[],
): string {
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  const emailLine = userEmail ? `\n用户邮箱：${userEmail}` : ''
  const tasksLine = tasks.length > 0
    ? `\n\n【用户当前任务列表】\n${buildTaskContext(tasks)}`
    : ''
  return `你是 ${aiNickname}，一个智能助手。
当前用户是 ${userName}，今天是 ${today}。${emailLine}

你的能力：
- 帮助用户管理任务列表（增删改查）
- 进行网络搜索和深度研究
- 记住用户的偏好和重要信息${tasksLine}

请用友好、简洁的中文回答。如果用户用其他语言提问，跟随用户语言回复。`
}

export default chat
