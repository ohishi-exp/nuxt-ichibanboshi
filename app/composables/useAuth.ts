const accessToken = ref<string | null>(null)
const user = ref<{ email: string; name: string } | null>(null)

export function useAuth() {
  const config = useRuntimeConfig()

  function init() {
    if (import.meta.server) return
    const stored = localStorage.getItem('ichibanboshi_token')
    if (stored) {
      accessToken.value = stored
      try {
        const payload = JSON.parse(atob(stored.split('.')[1]))
        user.value = { email: payload.email, name: payload.name }
      } catch {}
    }
  }

  function setTokens(token: string, refreshToken?: string) {
    accessToken.value = token
    localStorage.setItem('ichibanboshi_token', token)
    if (refreshToken) {
      localStorage.setItem('ichibanboshi_refresh_token', refreshToken)
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      user.value = { email: payload.email, name: payload.name }
    } catch {}
  }

  function logout() {
    accessToken.value = null
    user.value = null
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
      setTokens(data.access_token, data.refresh_token)
      return true
    } catch {
      return false
    }
  }

  function loginWithGoogle() {
    const redirectUri = `${window.location.origin}/auth/callback`
    const state = btoa(JSON.stringify({ redirect_uri: redirectUri }))
    const url = `${config.public.alcApiBase}/api/auth/google/redirect?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
    window.location.href = url
  }

  const isAuthenticated = computed(() => !!accessToken.value)

  return {
    accessToken: readonly(accessToken),
    user: readonly(user),
    isAuthenticated,
    init,
    setTokens,
    logout,
    refreshAccessToken,
    loginWithGoogle,
  }
}
