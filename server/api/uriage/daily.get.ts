/**
 * GET /api/uriage/daily?month=YYYY-MM&eigyosho_id=N&cal=true|false
 *
 * rust-ichiban (`/api/uriage/daily`) への proxy。query 素通し。
 * Nitro auto-import で `salesApiFetch` を読む (`server/utils/salesApi.ts`)。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/uriage/daily')
})
