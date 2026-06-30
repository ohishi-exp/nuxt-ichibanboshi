/**
 * GET /api/uriage/verify-debug?id=N&date=YYYY-MM-DD&cal=true|false
 *
 * rust-ichiban (`/api/uriage/verify-debug`) への proxy。
 * NG 行の diff 展開エリアから自動 fetch する診断 endpoint
 * (rust-ichibanboshi#54、user 2026-06-30 「NG のとこにだせば?」「売上年月日とってるか確認できる?」)。
 *
 * response の `rows[].uriage_date` で「売上年月日 vs 運行年月日 のズレ」が見える。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/uriage/verify-debug')
})
