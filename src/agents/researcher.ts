import { geminiChat } from '../lib/gemini'
import { serperSearch } from '../tools/search'

const DEEP_RESEARCH_RESULTS = 6  // 深度研究时拉取更多结果供综合分析

const RESEARCH_PROMPT = `你是一个深度研究助手。请基于提供的搜索结果，为用户生成一份结构清晰的研究报告：
- 综合多个来源，提炼核心观点
- 分段组织，使用 Markdown 格式
- 如有矛盾信息，如实注明
- 不要编造搜索结果中没有的信息
- 报告末尾必须附上"参考来源"章节，每条格式为：[标题](完整URL)，URL 必须原样照抄搜索结果中的链接，不得省略或修改`

export async function deepResearch(
  geminiKey: string,
  serperKey: string,
  query: string,
  userContext?: string,
): Promise<string> {
  const results = await serperSearch(serperKey, query, DEEP_RESEARCH_RESULTS)
  const contextSection = userContext ? `\n\n【用户背景信息】\n${userContext}` : ''
  return geminiChat(
    geminiKey,
    RESEARCH_PROMPT,
    [],
    `研究问题：${query}${contextSection}\n\n搜索结果：\n${results}`,
    4096,
  )
}
