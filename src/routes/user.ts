import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth'
import type { Bindings } from '../index'

type Profile = { name: string | null; email: string | null; aiNickname: string | null }

const user = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

user.use('*', authMiddleware)

user.get('/profile', async (c) => {
  const userId = c.get('userId')
  const row = await c.env.DB.prepare(`
    SELECT u.name, u.email, a.nickname AS aiNickname
    FROM users u
    LEFT JOIN ai_config a ON a.user_id = u.user_id
    WHERE u.user_id = ?
  `).bind(userId).first<Profile>()
  return c.json(row ?? { name: null, email: null, aiNickname: null })
})

user.put('/profile', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<Partial<{ name: string; email: string; aiNickname: string }>>()

  if (body.name !== undefined || body.email !== undefined) {
    const fields: string[] = []
    const values: unknown[] = []
    if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name) }
    if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email) }
    values.push(userId)
    await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`)
      .bind(...values).run()
  }

  if (body.aiNickname !== undefined) {
    await c.env.DB.prepare(`
      INSERT INTO ai_config (user_id, nickname) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname
    `).bind(userId, body.aiNickname).run()
  }

  return c.json({ ok: true })
})

export default user
