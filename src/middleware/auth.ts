import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import type { Bindings } from '../index'

export type AuthVariables = { userId: string }

export const authMiddleware = createMiddleware<{
  Bindings: Bindings
  Variables: AuthVariables
}>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer '))
    return c.json({ error: '未授权' }, 401)

  try {
    const payload = await verify(header.slice(7), c.env.JWT_SECRET, 'HS256')
    if (typeof payload.userId !== 'string') return c.json({ error: 'token 无效' }, 401)
    c.set('userId', payload.userId)
    return await next()
  } catch (e) {
    console.error('[auth] verify failed:', e instanceof Error ? e.message : e)
    return c.json({ error: 'token 无效或已过期' }, 401)
  }
})
