import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import userRoutes from './routes/user'
import chatRoutes from './routes/chat'
import adminRoutes from './routes/admin'

export type Bindings = {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  GEMINI_API_KEY: string
  SERPER_API_KEY: string
  QDRANT_URL: string
  QDRANT_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }))


app.route('/auth', authRoutes)
app.route('/user', userRoutes)
app.route('/chat', chatRoutes)
app.route('/admin', adminRoutes)

// Routes（后续各阶段逐步挂载）
// app.route('/tasks', taskRoutes)

export default app
