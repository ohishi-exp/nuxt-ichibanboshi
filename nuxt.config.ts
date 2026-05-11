export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  ssr: false,

  runtimeConfig: {
    // サーバーサイド専用（ブラウザに漏れない）
    salesApiBase: process.env.NUXT_SALES_API_BASE || 'http://localhost:3100',
    cfAccessClientId: process.env.NUXT_CF_ACCESS_CLIENT_ID || '',
    cfAccessClientSecret: process.env.NUXT_CF_ACCESS_CLIENT_SECRET || '',
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

  modules: ['@nuxtjs/tailwindcss'],

  build: {
    transpile: ['echarts', 'vue-echarts', 'resize-detector', '@ippoan/auth-client'],
  },
})
