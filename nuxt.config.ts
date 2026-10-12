export default defineNuxtConfig({
  // auth-client の SSR 認証状態 (opt-in、Refs ippoan/auth-worker#560)。
  // server が cookie から認証の判定 (expiresAt / orgId / username) を決めて useState に載せる。
  // payload に生 JWT は載らない。戻すときはこの 1 行を消す。
  ippoanAuthClient: { authState: true },
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  ssr: false,

  runtimeConfig: {
    // サーバーサイド専用（ブラウザに漏れない）
    salesApiBase: process.env.NUXT_SALES_API_BASE || 'http://localhost:3100',
    cfAccessClientId: process.env.NUXT_CF_ACCESS_CLIENT_ID || '',
    // cfAccessClientSecret は廃止 — CF Secrets Store binding (CF_ACCESS_CLIENT_SECRET) を
    // salesApi.ts が event.context.cloudflare.env から直接読む (wrangler secret 廃止)。
    // staging では空 (未設定) にして auth-worker (APP_TENANT_ACL) に gate を集約。
    // prod は本番一番星 tenant_id を引き続き設定 (後日 APP_TENANT_ACL に移行予定)。
    allowedTenantId: process.env.NUXT_ALLOWED_TENANT_ID || '',
    public: {
      alcApiBase: process.env.NUXT_PUBLIC_ALC_API_BASE || 'http://localhost:8080',
      authWorkerUrl: process.env.NUXT_PUBLIC_AUTH_WORKER_URL || '',
      apiBackend: 'rust-alc-api',
      googleClientId: process.env.NUXT_PUBLIC_GOOGLE_CLIENT_ID || '',
    },
  },

  nitro: {
    preset: 'cloudflare_module',
  },

  css: ['~/assets/css/main.css'],

  // chunk load 失敗 (immutable キャッシュされた `/_nuxt/*.js` の 404) からの自動復旧。
  // `experimental.emitRouteChunkError = 'manual'` と transpile 登録も module 側が行う
  // ので consumer は 1 行で済む (Refs ippoan/auth-worker#452)。
  modules: ['@nuxtjs/tailwindcss', '@ippoan/auth-client/module'],

  build: {
    transpile: ['echarts', 'vue-echarts', 'resize-detector', '@ippoan/auth-client'],
  },
})
