/**
 * GET /api/unchin/summary?from=&to=&partner_type=customer|subcontractor&kind=
 *
 * rust-ichibanboshi の `/api/unchin/summary`（SQL 側で SUM/GROUP BY 済み）をそのまま
 * 中継する。一覧ページの「得意先・傭車先ごとの合計金額」表示用
 * (Refs ohishi-exp/rust-ichibanboshi#57 — raw 行 TOP-N 方式だと一部取引先が行数を
 * 食い潰して他が表示されなくなる問題があったため、SQL 側集計に切り替えた)。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/unchin/summary')
})
