import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import Chat, { Bubble, useMessages } from '@chatui/core'
import '@chatui/core/dist/index.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './markdown.css'
import AuthForm from './components/AuthForm'

type OnboardingStep = 'name' | 'email' | 'nickname' | null

interface Profile { name: string | null; email: string | null; aiNickname: string | null }

// ── Auth Page ────────────────────────────────────────────────
function AuthPage({ onSuccess }: { onSuccess: (token: string, userId: string) => void }) {
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#f5f5f5',
    }}>
      <h1 style={{ marginBottom: 32, fontSize: 28, fontWeight: 700, color: '#1677ff' }}>Orbita</h1>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)', width: 320,
      }}>
        <AuthForm onSuccess={onSuccess} />
      </div>
    </div>
  )
}

// ── Chat Page ────────────────────────────────────────────────
function ChatPage({ userId, token, onLogout }: { userId: string; token: string; onLogout: () => void }) {
  const { messages, appendMsg, setTyping } = useMessages([])
  const [step, setStep] = useState<OnboardingStep>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [aiName, setAiName] = useState('Orbita')

  // 登录后拉取 profile + 历史消息
  React.useEffect(() => {
    async function init() {
      try {
        const [profileRes, historyRes] = await Promise.all([
          fetch('/user/profile', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/chat/history', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (!profileRes.ok) throw new Error(`${profileRes.status}`)
        const p = await profileRes.json() as Profile
        setProfile(p)
        if (p.aiNickname) setAiName(p.aiNickname)

        if (historyRes.ok) {
          const history = await historyRes.json() as { role: string; content: string }[]
          history.forEach(m => appendMsg({
            type: 'text',
            content: { text: m.content },
            position: m.role === 'user' ? 'right' : 'left',
          }))
        }

        nextStep(p, null)
      } catch (e) {
        appendMsg({ type: 'text', content: { text: `加载失败（${e instanceof Error ? e.message : '网络错误'}），请刷新重试` }, position: 'left' })
      }
    }
    init()
  }, [])

  function nextStep(p: Profile, current: OnboardingStep) {
    if (!p.name && current !== 'name') {
      setStep('name')
      appendMsg({ type: 'text', content: { text: '你好！请问你的姓名是？（支持中文或英文）' }, position: 'left' })
    } else if (!p.email && current !== 'email') {
      setStep('email')
      appendMsg({ type: 'text', content: { text: `好的！请问你的邮箱地址是？` }, position: 'left' })
    } else if (!p.aiNickname && current !== 'nickname') {
      setStep('nickname')
      appendMsg({ type: 'text', content: { text: '你想给我起个什么昵称？（直接回复即可）' }, position: 'left' })
    } else {
      setStep(null)
      const name = p.name ?? userId
      const nickname = p.aiNickname ?? 'Orbita'
      setAiName(nickname)
      appendMsg({ type: 'text', content: { text: `你好，${name}！我是 ${nickname}，有什么可以帮你的？\n\n我可以帮你：\n- 📝 新建、查看、更新或删除任务\n- 🔍 搜索公开资料或做深度研究\n- 💬 随时闲聊` }, position: 'left' })
    }
  }

  const NAME_RE = /^[\u4e00-\u9fa5a-zA-Z\s·]{1,30}$/
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  async function handleOnboarding(val: string, currentStep: OnboardingStep) {
    if (currentStep === 'name') {
      if (!NAME_RE.test(val.trim())) {
        appendMsg({ type: 'text', content: { text: '姓名格式不正确，请输入中文或英文名字' }, position: 'left' })
        return
      }
      await fetch('/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: val.trim() }),
      })
      const updated = { ...profile!, name: val.trim() }
      setProfile(updated)
      nextStep(updated, 'name')
    } else if (currentStep === 'email') {
      if (!EMAIL_RE.test(val.trim())) {
        appendMsg({ type: 'text', content: { text: '邮箱格式不正确，请重新输入' }, position: 'left' })
        return
      }
      await fetch('/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: val.trim() }),
      })
      const updated = { ...profile!, email: val.trim() }
      setProfile(updated)
      nextStep(updated, 'email')
    } else if (currentStep === 'nickname') {
      const nick = val.trim()
      await fetch('/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ aiNickname: nick }),
      })
      const updated = { ...profile!, aiNickname: nick }
      setProfile(updated)
      nextStep(updated, 'nickname')
    }
  }

  async function handleSend(type: string, val: string) {
    if (type !== 'text' || !val.trim()) return
    appendMsg({ type: 'text', content: { text: val }, position: 'right' })

    if (step !== null) {
      await handleOnboarding(val, step)
      return
    }

    setTyping(true)
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: val }),
      })
      const data = await res.json() as { reply: string }
      appendMsg({ type: 'text', content: { text: data.reply }, position: 'left' })
    } catch {
      appendMsg({ type: 'text', content: { text: '网络错误，请稍后重试' }, position: 'left' })
    } finally {
      setTyping(false)
    }
  }

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 8,
        height: 50, paddingRight: 12,
      }}>
        <span style={{ fontSize: 13, color: '#999' }}>{userId}</span>
        <button
          onClick={onLogout}
          style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #d9d9d9', background: '#fff', color: '#555', cursor: 'pointer',
          }}
        >退出</button>
      </div>
    <Chat
      navbar={{ title: aiName }}
      messages={messages}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderMessageContent={(msg: any) => (
        msg.position === 'left'
          ? <Bubble><div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content.text ?? ''}</ReactMarkdown></div></Bubble>
          : <Bubble content={msg.content.text ?? ''} />
      )}
      onSend={handleSend}
    />
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────
function App() {
  const [auth, setAuth] = useState<{ token: string; userId: string } | null>(() => {
    const token = localStorage.getItem('token')
    const userId = localStorage.getItem('userId')
    return token && userId ? { token, userId } : null
  })

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('userId')
    setAuth(null)
  }

  if (!auth) {
    return <AuthPage onSuccess={(token, userId) => setAuth({ token, userId })} />
  }
  return <ChatPage userId={auth.userId} token={auth.token} onLogout={handleLogout} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
