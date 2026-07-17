// 社員ﾏｽﾀ一覧 (rust-ichibanboshi GET /api/employees の薄い proxy)。
// nuxt-trouble の担当者マスタ手動同期が service binding 経由で呼ぶ
// (Refs #120, ohishi-exp/rust-ichibanboshi#74, ippoan/nuxt-trouble#220)。
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/employees')
})
