/**
 * POST /api/uriage/recalc?month=YYYY-MM&eigyosho_id=N
 *
 * rust-ichiban (`/api/uriage/recalc`) への proxy。body 不要 (rust 側が
 * CakePHP から persons/other/bumon を pull する)。query は素通し。
 *
 * 戻り値の `jobs[]` は 各 (month, eigyosho_id) の結果 (computed / failed / skipped)。
 * クライアント (admin page) は jobs を表で表示する。
 *
 * Nitro auto-import で salesApiPost を読む (`server/utils/salesApi.ts` から)。
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, string>
  const searchParams: Record<string, string> = {}
  if (query.month) searchParams.month = query.month
  if (query.eigyosho_id) searchParams.eigyosho_id = query.eigyosho_id
  return salesApiPost(event, '/api/uriage/recalc', { searchParams })
})
