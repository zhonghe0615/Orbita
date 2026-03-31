import React, { useState } from 'react'

interface Props {
  onSuccess: (token: string, userId: string) => void
}

const USER_ID_RE = /^[a-zA-Z0-9]{6,}$/
const PASSWORD_RE = /^[\w!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]{6,}$/

export default function AuthForm({ onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!USER_ID_RE.test(userId)) {
      setError('userID 需至少6位字母或数字')
      return
    }
    if (!PASSWORD_RE.test(password)) {
      setError('密码需至少6位，可含字母、数字或特殊符号')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      })
      const data = await res.json() as { token?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? '请求失败')
        return
      }
      localStorage.setItem('token', data.token!)
      localStorage.setItem('userId', userId)
      onSuccess(data.token!, userId)
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ minWidth: 240, padding: '4px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError('') }}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: mode === m ? '#1677ff' : '#f0f0f0',
              color: mode === m ? '#fff' : '#666',
              fontWeight: mode === m ? 600 : 400,
            }}
          >
            {m === 'login' ? '登录' : '注册'}
          </button>
        ))}
      </div>

      <input
        placeholder="userID（≥6位字母数字）"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        autoComplete="username"
        style={inputStyle}
      />
      <input
        type="password"
        placeholder="密码（≥6位）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        style={{ ...inputStyle, marginTop: 8 }}
      />

      {error && <p style={{ color: '#ff4d4f', fontSize: 12, marginTop: 6 }}>{error}</p>}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%', marginTop: 12, padding: '8px 0', borderRadius: 6,
          border: 'none', background: '#1677ff', color: '#fff',
          fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
      </button>
    </form>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid #d9d9d9', outline: 'none', fontSize: 14,
  boxSizing: 'border-box',
}
