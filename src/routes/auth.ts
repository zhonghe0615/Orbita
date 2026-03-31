import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { hashPassword, verifyPassword } from '../lib/crypto'
import type { Bindings } from '../index'

const auth = new Hono<{ Bindings: Bindings }>()

const USER_ID_RE = /^[a-zA-Z0-9]{6,}$/
const PASSWORD_RE = /^[\w!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]{6,}$/

auth.post('/register', async (c) => {
  const { userId, password } = await c.req.json<{ userId: string; password: string }>()

  if (!USER_ID_RE.test(userId))
    return c.json({ error: 'userID 需至少6位字母或数字' }, 400)
  if (!PASSWORD_RE.test(password))
    return c.json({ error: '密码需至少6位，可含字母、数字或特殊符号' }, 400)

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE user_id = ?')
    .bind(userId)
    .first()
  if (exists) return c.json({ error: '该 userID 已被占用' }, 409)

  const passwordHash = await hashPassword(password)
  await c.env.DB.prepare('INSERT INTO users (user_id, password_hash) VALUES (?, ?)')
    .bind(userId, passwordHash)
    .run()

  const token = await sign({ userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, c.env.JWT_SECRET, 'HS256')
  return c.json({ token })
})

auth.post('/login', async (c) => {
  const { userId, password } = await c.req.json<{ userId: string; password: string }>()

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE user_id = ?')
    .bind(userId)
    .first<{ password_hash: string }>()
  if (!user) return c.json({ error: 'userID 或密码错误' }, 401)

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) return c.json({ error: 'userID 或密码错误' }, 401)

  await c.env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?')
    .bind(userId).run()
  const token = await sign({ userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, c.env.JWT_SECRET, 'HS256')
  return c.json({ token })
})

export default auth
