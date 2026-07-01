/**
 * GET /api/unchin/subcontractor-net?from=&to=&kind=
 *
 * rust-ichibanboshi の `/api/unchin/subcontractor-net` をそのまま中継する。
 * 傭車先ごとに、その傭車先が使われた運行の得意先請求合計 (total_sales) と
 * その傭車先への支払合計 (total_payment)、差額 (diff) を返す
 * (Refs ohishi-exp/rust-ichibanboshi#66 — 「同一運行内の両建て」方式)。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/unchin/subcontractor-net')
})
