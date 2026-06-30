/**
 * GET /api/uriage/recalc-jobs?from=YYYY-MM&to=YYYY-MM
 *
 * rust-ichiban (`/api/uriage/recalc-jobs`) への proxy。
 * recalc_jobs を月範囲で取得 (Refs ohishi-exp/rust-ichibanboshi#47)。
 * UI が「対象期間で recalc 済/未実行/同期済」の状態サマリを出すために使う。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/uriage/recalc-jobs')
})
