/**
 * POST /api/uriage/recalc?month=YYYY-MM&eigyosho_id=N
 *
 * 売上 Worker (Service Binding URIAGE) への proxy。body 不要、query は素通し。
 * Worker が recalc のたびに R2 へ直接 put する。
 *
 * 戻り値の `jobs[]` は 各 (month, eigyosho_id) の結果 (computed / failed / skipped)。
 * クライアント (admin page) は jobs を表で表示する。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/recalc', { method: 'POST', write: true })
})
