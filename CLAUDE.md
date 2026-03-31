# CLAUDE.md

## 项目概述
Orbita is an AI-native, conversation-driven productivity system that blends task management, deep research, and persistent memory into a single intelligent workflow.  Built on top of modern LLM infrastructure (Gemini API), Orbita enables users to manage tasks, conduct research, and interact with structured data — all through natural language.

## 项目要求
基于nodejs或python开发，代码部署到cloudflare worker，并提供可以访问的网址
欢迎用AI生成代码
但是模块拆分要清晰，代码要简洁、优雅，忌臃肿；要能体现出你的技术审美、品味

要求
1. 使用 Gemini AI Studio 免费 API （模型可以用 gemini-3.1-flash-lite-preview ）
2. 向量数据库用 https://qdrant.tech/pricing/ 的等免费云，数据库用 https://developers.cloudflare.com/d1/ 等做数据持久化
3. 实现一个对话机器人的网页（前端可以用现成的框架，比如nodejs的 https://chatui.io 、 Vercel AI SDK ， Python 的 Chainlit、Gradio、Streamlit等）
4. 当用户没有输入邮箱、姓名的时候会向用户索取，并在后续对话中能对称呼用户的名称
5. 用户可以用类似vibe coding方式，在和ai对话的过程中 增删改查 自己任务列表和列表中任务的具体需求
6. 用户可以给ai设置昵称、可以修改ai的昵称
7. 可以基于 https://serper.dev/ 或其他搜索api进行搜索和帮用户做深度研究
请仔细设计如何注入工具，如何规划子代理，如何设计记忆召回、上下文管理等等

## 核心规则
所有开发工作必须遵循 CODE.md 中的宪法级规则，特别是：
- §1 先方案后代码，需求不明确先澄清
- §2 超过 3 文件 / 200 行先拆分
- §7 单文件超 500 行必须拆分

# 交流风格
在工作中，我的一些想法或者建议是可能有错误的，所以我不需要你什么要求的附和，我需要你有独立思考的习惯和提出合理异议的勇气。

## 习惯
- 默认用中文交流,当你认为用英文对你的效率更高的时候可以切换
- 每次回复需引用遵循的 CODE.md 条款编号（§6 可验证性）

