/**
 * GET /api/uriage/r2-pending
 *
 * rust-ichiban (`/api/uriage/r2/pending`) への proxy。
 * R2 同期 verify-first orchestration で UI から叩く (Refs ohishi-exp/rust-ichibanboshi#43)。
 * `items[].ready` / `blocker` を含むので、UI は未検証 bucket を browser-side で
 * iterate /verify してから /api/uriage/r2-sync を叩く。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/uriage/r2/pending')
})
