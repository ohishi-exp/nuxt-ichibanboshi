/**
 * GET /api/unchin/customer-net?from=&to=&kind=
 *
 * rust-ichibanboshi の `/api/unchin/customer-net` をそのまま中継する。
 * 得意先ごとに、請求合計 (total_sales) とその運行で傭車を使った分の支払合計
 * (total_payment)、差額 (diff、粗利に相当) を返す
 * (Refs ohishi-exp/rust-ichibanboshi#68 — 「同一運行内の両建て」を得意先軸で見たもの。
 * user 2026-07-01「傭車先じゃなくて得意先にグラフ直して」)。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/unchin/customer-net')
})
