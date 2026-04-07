/**
 * Auth プラグイン (ブラウザ専用)
 *
 * アプリ起動時に JWT を復元/検証し、未認証なら auth-worker ログイン画面へリダイレクト
 */
export default defineNuxtPlugin({
  name: 'auth',
  enforce: 'pre',
  async setup() {
    const config = useRuntimeConfig()
    const backend = config.public.apiBackend as string

    if (backend !== 'rust-logi' && backend !== 'rust-alc-api') return

    const { consumeFragment, loadFromStorage, recoverFromCookie, isAuthenticated, redirectToLogin, authState, fetchOrganizations } = useAuth()

    // 1. URL fragment からトークン取得を試行（auth-worker リダイレクト後）
    const foundInFragment = consumeFragment()

    if (foundInFragment) {
      // ?lw_callback パラメータを URL からクリーンアップ
      const currentUrl = new URL(window.location.href)
      if (currentUrl.searchParams.has('lw_callback')) {
        currentUrl.searchParams.delete('lw_callback')
        const cleanPath = currentUrl.pathname + (currentUrl.search || '')
        history.replaceState(null, '', cleanPath)
      }
    }

    if (!foundInFragment) {
      // 2. localStorage から復元
      loadFromStorage()
    }

    // 2.5. Cookie からの復旧（他アプリで認証済みの場合）
    if (!isAuthenticated.value) {
      recoverFromCookie()
    }

    // 3. 未認証 → ログイン画面へ
    if (!isAuthenticated.value) {
      redirectToLogin()
      return
    }

    // 4. 認証済み → 組織一覧を取得
    fetchOrganizations()

    // 5. 期限切れタイマーを設定
    const state = authState.value
    if (state) {
      const now = Math.floor(Date.now() / 1000)
      const msUntilExpiry = (state.expiresAt - now) * 1000
      if (msUntilExpiry > 0) {
        setTimeout(() => {
          if (!isAuthenticated.value) {
            redirectToLogin()
          }
        }, msUntilExpiry)
      }
    }
  },
})
