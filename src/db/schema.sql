-- 用户账户
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    UNIQUE NOT NULL,   -- 用户自定义 ID（≥6位英文）
  password_hash TEXT  NOT NULL,
  name        TEXT,                      -- 真实姓名（登录后 UI Agent 采集）
  email       TEXT,                      -- 邮箱（登录后 UI Agent 采集）
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login  DATETIME
);

-- AI 配置（昵称等）
CREATE TABLE IF NOT EXISTS ai_config (
  user_id   TEXT PRIMARY KEY,
  nickname  TEXT NOT NULL DEFAULT 'Orbita',
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- 任务列表
-- status: todo | in_progress | done | cancelled
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT,
  status      TEXT    NOT NULL DEFAULT 'todo',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- 对话历史（用于重新打开页面时渲染历史消息）
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  role       TEXT    NOT NULL,  -- 'user' | 'assistant'
  content    TEXT    NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_tasks_user    ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
