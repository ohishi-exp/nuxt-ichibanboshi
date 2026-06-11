/**
 * Auth プラグイン (ブラウザ専用)
 *
 * アプリ起動時に JWT を復元/検証し、未認証なら auth-worker ログイン画面へリダイレクト。
 * 共通フロー (fragment・storage・cookie 復元 / 未認証 redirect / 組織一覧取得 /
 * 期限切れタイマー) は @ippoan/auth-client の initAuthSession に集約済み
 * (Refs ippoan/auth-worker#257)。
 */
import { initAuthSession } from '@ippoan/auth-client'

export default defineNuxtPlugin({
  name: 'auth',
  enforce: 'pre',
  setup() {
    const config = useRuntimeConfig()
    const backend = config.public.apiBackend as string

    if (backend !== 'rust-logi' && backend !== 'rust-alc-api') return

    // ?lw= の処理は server middleware (resolveAuthAction) 側で行うため off
    initAuthSession({ lineWorksParam: false })
  },
})
