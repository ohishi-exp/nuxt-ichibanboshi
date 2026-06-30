export default defineNuxtConfig({
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
    // 担当者別売上 R2 同期 cron。15 分おきに rust-ichiban `/api/uriage/r2/pending` を
    // polling → fingerprint 変化があった raw NDJSON.gz を R2 (URIAGE_R2) に
    // upload + ack する (Refs ohishi-exp/rust-ichibanboshi#37 Phase 2 PR-D)。
    // 実 cron トリガーは wrangler.toml の [triggers] crons にも同じ式を宣言する
    // (両方必要)。
    experimental: { tasks: true },
    scheduledTasks: {
      // task 名は server/tasks/ からのパス由来
      // (server/tasks/uriage-r2-sync.ts → 'uriage-r2-sync')。
      '*/15 * * * *': ['uriage-r2-sync'],
    },
  },

  css: ['~/assets/css/main.css'],

  modules: ['@nuxtjs/tailwindcss'],

  build: {
    transpile: ['echarts', 'vue-echarts', 'resize-detector', '@ippoan/auth-client'],
  },
})
