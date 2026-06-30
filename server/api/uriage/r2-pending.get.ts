/**
 * GET /api/uriage/r2-pending?from=YYYY-MM&to=YYYY-MM
 *
 * rust-ichiban (`/api/uriage/r2/pending`) への proxy。
 * R2 同期 verify-first orchestration で UI から叩く (Refs ohishi-exp/rust-ichibanboshi#43)。
 * `items[].ready` / `blocker` を含むので、UI は未検証 bucket を browser-side で
 * iterate /verify してから /api/uriage/r2-sync を叩く。
 *
 * `from` / `to` (YYYY-MM、両端 inclusive) を渡すと rust 側で期間 filter (Refs #50)。
 * 未指定なら全件 (cron / backward compat)。
 */
export default defineEventHandler(async (event) => {
  // salesApiFetch は内部で event の getQuery() を素通しするので、`?from=&to=` は
  // 自動で rust に転送される (= 個別に searchParams を組む必要なし)。
  return salesApiFetch(event, '/api/uriage/r2/pending')
})
