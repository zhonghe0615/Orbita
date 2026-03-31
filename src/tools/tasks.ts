import type { FunctionDeclaration, FunctionCall } from '../lib/gemini'

export const STATUS_LABEL: Record<string, string> = {
  todo: '待办', in_progress: '进行中', done: '已完成', cancelled: '已取消',
}

export const taskFunctions: FunctionDeclaration[] = [
  {
    name: 'create_task',
    description: '创建一个新任务',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务详细描述（可选）' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: '列出用户的任务列表',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '按状态过滤', enum: ['all', 'todo', 'in_progress', 'done', 'cancelled'] },
      },
    },
  },
  {
    name: 'update_task',
    description: '更新任务的标题、描述或状态',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '任务ID' },
        title: { type: 'string', description: '新标题' },
        description: { type: 'string', description: '新描述' },
        status: { type: 'string', description: '新状态', enum: ['todo', 'in_progress', 'done', 'cancelled'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_task',
    description: '查看单个任务的详细信息',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '任务ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: '删除指定任务',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '任务ID' },
      },
      required: ['id'],
    },
  },
]

interface Task {
  id: number
  title: string
  description: string | null
  status: string
  created_at: string
}

export async function executeTool(
  fc: FunctionCall,
  db: D1Database,
  userId: string,
): Promise<unknown> {
  const { name, args } = fc

  switch (name) {
    case 'create_task': {
      const { title, description } = args as { title: string; description?: string }
      const task = await db
        .prepare('INSERT INTO tasks (user_id, title, description) VALUES (?, ?, ?) RETURNING id, title, description, status, created_at')
        .bind(userId, title, description ?? null)
        .first<Task>()
      return { success: true, task }
    }

    case 'list_tasks': {
      const { status = 'all' } = args as { status?: string }
      const stmt = status === 'all'
        ? db.prepare('SELECT id, title, description, status, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC').bind(userId)
        : db.prepare('SELECT id, title, description, status, created_at, updated_at FROM tasks WHERE user_id = ? AND status = ? ORDER BY created_at DESC').bind(userId, status)
      const res = await stmt.all<Task>()
      return { success: true, tasks: res.results, count: res.results.length }
    }

    case 'update_task': {
      const { id, title, description, status } = args as { id: number; title?: string; description?: string; status?: string }
      const sets: string[] = ['updated_at = CURRENT_TIMESTAMP']
      const vals: unknown[] = []
      if (title !== undefined) { sets.push('title = ?'); vals.push(title) }
      if (description !== undefined) { sets.push('description = ?'); vals.push(description) }
      if (status !== undefined) { sets.push('status = ?'); vals.push(status) }
      vals.push(id, userId)
      await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals).run()
      return { success: true }
    }

    case 'get_task': {
      const { id } = args as { id: number }
      const task = await db
        .prepare('SELECT id, title, description, status, created_at, updated_at FROM tasks WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .first<Task>()
      return { success: !!task, task: task ?? null }
    }

    case 'delete_task': {
      const { id } = args as { id: number }
      await db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, userId).run()
      return { success: true }
    }

    default:
      return { success: false, error: `未知工具: ${name}` }
  }
}
