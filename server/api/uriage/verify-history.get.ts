/**
 * GET /api/uriage/verify-history?from=YYYY-MM-DD&to=YYYY-MM-DD&eigyosho_id=N
 *
 * 売上 Worker (Service Binding URIAGE, `/api/uriage/verify-history`) への proxy。
 * verify_jobs を範囲指定で読む (UI 履歴表示用、Refs ohishi-exp/rust-ichibanboshi#43)。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/verify-history')
})
