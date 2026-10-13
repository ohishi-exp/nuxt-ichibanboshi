/**
 * GET /api/uriage/daily?month=YYYY-MM&eigyosho_id=N&cal=true|false
 *
 * 売上 Worker (Service Binding URIAGE, `/api/uriage/daily`) への proxy。query 素通し。
 * Nitro auto-import で `uriageWorker` を読む (`server/utils/serviceBinding.ts`)。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/daily')
})
