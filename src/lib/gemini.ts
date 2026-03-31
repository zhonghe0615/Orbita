const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
export const CHAT_MODEL = 'gemini-3.1-flash-lite-preview'
export const TOOL_MODEL = 'gemini-3.1-flash-lite-preview'

export interface Message {
  role: 'user' | 'model'
  parts: [{ text: string }]
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required?: string[]
  }
}

export interface FunctionCall {
  name: string
  args: Record<string, unknown>
}

interface GeminiPart {
  text?: string
  thoughtSignature?: string
  functionCall?: FunctionCall
}

interface GeminiResponse {
  candidates: Array<{ content: { parts: GeminiPart[] } }>
  error?: { message: string }
}

async function generate(
  apiKey: string,
  model: string,
  systemPrompt: string,
  contents: unknown[],
  tools?: FunctionDeclaration[],
  thinkingBudget = 0,
  maxOutputTokens = 2048,
): Promise<GeminiPart[]> {
  if (!apiKey) throw new Error('GEMINI_API_KEY 未配置')

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens, thinkingConfig: { thinkingBudget } },
  }
  if (tools?.length) body.tools = [{ function_declarations: tools }]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const data = await res.json() as GeminiResponse
  if (!res.ok) throw new Error(data.error?.message ?? `Gemini ${res.status}`)
  return data.candidates?.[0]?.content?.parts ?? []
}

export async function geminiJson<T>(
  apiKey: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
): Promise<T> {
  const contents = [...history, { role: 'user', parts: [{ text: userMessage }] }]
  if (!apiKey) throw new Error('GEMINI_API_KEY 未配置')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/${CHAT_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
          response_mime_type: 'application/json',
        },
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const data = await res.json() as GeminiResponse
  if (!res.ok) throw new Error((data as any).error?.message ?? `Gemini ${res.status}`)
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  return JSON.parse(text) as T
}

function extractText(parts: GeminiPart[]): string | null {
  return parts.find(p => p.text?.trim())?.text ?? null
}

export async function geminiChat(
  apiKey: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  maxOutputTokens = 2048,
): Promise<string> {
  const contents = [...history, { role: 'user', parts: [{ text: userMessage }] }]
  const parts = await generate(apiKey, CHAT_MODEL, systemPrompt, contents, undefined, 0, maxOutputTokens)
  return extractText(parts) ?? '（无回复）'
}

export async function geminiWithTools(
  apiKey: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  tools: FunctionDeclaration[],
): Promise<{ text: string | null; functionCall: FunctionCall | null; modelParts: GeminiPart[] }> {
  const contents = [...history, { role: 'user', parts: [{ text: userMessage }] }]
  const parts = await generate(apiKey, TOOL_MODEL, systemPrompt, contents, tools, 0)
  return {
    text: extractText(parts),
    functionCall: parts.find(p => p.functionCall)?.functionCall ?? null,
    modelParts: parts,
  }
}

// modelParts 必须原样传入，以保留 thoughtSignature
export async function geminiWithFunctionResult(
  apiKey: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  modelParts: GeminiPart[],
  functionCall: FunctionCall,
  result: unknown,
): Promise<string> {
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
    { role: 'model', parts: modelParts },
    { role: 'user', parts: [{ functionResponse: { name: functionCall.name, response: { result } } }] },
  ]
  const parts = await generate(apiKey, TOOL_MODEL, systemPrompt, contents, undefined, 0)
  return extractText(parts) ?? '（无回复）'
}
