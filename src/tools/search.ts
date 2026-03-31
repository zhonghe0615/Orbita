interface SerperResponse {
  organic: { title: string; link: string; snippet: string }[]
  answerBox?: { answer?: string; snippet?: string; title?: string }
  knowledgeGraph?: { description?: string }
}

export async function serperSearch(apiKey: string, query: string, num = 5): Promise<string> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num, hl: 'zh-cn' }),
  })
  if (!res.ok) throw new Error(`Serper API ${res.status}`)
  const data = await res.json() as SerperResponse

  const lines: string[] = []

  const ab = data.answerBox
  if (ab?.answer || ab?.snippet) {
    lines.push(`**直接答案：** ${ab.answer ?? ab.snippet}`)
  }
  if (data.knowledgeGraph?.description) {
    lines.push(`**知识图谱：** ${data.knowledgeGraph.description}`)
  }

  data.organic.slice(0, num).forEach((r, i) => {
    lines.push(`${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.link}`)
  })

  return lines.join('\n\n') || '未找到相关结果'
}
