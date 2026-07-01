/**
 * GET /api/unchin/customer-net-detail?from=&to=&kind=&code=&h=
 *
 * rust-ichibanboshi の `/api/unchin/customer-net-detail` をそのまま中継する。
 * 特定の得意先 (code=得意先C, h=得意先H) について、運行単位の請求 (sales)・
 * 傭車支払 (payment)・行単位の差額 (diff) を返す (`/customer-net` のドリルダウン、
 * Refs ohishi-exp/rust-ichibanboshi#68)。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/unchin/customer-net-detail')
})
