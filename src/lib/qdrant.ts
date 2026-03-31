const COLLECTION = 'orbita_memories'

import { EMBEDDING_DIM } from './embedding'

async function request(url: string, apiKey: string, path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export async function ensureCollection(url: string, apiKey: string): Promise<void> {
  const res = await request(url, apiKey, `/collections/${COLLECTION}`, 'GET')
  if (res.status === 200) return
  await request(url, apiKey, `/collections/${COLLECTION}`, 'PUT', {
    vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
  })
  await request(url, apiKey, `/collections/${COLLECTION}/index`, 'PUT', {
    field_name: 'user_id', field_schema: 'keyword',
  })
}

export async function upsert(
  url: string, apiKey: string,
  id: string, userId: string, content: string, vector: number[],
): Promise<void> {
  await request(url, apiKey, `/collections/${COLLECTION}/points`, 'PUT', {
    points: [{ id, vector, payload: { user_id: userId, content, created_at: new Date().toISOString() } }],
  })
}

export async function search(
  url: string, apiKey: string,
  userId: string, vector: number[], topK = 3,
): Promise<string[]> {
  const res = await request(url, apiKey, `/collections/${COLLECTION}/points/search`, 'POST', {
    vector,
    filter: { must: [{ key: 'user_id', match: { value: userId } }] },
    limit: topK,
    with_payload: true,
  })
  if (!res.ok) return []
  const data = await res.json() as { result: { payload: { content: string }; score: number }[] }
  return data.result
    .filter(r => r.score > 0.6)
    .map(r => r.payload.content)
}
