/**
 * GET /api/uriage/r2-pending?from=YYYY-MM&to=YYYY-MM
 *
 * 売上 Worker (Service Binding URIAGE, `/api/uriage/r2/pending`) への proxy。
 * R2 に未反映の bucket 一覧 (Refs ohishi-exp/rust-ichibanboshi#43)。
 *
 * `from` / `to` (YYYY-MM、両端 inclusive) を渡すと rust 側で期間 filter (Refs #50)。
 * 未指定なら全件 (cron / backward compat)。
 */
export default defineEventHandler(async (event) => {
  // uriageWorker は event の getQuery() を素通しするので、`?from=&to=` は自動で転送される。
  return uriageWorker(event, '/api/uriage/r2/pending')
})
