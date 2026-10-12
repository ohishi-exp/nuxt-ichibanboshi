/**
 * POST /api/uriage/admin/delete?month=YYYY-MM&eigyosho_id=N
 *
 * 売上 Worker `/api/uriage/admin/delete` への proxy (1 bucket 削除)。
 * 削除後に再 recalc を叩けば fresh な集計になる。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/admin/delete', { method: 'POST', write: true })
})
