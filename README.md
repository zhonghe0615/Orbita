[English](#english) · [中文](#中文)

---

## English

# Orbita

An AI-native, conversation-driven productivity system. Manage tasks, run deep research, and maintain persistent memory — all through natural language.

Built on Cloudflare Workers + Gemini API. No subscription required: every dependency has a free tier.

**Live demo:** https://orbita.zhonghe98105.workers.dev/

---

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│   ChatUI  ·  Markdown rendering  ·  JWT auth        │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────────┐
│              Cloudflare Worker (Hono)                │
│                                                      │
│  POST /chat  ──►  Orchestrator (Gemini JSON-mode)   │
│                        │                             │
│              ┌─────────┼──────────┐                 │
│              ▼         ▼          ▼                  │
│          Tasks      Search    Deep Research          │
│          (D1)      (Serper)   (Serper + Gemini)      │
│                                                      │
│  Memory recall ──► Qdrant (vector search)            │
│  Session cache ──► KV  (recent 10 turns)             │
│  Persistence   ──► D1  (messages / tasks / profile)  │
└─────────────────────────────────────────────────────┘
```

---

### Design deep-dive

#### Tool injection — JSON-mode orchestration

Rather than native function calling (which hands control to the SDK), the orchestrator speaks a **custom JSON dialect**: every Gemini response must be `{ "action": <object|null>, "reply": "<string>" }`. The Worker owns dispatch entirely — it validates the action, enforces guards (confirm before delete, require task ID before update), and decides what gets appended to the reply. This keeps the agent loop deterministic and auditable without any framework magic.

The action schema is injected dynamically: superadmin users receive an extra `ADMIN_SCHEMA` block listing four admin-only actions. Ordinary users never see those lines, so the model cannot hallucinate admin operations for them.

#### Sub-agent design — researcher as a focused specialist

Deep research is intentionally split off into a **separate sub-agent** (`researcher.ts`) rather than handled inline:

```
Orchestrator  →  decides "deep_research"
                     │
                     ▼
              Researcher sub-agent
              ├─ serperSearch (6 results)
              ├─ injects userContext (task snapshot + profile)
              └─ geminiChat (4096 tokens, synthesis prompt)
```

The `userContext` parameter is the key insight: the researcher receives the same system-prompt snapshot used for the main chat (tasks, name, AI nickname). This lets the synthesis model write a report that is aware of *who is asking and why* — e.g. connecting a research topic to an ongoing task — without the orchestrator having to relay this explicitly.

#### Memory recall — two-layer with graceful degradation

| Layer | Store | Purpose | TTL |
|-------|-------|---------|-----|
| Session window | KV | Last 10 turns, fast read/write | 7 days |
| Semantic memory | Qdrant | Cosine-similarity recall across all history | Permanent |

Each chat turn triggers a `recall()` from Qdrant (top-3 semantically similar past turns), which is prepended to the system prompt. This gives the model a "memory" that survives session boundaries without bloating the context window.

`remember()` writes to Qdrant **asynchronously** via `executionCtx.waitUntil()` — the HTTP response is returned immediately; the vector write happens in the background. Latency stays low even when Qdrant is slow.

On KV miss (TTL expiry or first login on a new device), the worker **reconstructs the session from D1** and backfills KV. History is never truly lost — D1 is the source of truth, KV is just a fast cache.

#### Context management — budget-capped task snapshot

Injecting the full task list verbatim would cause token explosion for heavy users. The solution is a **character-budget formatter**:

- Total task section capped at **800 characters**
- Each task description truncated at **60 characters** with `…`
- Tasks are included newest-first; the budget is consumed greedily until exhausted

Before storing assistant replies to KV, markdown links are **stripped** (`[text](url)` → `text`). Research reports can contain dozens of URLs; removing them before caching cuts KV payload and future prompt size significantly while preserving the readable text.

> **Future direction**: as task lists grow large, the character-budget approach becomes lossy. The natural evolution is to replace the snapshot with **embedding-based RAG** — embed each task at write time, then at query time retrieve only the tasks semantically relevant to the user's current message. This keeps prompt size constant regardless of how many tasks exist.

---

### Request flow — `POST /chat`

```
1. Parallel fetch: user profile + KV session + task list (D1)
2. Build system prompt  →  inject task snapshot
3. Recall semantic memory from Qdrant  →  append to prompt
4. Orchestrator (Gemini)  →  returns { action, reply }
5. Dispatch action:
     task ops      →  D1 CRUD
     web_search    →  Serper → format results
     deep_research →  Serper (8 results) + Gemini synthesis
6. async: remember() stores turn in Qdrant (waitUntil)
7. Update KV session (strip links to save tokens)
8. Persist messages to D1
9. Return { reply }
```

---

### Module map

```
src/
├── index.ts              # Hono app entry, Bindings type
├── middleware/
│   └── auth.ts           # JWT verification (HS256)
├── routes/
│   ├── auth.ts           # register / login
│   ├── user.ts           # profile GET/PUT, AI nickname upsert
│   └── chat.ts           # main chat endpoint + system prompt builder
├── agents/
│   ├── orchestrator.ts   # JSON-mode agent, action dispatch
│   ├── researcher.ts     # deep research: search + Gemini synthesis
│   └── memory.ts         # recall() / remember() — Qdrant interface
├── tools/
│   ├── tasks.ts          # D1 CRUD for tasks, STATUS_LABEL constant
│   └── search.ts         # Serper API wrapper
├── lib/
│   ├── gemini.ts         # geminiChat / geminiJson / geminiWithTools
│   ├── embedding.ts      # text-embedding-004 via Gemini API
│   ├── qdrant.ts         # ensureCollection / upsert / search
│   └── crypto.ts         # PBKDF2 hash + constant-time verify
└── db/
    └── schema.sql        # users / ai_config / tasks / messages
```

---

### Setup

**Prerequisites**

| Service | Purpose | Free tier |
|---------|---------|-----------|
| Cloudflare account | Worker, D1, KV | Yes |
| [Gemini AI Studio](https://aistudio.google.com/) | LLM + embeddings | Yes |
| [Qdrant Cloud](https://qdrant.tech/pricing/) | Vector memory | Yes (1 GB) |
| [Serper](https://serper.dev/) | Web search | Yes (2500 queries) |

**1. Clone and install**

```bash
git clone https://github.com/your-username/orbita
cd orbita
npm install
```

**2. Configure Wrangler**

```bash
cp wrangler.toml.example wrangler.toml
```

Fill in your `database_id` and KV `id`:

```bash
wrangler d1 create orbita
wrangler kv namespace create KV
```

**3. Initialize the database**

```bash
wrangler d1 execute orbita --file=src/db/schema.sql
```

**4. Set secrets**

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put JWT_SECRET        # any random string
wrangler secret put SERPER_API_KEY
wrangler secret put QDRANT_URL        # e.g. https://xxx.qdrant.io
wrangler secret put QDRANT_API_KEY
```

**5. Local development**

```bash
cp .dev.vars.example .dev.vars   # fill in your keys
npm run dev                       # starts Worker + Vite concurrently
```

**6. Deploy**

```bash
npm run deploy   # builds frontend → deploys to Cloudflare
```

---

### Features

- **Conversational task management** — create, list, update, delete tasks through natural language; AI asks for confirmation before destructive operations
- **Web search** — triggered automatically when the user asks about current information
- **Deep research** — multi-source synthesis with cited references
- **Persistent memory** — semantic recall via Qdrant; the AI remembers past conversations
- **Custom AI nickname** — users can rename the assistant at any time
- **Profile collection** — AI proactively asks for name and email on first use

---

### License

MIT

---

## 中文

# Orbita

AI 原生的对话式效率系统，将任务管理、深度研究和持久记忆整合到单一工作流中。全程自然语言交互，无需学习任何命令。

基于 Cloudflare Workers + Gemini API 构建，所有依赖均有免费额度，零订阅成本可跑起来。

**在线体验：** https://orbita.zhonghe98105.workers.dev/

---

### 架构

```
┌─────────────────────────────────────────────────────┐
│                   React 前端                         │
│   ChatUI  ·  Markdown 渲染  ·  JWT 认证              │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────────┐
│           Cloudflare Worker（Hono）                  │
│                                                      │
│  POST /chat  ──►  Orchestrator（Gemini JSON-mode）  │
│                        │                             │
│              ┌─────────┼──────────┐                 │
│              ▼         ▼          ▼                  │
│           任务管理    网络搜索   深度研究             │
│           (D1)      (Serper)  (Serper + Gemini)      │
│                                                      │
│  语义记忆召回 ──► Qdrant（向量检索）                 │
│  会话缓存    ──► KV（最近 10 轮）                    │
│  持久化      ──► D1（消息 / 任务 / 用户资料）        │
└─────────────────────────────────────────────────────┘
```

---

### 设计剖析

#### 工具注入 — JSON-mode 编排

没有使用 native function calling（那会把控制权交给 SDK），而是让 Orchestrator 说一套**自定义 JSON 方言**：Gemini 每轮必须返回 `{ "action": <对象|null>, "reply": "<字符串>" }`，Worker 全权负责 dispatch。

这样做的好处是 Worker 可以在执行前插入任意守卫逻辑：删除前二次确认、update 前校验任务存在、ID 不明确时拒绝执行。整个 agent 循环完全可预期，没有 SDK 黑盒。

Action schema 是**动态注入**的：超级管理员用户会在 prompt 末尾追加 `ADMIN_SCHEMA`，普通用户完全看不到这段内容，模型因此无法为普通用户幻觉出管理员操作。

#### 子代理规划 — 研究员作为专注的专家

深度研究被拆分成独立的子代理（`researcher.ts`），而不是在 Orchestrator 里内联处理：

```
Orchestrator  →  判断 "deep_research"
                     │
                     ▼
              Researcher 子代理
              ├─ serperSearch（6条结果）
              ├─ 注入 userContext（任务快照 + 用户资料）
              └─ geminiChat（4096 token，综合分析 prompt）
```

关键设计点在 `userContext`：研究员收到的是与主对话完全相同的系统 prompt 快照（包含任务列表、用户姓名、AI 昵称）。这让综合分析模型能感知到**是谁在问、为什么问**，例如将研究话题和某条进行中的任务自然关联起来，而 Orchestrator 无需显式中转这些信息。

#### 记忆召回 — 双层存储 + 优雅降级

| 层级 | 存储 | 作用 | 生命周期 |
|------|------|------|---------|
| 会话窗口 | KV | 最近 10 轮，快速读写 | 7 天 TTL |
| 语义记忆 | Qdrant | 余弦相似度跨会话召回 | 永久 |

每轮对话触发一次 Qdrant `recall()`，取 top-3 语义相关历史片段前置到 system prompt。这让模型拥有跨会话的"长期记忆"，而不会把所有历史都塞进上下文窗口。

`remember()` 通过 `executionCtx.waitUntil()` **异步**写入 Qdrant —— HTTP 响应立即返回，向量写入在后台完成，Qdrant 偶发延迟不影响用户体感。

KV miss 时（TTL 过期或新设备登录），Worker 从 D1 重建会话历史并回填 KV。**D1 是真相来源，KV 只是快速缓存**，历史永远不会真正丢失。

#### 上下文管理 — 字符预算制任务快照

把完整任务列表逐字注入会导致重度用户的上下文爆炸，解决方案是**字符预算格式化器**：

- 任务区块总上限 **800 字符**
- 每条任务描述截断至 **60 字符**，超出显示 `…`
- 按最新优先贪心填充，超预算后截止

存入 KV 前，assistant 回复会**剥除 Markdown 链接**（`[文字](url)` → `文字`）。研究报告可能含几十条 URL，去掉后 KV 存储和后续 prompt 体积大幅压缩，可读文本完整保留。

> **演进方向**：当任务数量持续增长后，字符预算方案会变得有损。自然的下一步是引入 **Embedding + RAG**——任务写入时生成向量，查询时只召回与当前问题语义相关的任务子集注入 prompt，上下文体积从此与任务总量解耦。

---

### 请求流程 — `POST /chat`

```
1. 并行拉取：用户资料 + KV 会话 + 任务列表（D1）
2. 构建 system prompt → 注入任务快照
3. 从 Qdrant 召回语义记忆 → 追加到 prompt
4. Orchestrator（Gemini）→ 返回 { action, reply }
5. 分发 action：
     任务操作    → D1 增删改查
     web_search  → Serper → 格式化结果
     deep_research → Serper（8条）+ Gemini 综合分析
6. 异步：remember() 将本轮存入 Qdrant（waitUntil）
7. 更新 KV 会话（剥掉链接减少 token 占用）
8. 持久化消息到 D1
9. 返回 { reply }
```

---

### 模块结构

```
src/
├── index.ts              # Hono 入口，Bindings 类型定义
├── middleware/
│   └── auth.ts           # JWT 验证（HS256）
├── routes/
│   ├── auth.ts           # 注册 / 登录
│   ├── user.ts           # 用户资料 GET/PUT，AI 昵称 upsert
│   └── chat.ts           # 主对话接口 + system prompt 构建
├── agents/
│   ├── orchestrator.ts   # JSON-mode agent，action dispatch
│   ├── researcher.ts     # 深度研究：搜索 + Gemini 综合
│   └── memory.ts         # recall() / remember()，Qdrant 接口
├── tools/
│   ├── tasks.ts          # 任务 D1 CRUD，STATUS_LABEL 共享常量
│   └── search.ts         # Serper API 封装
├── lib/
│   ├── gemini.ts         # geminiChat / geminiJson / geminiWithTools
│   ├── embedding.ts      # text-embedding-004（Gemini API）
│   ├── qdrant.ts         # ensureCollection / upsert / search
│   └── crypto.ts         # PBKDF2 哈希 + 常量时间比较
└── db/
    └── schema.sql        # users / ai_config / tasks / messages
```

---

### 部署指南

**依赖服务**

| 服务 | 用途 | 免费额度 |
|------|------|---------|
| Cloudflare 账号 | Worker、D1、KV | 有 |
| [Gemini AI Studio](https://aistudio.google.com/) | LLM + 向量嵌入 | 有 |
| [Qdrant Cloud](https://qdrant.tech/pricing/) | 向量记忆库 | 有（1 GB） |
| [Serper](https://serper.dev/) | 网络搜索 | 有（2500 次） |

**1. 克隆并安装依赖**

```bash
git clone https://github.com/your-username/orbita
cd orbita
npm install
```

**2. 配置 Wrangler**

```bash
cp wrangler.toml.example wrangler.toml
```

创建 D1 和 KV，将返回的 ID 填入 `wrangler.toml`：

```bash
wrangler d1 create orbita
wrangler kv namespace create KV
```

**3. 初始化数据库**

```bash
wrangler d1 execute orbita --file=src/db/schema.sql
```

**4. 配置 Secrets**

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put JWT_SECRET        # 随机字符串即可
wrangler secret put SERPER_API_KEY
wrangler secret put QDRANT_URL        # 如 https://xxx.qdrant.io
wrangler secret put QDRANT_API_KEY
```

**5. 本地开发**

```bash
cp .dev.vars.example .dev.vars   # 填入各 key
npm run dev                       # 同时启动 Worker + Vite
```

**6. 部署**

```bash
npm run deploy   # 构建前端 → 部署到 Cloudflare
```

---

### 功能

- **对话式任务管理** — 用自然语言增删改查任务，写操作前 AI 会二次确认
- **网络搜索** — 用户提及"查一下"、"最新"等关键词时自动触发
- **深度研究** — 多源综合分析，报告末尾附带参考链接
- **持久记忆** — Qdrant 语义召回，AI 记得之前的对话内容
- **自定义 AI 昵称** — 用户随时可以给 AI 改名
- **资料采集** — 首次使用时 AI 主动询问姓名和邮箱

---

### License

MIT
