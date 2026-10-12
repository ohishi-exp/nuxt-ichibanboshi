/**
 * GET /api/uriage/verify?id=N&date=YYYY-MM-DD&cal=true|false
 *
 * 売上 Worker (Service Binding URIAGE) への proxy。query 素通し。
 * 単日 × 営業所 × cal の PHP vs Rust diff を返す (Refs ohishi-exp/rust-ichibanboshi#41)。
 * Worker 側は verify を POST (+ write token) で受けるので、画面には GET のまま見せて
 * ここで POST に変える。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/verify', { method: 'POST', write: true })
})
