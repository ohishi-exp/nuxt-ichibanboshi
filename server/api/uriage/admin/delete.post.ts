/**
 * POST /api/uriage/admin/delete?month=YYYY-MM&eigyosho_id=N
 *
 * rust-ichiban `/api/uriage/admin/delete` への proxy (1 bucket 削除)。
 * 削除後に再 recalc を叩けば fresh fingerprint で R2 sync 対象になる。
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, string>
  const searchParams: Record<string, string> = {}
  if (query.month) searchParams.month = query.month
  if (query.eigyosho_id) searchParams.eigyosho_id = query.eigyosho_id
  return salesApiPost(event, '/api/uriage/admin/delete', { searchParams })
})
