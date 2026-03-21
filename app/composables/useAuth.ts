const accessToken = ref<string | null>(null)
const user = ref<{ email: string; name: string } | null>(null)
const authError = ref<string | null>(null)

function parseJwt(token: string) {
  try {
    // atob は Latin-1 でデコードするため、UTF-8 マルチバイト文字が化ける
    // TextDecoder で正しく UTF-8 デコード
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export function useAuth() {
  const config = useRuntimeConfig()

  function init() {
    if (import.meta.server) return
    const stored = localStorage.getItem('ichibanboshi_token')
    if (stored) {
      const payload = parseJwt(stored)
      if (payload) {
        accessToken.value = stored
        user.value = { email: payload.email, name: payload.name }
      }
    }
  }

  async function setTokens(token: string, refreshToken?: string): Promise<boolean> {
    const payload = parseJwt(token)
    if (!payload) {
      authError.value = '無効なトークンです'
      return false
    }

    // サーバーサイドでテナント検証
    try {
      await $fetch('/api/auth/validate', {
        method: 'POST',
        body: { token },
      })
    } catch (e: any) {
      authError.value = e.data?.statusMessage || 'このアカウントではアクセスできません'
      accessToken.value = null
      user.value = null
      localStorage.removeItem('ichibanboshi_token')
      localStorage.removeItem('ichibanboshi_refresh_token')
      return false
    }

    authError.value = null
    accessToken.value = token
    localStorage.setItem('ichibanboshi_token', token)
    if (refreshToken) {
      localStorage.setItem('ichibanboshi_refresh_token', refreshToken)
    }
    user.value = { email: payload.email, name: payload.name }
    return true
  }

  function logout() {
    accessToken.value = null
    user.value = null
    authError.value = null
    localStorage.removeItem('ichibanboshi_token')
    localStorage.removeItem('ichibanboshi_refresh_token')
    navigateTo('/login')
  }

  async function refreshAccessToken(): Promise<boolean> {
    const rt = localStorage.getItem('ichibanboshi_refresh_token')
    if (!rt) return false
    try {
      const res = await fetch(`${config.public.alcApiBase}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      })
      if (!res.ok) return false
      const data = await res.json()
      return setTokens(data.access_token, data.refresh_token)
    } catch {
      return false
    }
  }

  function loginWithGoogle() {
    authError.value = null
    const redirectUri = `${window.location.origin}/auth/callback`
    const state = btoa(JSON.stringify({ redirect_uri: redirectUri }))
    const url = `${config.public.alcApiBase}/api/auth/google/redirect?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
    window.location.href = url
  }

  const isAuthenticated = computed(() => !!accessToken.value)

  return {
    accessToken: readonly(accessToken),
    user: readonly(user),
    authError: readonly(authError),
    isAuthenticated,
    init,
    setTokens,
    logout,
    refreshAccessToken,
    loginWithGoogle,
  }
}
