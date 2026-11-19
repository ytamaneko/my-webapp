
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

type Memo = {
  id: number
  title: string
  content: string | null
}

function App() {
  const [user, setUser] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [memos, setMemos] = useState<Memo[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })

    const { data } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) loadMemos()
    else setMemos([])
  }, [user])

  async function signup() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })
    setMessage(error?.message ?? '登録処理を実行しました。メールを確認してください。')
  }

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    setMessage(error?.message ?? 'ログインしました')
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()
    setMessage(error?.message ?? 'ログアウトしました')
  }

  async function loadMemos() {
    const { data, error } = await supabase
      .from('memos')
      .select('id, title, content')
      .order('created_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      return
    }

    setMemos(data ?? [])
  }

  async function addMemo() {
    if (!title.trim()) return

    const { error } = await supabase.from('memos').insert({
      title,
      content,
      user_id: user.id,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setTitle('')
    setContent('')
    setMessage('メモを保存しました')
    loadMemos()
  }

  async function deleteMemo(id: number) {
    const { error } = await supabase
      .from('memos')
      .delete()
      .eq('id', id)

    if (error) {
      setMessage(error.message)
      return
    }

    loadMemos()
  }

  return (
    <main className="container">
      <h1>マイメモアプリ</h1>
      <p>React + Supabase</p>

      {message && <p>{message}</p>}

      {!user ? (
        <section>
          <h2>ログイン・会員登録</h2>

          <input
            placeholder="メールアドレス"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />

          <input
            placeholder="パスワード（6文字以上）"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          <button onClick={login}>ログイン</button>
          <button onClick={signup}>新規登録</button>
        </section>
      ) : (
        <section>
          <h2>マイページ</h2>
          <p>{user.email}</p>
          <button onClick={logout}>ログアウト</button>

          <h2>メモを追加</h2>

          <input
            placeholder="タイトル"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />

          <textarea
            placeholder="内容"
            value={content}
            onChange={e => setContent(e.target.value)}
          />

          <button onClick={addMemo}>保存する</button>

          <h2>保存したメモ</h2>

          {memos.map(memo => (
            <article key={memo.id}>
              <h3>{memo.title}</h3>
              <p>{memo.content}</p>
              <button onClick={() => deleteMemo(memo.id)}>
                削除
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

export default App
