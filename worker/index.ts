
import { createClient } from '@supabase/supabase-js'

type Env = {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  ADMIN_EMAILS: string
  APP_ORIGIN: string
}

const json = (data: unknown, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function createSupabaseClients(env: Env) {
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }

  return {
    admin: createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SECRET_KEY,
      options
    ),

    public: createClient(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      options
    ),
  }
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const username = value.trim().toLowerCase()

  if (!/^[\p{L}\p{N}_-]{3,30}$/u.test(username)) {
    return null
  }

  return username
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const email = value.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null
  }

  return email
}

function isAllowedAdmin(email: string, env: Env): boolean {
  const allowed = env.ADMIN_EMAILS
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)

  return allowed.includes(email)
}

function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 72
  )
}

async function readBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>
  } catch {
    return null
  }
}

async function registerUser(
  request: Request,
  env: Env
) {
  const body = await readBody(request)
  if (!body) return json({ error: '入力内容が不正です' }, 400)

  const username = normalizeUsername(body.username)
  const password = body.password

  if (!username || !validPassword(password)) {
    return json({
      error: 'ユーザー名は3～30文字、パスワードは8文字以上72文字以下にしてください',
    }, 400)
  }

  const { admin } = createSupabaseClients(env)

  // ユーザー名の重複確認
  const { data: existing, error: lookupError } =
    await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()

  if (lookupError) {
    return json({ error: 'ユーザー情報を確認できませんでした' }, 500)
  }

  if (existing) {
    return json({ error: 'このユーザー名は使用されています' }, 409)
  }

  // 推測できない内部メールアドレスを生成
  const authEmail =
    `user-${crypto.randomUUID()}@users.example.com`

  // Supabase Authユーザー作成
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      app_metadata: {
        role: 'user',
      },
      user_metadata: {
        username,
      },
    })

  if (createError || !created.user) {
    return json({ error: 'ユーザーを登録できませんでした' }, 400)
  }

  // profilesテーブルに登録
  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      id: created.user.id,
      username,
      auth_email: authEmail,
    })

  // profilesへの登録に失敗した場合はAuthユーザーを取り消す
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id)

    if (profileError.code === '23505') {
      return json({ error: 'このユーザー名は使用されています' }, 409)
    }

    return json({ error: 'プロフィールを登録できませんでした' }, 500)
  }

  return json({
    success: true,
    message: '登録しました。ユーザー名とパスワードでログインしてください。',
  })
}

async function loginUser(
  request: Request,
  env: Env
) {
  const body = await readBody(request)
  if (!body) return json({ error: '入力内容が不正です' }, 400)

  const username = normalizeUsername(body.username)
  const password = body.password

  if (!username || !validPassword(password)) {
    return json({ error: 'ユーザー名またはパスワードが違います' }, 401)
  }

  const { admin, public: publicClient } =
    createSupabaseClients(env)

  // ユーザー名から内部メールアドレスを取得
  const { data: profile, error: profileError } =
    await admin
      .from('profiles')
      .select('id, auth_email')
      .eq('username', username)
      .maybeSingle()

if (profileError) {
  console.error('profiles lookup failed:', {
    code: profileError.code,
    message: profileError.message,
    details: profileError.details,
    hint: profileError.hint,
  })

  return json({
    error: 'プロフィール情報を取得できませんでした',
  }, 500)
}

if (!profile?.auth_email) {
  return json({
    error: 'ユーザー名またはパスワードが違います',
  }, 401)
}

  // Supabase Authでログイン
  const { data, error } =
    await publicClient.auth.signInWithPassword({
      email: profile.auth_email,
      password,
    })

  if (error || !data.session) {
    return json({ error: 'ユーザー名またはパスワードが違います' }, 401)
  }

  return json({
    success: true,
    session: data.session,
    user: {
      id: profile.id,
      username,
      role: 'user',
    },
  })
}

async function registerAdmin(
  request: Request,
  env: Env
) {
  const body = await readBody(request)
  if (!body) return json({ error: '入力内容が不正です' }, 400)

  const email = normalizeEmail(body.email)
  const password = body.password

  if (!email || !validPassword(password)) {
    return json({ error: 'メールアドレスまたはパスワードが不正です' }, 400)
  }

  if (!isAllowedAdmin(email, env)) {
    return json({ error: 'このメールアドレスは管理者登録できません' }, 403)
  }

  const { admin, public: publicClient } =
    createSupabaseClients(env)

  // メール確認を利用した通常のSupabase登録
  const { data, error } =
    await publicClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: env.APP_ORIGIN,
        data: {
          account_type: 'admin',
        },
      },
    })

  if (error) {
    return json({
      error: '管理者登録を処理できませんでした',
    }, 400)
  }

  // メール確認が無効な設定では登録を取り消す
  if (data.session && data.user) {
    await admin.auth.admin.deleteUser(data.user.id)

    return json({
      error: 'Supabaseのメール確認を有効にしてください',
    }, 500)
  }

  return json({
    success: true,
    message: '確認メールを送信しました。メール内のリンクを開いてください。',
  })
}

async function loginAdmin(
  request: Request,
  env: Env
) {
  const body = await readBody(request)
  if (!body) return json({ error: '入力内容が不正です' }, 400)

  const email = normalizeEmail(body.email)
  const password = body.password

  if (!email || !validPassword(password)) {
    return json({ error: 'メールアドレスまたはパスワードが違います' }, 401)
  }

  if (!isAllowedAdmin(email, env)) {
    return json({ error: '管理者としてログインできません' }, 403)
  }

  const { admin, public: publicClient } =
    createSupabaseClients(env)

  // メールアドレスとパスワードでログイン
  const { data, error } =
    await publicClient.auth.signInWithPassword({
      email,
      password,
    })

  if (error || !data.user || !data.session) {
    return json({
      error: 'ログインできません。パスワードとメール確認を確認してください。',
    }, 401)
  }

  if (!data.user.email_confirmed_at) {
    return json({ error: 'メール確認が完了していません' }, 403)
  }

  // サーバー側で管理者権限を設定
  const { error: updateError } =
    await admin.auth.admin.updateUserById(
      data.user.id,
      {
        app_metadata: {
          ...(data.user.app_metadata ?? {}),
          role: 'admin',
        },
      }
    )

  if (updateError) {
    return json({ error: '管理者権限を設定できませんでした' }, 500)
  }

  // 更新した権限を含む新しいJWTを取得
  const { data: refreshed, error: refreshError } =
    await publicClient.auth.refreshSession({
      refresh_token: data.session.refresh_token,
    })

  if (refreshError || !refreshed.session) {
    return json({ error: 'ログイン情報を更新できませんでした' }, 500)
  }

  return json({
    success: true,
    session: refreshed.session,
    user: {
      id: data.user.id,
      email,
      role: 'admin',
    },
  })
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    try {
      if (
        request.method === 'GET' &&
        url.pathname === '/api/health'
      ) {
        return json({
          success: true,
          message: 'Cloudflare Worker is running',
        })
      }

      if (request.method !== 'POST') {
        if (url.pathname.startsWith('/api/')) {
          return json({ error: 'Method not allowed' }, 405)
        }
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/user/register'
      ) {
        return await registerUser(request, env)
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/user/login'
      ) {
        return await loginUser(request, env)
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/admin/register'
      ) {
        return await registerAdmin(request, env)
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/admin/login'
      ) {
        return await loginAdmin(request, env)
      }

      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'Not found' }, 404)
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      console.error('API ERROR:', {
        path: url.pathname,
        name: error instanceof Error
          ? error.name
          : 'UnknownError',
        message: error instanceof Error
          ? error.message
          : String(error),
        stack: error instanceof Error
          ? error.stack
          : undefined,
      })

      return json({
        error: 'サーバー内部でエラーが発生しました',
      }, 500)
    }
  },
} satisfies ExportedHandler<Env>
