// 社員ﾏｽﾀ一覧 (上流は一番星 Worker の GET /api/employees、Service Binding ICHIBAN_DB 経由の薄い proxy)。
// nuxt-trouble の担当者マスタ手動同期が service binding 経由で呼ぶ
// (Refs #120, ohishi-exp/rust-ichibanboshi#74, ippoan/nuxt-trouble#220)。
export default defineEventHandler(async (event) => {
  return ichibanWorkerFetch(event, '/api/employees')
})
