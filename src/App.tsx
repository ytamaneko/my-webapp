
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import './App.css'

type Memo = {
  id: number
  user_id: string
  title: string
  content: string | null
  username?: string
}

type AccountType = 'user' | 'admin'

type ApiResult = {
  success?: boolean
  error?: string
  message?: string
  session?: {
    access_token: string
    refresh_token: string
  }
}

async function postApi(
  path: string,
  body: Record<string, string>
): Promise<ApiResult> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = await response.json() as ApiResult

  if (!response.ok) {
    throw new Error(result.error || `HTTP ${response.status}`)
  }

  return result
}

function App() {
  const [user, setUser] = useState<User | null>(null)

  const [accountType, setAccountType] =
    useState<AccountType>('user')

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [isRegister, setIsRegister] = useState(false)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [memos, setMemos] = useState<Memo[]>([])
  const [message, setMessage] = useState('')

  const [menuOpen, setMenuOpen] = useState(false)

  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordChanging, setPasswordChanging] = useState(false)

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

async function loadMemos(
  userId: string,
  admin: boolean
) {
  let query = supabase
    .from('memos')
    .select('id, user_id, title, content')
    .order('created_at', { ascending: false })

  if (!admin) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query

  if (error) {
    setMessage(error.message)
    return
  }

  const memoRows = data ?? []

  // 一般ユーザーには自分のメモだけ表示
  if (!admin || memoRows.length === 0) {
    setMemos(memoRows)
    return
  }

  // 管理者の場合は投稿者のユーザーIDを取得
  const userIds = [
    ...new Set(memoRows.map(memo => memo.user_id))
  ]

  // profilesからユーザー名を取得
  const { data: profiles, error: profileError } =
    await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds)

  if (profileError) {
    setMessage('投稿者のユーザー名を取得できませんでした')
    setMemos(memoRows)
    return
  }

  // ユーザーIDとユーザー名を対応させる
  const usernameMap = new Map(
    (profiles ?? []).map(profile => [
      profile.id,
      profile.username
    ])
  )

  // メモに投稿者名を追加
  const result = memoRows.map(memo => ({
    ...memo,
    username: usernameMap.get(memo.user_id)
      ?? 'ユーザー情報なし'
  }))

  setMemos(result)
}

useEffect(() => {
  if (user) {
    loadMemos(
      user.id,
      user.app_metadata?.role === 'admin'
    )
  } else {
    setMemos([])
  }
}, [user])

  async function register() {
    try {
      const result = accountType === 'user'
        ? await postApi('/api/user/register', {
            username,
            password,
          })
        : await postApi('/api/admin/register', {
            email,
            password,
          })

      setMessage(
        result.message ?? '登録処理が完了しました'
      )

      setIsRegister(false)
      setPassword('')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '登録に失敗しました'
      )
    }
  }

  async function login() {
    try {
      const result = accountType === 'user'
        ? await postApi('/api/user/login', {
            username,
            password,
          })
        : await postApi('/api/admin/login', {
            email,
            password,
          })

      if (!result.session) {
        throw new Error('ログイン情報を取得できませんでした')
      }

      const { error } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })

      if (error) throw error

      setPassword('')
      setMessage('ログインしました')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'ログインに失敗しました'
      )
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('ログアウトしました')
  }


  async function changePassword() {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setMessage('すべての項目を入力してください')
      return
    }

    if (newPassword.length < 8 || newPassword.length > 72) {
      setMessage('新しいパスワードは8～72文字にしてください')
      return
    }

    if (newPassword !== confirmNewPassword) {
      setMessage('新しいパスワードが一致しません')
      return
    }

    if (currentPassword === newPassword) {
      setMessage('現在と異なるパスワードを設定してください')
      return
    }

    setPasswordChanging(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      })

      if (error) {
        setMessage('パスワードを変更できませんでした：' + error.message)
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setShowPasswordChange(false)

      setMessage('パスワードを変更しました！次回から新しいパスワードでログインしてください。')
    } catch {
      setMessage('パスワード変更中にエラーが発生しました')
    } finally {
      setPasswordChanging(false)
    }
  }

  async function addMemo() {
    if (!user || !title.trim()) return

    const { error } = await supabase
      .from('memos')
      .insert({
        title: title.trim(),
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

    await loadMemos(
      user.id,
      user.app_metadata?.role === 'admin'
)
  }

async function deleteMemo(id: number) {
  if (!user) return

  let query = supabase
    .from('memos')
    .delete()
    .eq('id', id)

  if (user.app_metadata?.role !== 'admin') {
    query = query.eq('user_id', user.id)
  }

  const { error } = await query

  if (error) {
    setMessage(error.message)
    return
  }

  setMessage('メモを削除しました')

  await loadMemos(
    user.id,
    user.app_metadata?.role === 'admin'
  )
}

  const isAdmin = user?.app_metadata?.role === 'admin'

  return (
    <main className="container">
      {/* 画面右上のハンバーガーメニュー */}
      <div className="app-menu">
        <button
          type="button"
          className="app-menu-button"
          aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={menuOpen}
          aria-controls="app-side-menu"
          onClick={() => setMenuOpen(open => !open)}
        >
          <span aria-hidden="true">
            {menuOpen ? '×' : '☰'}
          </span>
        </button>

        {menuOpen && (
          <nav
            id="app-side-menu"
            className="app-menu-panel"
            aria-label="外部リンク"
          >
            <a
              href="https://paddock-racing.snugmule23.chatgpt.site/"
              target="_blank"
              rel="noopener noreferrer"
              className="app-menu-link"
              onClick={() => setMenuOpen(false)}
            >
              🐴ねこぜ競技場へ行く
            </a>

            <a
              href="https://after-hours-kakuto.snugmule23.chatgpt.site/"
              target="_blank"
              rel="noopener noreferrer"
              className="app-menu-link"
              onClick={() => setMenuOpen(false)}
            >
              🕹️筐体に100円入れる
            </a>
          </nav>
        )}
      </div>
      <h1>マイメモアプリ</h1>

      {message && <p>{message}</p>}

      {!user ? (
        <section>
          <h2>ログイン・会員登録</h2>

          <h3>アカウント種類</h3>

          <button
            onClick={() => {
              setAccountType('user')
              setMessage('')
            }}
          >
            一般ユーザー
          </button>

          <button
            onClick={() => {
              setAccountType('admin')
              setMessage('')
            }}
          >
            管理者
          </button>

          <h3>
            {accountType === 'user'
              ? '一般ユーザー'
              : '管理者'}
            {isRegister ? '新規登録' : 'ログイン'}
          </h3>

          {accountType === 'user' ? (
            <input
              placeholder="ユーザー名"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          ) : (
            <input
              placeholder="管理者メールアドレス"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          )}

          <input
            placeholder="パスワード（8文字以上）"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          <button onClick={login}>
            ログイン
          </button>

          <button onClick={register}>
            新規登録
          </button>

          <button
            onClick={() => {
              setIsRegister(!isRegister)
              setPassword('')
              setMessage('')
            }}
          >
            {isRegister
              ? 'ログイン画面に戻る'
              : '新規登録へ切り替え'}
          </button>

          {accountType === 'user' && (
            <p>
              ユーザー名は3～30文字です。
              英数字、日本語、_、- が使えます。
            </p>
          )}

          {accountType === 'admin' && (
            <p>
              管理者登録には許可されたメールアドレスが必要です。
              登録後、メール確認を行ってください。
            </p>
          )}
        </section>
      ) : (
        <section>
          <h2>マイページ</h2>

          <p>
            {isAdmin ? '管理者' : '一般ユーザー'}
          </p>

          <p>
            {isAdmin
              ? user.email
              : user.user_metadata?.username}
          </p>

          <button onClick={logout}>
            ログアウト
          </button>

          {/* パスワード変更ボタン */}
          <button
            type="button"
            onClick={() => {
              setShowPasswordChange(open => !open)
              setMessage('')
            }}
          >
            {showPasswordChange
              ? 'パスワード変更を閉じる'
              : 'パスワードを変更する'}
          </button>

          {/* パスワード変更画面 */}
          {showPasswordChange && (
            <section className="password-change-panel">
              <h2>パスワード変更</h2>

              <p>現在のパスワードと新しいパスワードを入力してください。</p>

              <input
                type="password"
                autoComplete="current-password"
                placeholder="現在のパスワード"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />

              <input
                type="password"
                autoComplete="new-password"
                placeholder="新しいパスワード（8文字以上）"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />

              <input
                type="password"
                autoComplete="new-password"
                placeholder="新しいパスワード（確認）"
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
              />

              <button
                type="button"
                onClick={changePassword}
                disabled={passwordChanging}
              >
                {passwordChanging
                  ? '変更中...'
                  : 'パスワードを変更する'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPasswordChange(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmNewPassword('')
                }}
              >
                キャンセル
              </button>
            </section>
          )}
              
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

          <button onClick={addMemo}>
            保存する
          </button>

          <h2>保存したメモ</h2>

          {memos.map(memo => (
            <article key={memo.id}>
              <h3>{memo.title}</h3>

              {isAdmin && (
                <p>
                 投稿者：{memo.username ?? '不明'}
                </p>
              )}

             <p>{memo.content}</p>

              <button
                onClick={() => deleteMemo(memo.id)}
              >
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
