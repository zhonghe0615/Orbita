const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIM = 3072

export { EMBEDDING_DIM }

export async function embed(apiKey: string, text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: text.slice(0, 2000) }] },
      }),
    },
  )
  if (!res.ok) throw new Error(`Embedding API ${res.status}`)
  const data = await res.json() as { embedding: { values: number[] } }
  return data.embedding.values
}
