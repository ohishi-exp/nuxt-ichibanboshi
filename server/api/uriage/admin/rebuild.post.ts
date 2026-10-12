/**
 * POST /api/uriage/admin/rebuild
 *
 * 売上 Worker `/api/uriage/admin/rebuild` への proxy (フルリセット、
 * 全 table/view DROP + 再 migrate)。集計データは全て消える。
 * 呼び出し後は recalc を叩き直す必要あり。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/admin/rebuild', { method: 'POST', write: true })
})
