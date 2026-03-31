import { embed } from '../lib/embedding'
import { ensureCollection, upsert, search } from '../lib/qdrant'

interface MemoryEnv {
  GEMINI_API_KEY: string
  QDRANT_URL: string
  QDRANT_API_KEY: string
}

// 召回与当前消息语义相关的历史记忆，注入 system prompt
export async function recall(env: MemoryEnv, userId: string, query: string): Promise<string> {
  try {
    const vector = await embed(env.GEMINI_API_KEY, query)
    const memories = await search(env.QDRANT_URL, env.QDRANT_API_KEY, userId, vector)
    if (memories.length === 0) return ''
    return `\n\n【历史记忆】以下是从记忆库中检索到的真实对话片段，你只能依据这些内容回答，不得推断或编造未出现的信息：\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
  } catch {
    return ''
  }
}

// 将本轮对话摘要存入向量库（非阻塞，调用方用 waitUntil 包裹）
export async function remember(env: MemoryEnv, userId: string, userMsg: string, aiReply: string): Promise<void> {
  try {
    const content = `用户：${userMsg}\n助手：${aiReply}`.slice(0, 800)
    const [vector] = await Promise.all([embed(env.GEMINI_API_KEY, content)])
    await ensureCollection(env.QDRANT_URL, env.QDRANT_API_KEY)
    await upsert(env.QDRANT_URL, env.QDRANT_API_KEY, crypto.randomUUID(), userId, content, vector)
  } catch (e) {
    console.error('[memory] remember failed:', e)
  }
}
