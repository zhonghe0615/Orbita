import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth'
import type { Bindings } from '../index'

const SUPERADMIN = 'superadmin'

const admin = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

admin.use('*', authMiddleware)

admin.use('*', async (c, next) => {
  if (c.get('userId') !== SUPERADMIN) return c.json({ error: '权限不足' }, 403)
  await next()
})

// 所有用户列表
admin.get('/users', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT user_id, name, email, created_at, last_login FROM users ORDER BY created_at DESC'
  ).all<{ user_id: string; name: string | null; email: string | null; created_at: string; last_login: string | null }>()
  return c.json(rows.results)
})

// 指定用户的 profile
admin.get('/users/:userId/profile', async (c) => {
  const target = c.req.param('userId')
  const row = await c.env.DB.prepare(`
    SELECT u.user_id, u.name, u.email, u.created_at, u.last_login, a.nickname AS aiNickname
    FROM users u LEFT JOIN ai_config a ON a.user_id = u.user_id
    WHERE u.user_id = ?
  `).bind(target).first()
  if (!row) return c.json({ error: '用户不存在' }, 404)
  return c.json(row)
})

// 指定用户的任务列表
admin.get('/users/:userId/tasks', async (c) => {
  const target = c.req.param('userId')
  const rows = await c.env.DB.prepare(
    'SELECT id, title, description, status, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(target).all()
  return c.json(rows.results)
})

// 指定用户的消息历史
admin.get('/users/:userId/messages', async (c) => {
  const target = c.req.param('userId')
  const limit = Number(c.req.query('limit') ?? 50)
  const rows = await c.env.DB.prepare(
    'SELECT role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(target, limit).all()
  return c.json(rows.results)
})

export default admin
