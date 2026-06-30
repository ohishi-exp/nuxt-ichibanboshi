/**
 * GET /api/uriage/verify?id=N&date=YYYY-MM-DD&cal=true|false
 *
 * rust-ichiban (`/api/uriage/verify`) への proxy。query 素通し。
 * 単日 × 営業所 × cal の PHP vs Rust diff を返す (Refs ohishi-exp/rust-ichibanboshi#41)。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/uriage/verify')
})
