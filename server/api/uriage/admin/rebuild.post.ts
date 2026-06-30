/**
 * POST /api/uriage/admin/rebuild
 *
 * rust-ichiban `/api/uriage/admin/rebuild` への proxy (フルリセット、
 * 全 table/view DROP + 再 migrate)。集計データは全て消える。
 * 呼び出し後は recalc を叩き直す必要あり。
 */
export default defineEventHandler(async (event) => {
  return salesApiPost(event, '/api/uriage/admin/rebuild')
})
