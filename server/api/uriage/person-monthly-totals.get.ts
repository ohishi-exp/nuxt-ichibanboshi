/**
 * GET /api/uriage/person-monthly-totals?from=YYYY-MM&to=YYYY-MM&cal=true
 *
 * rust-ichiban (`/api/uriage/person-monthly-totals`) への proxy。
 * 期間内の月 × 担当者 SUM (全営業所合算) を返す。
 * 担当者順位推移 bump chart の data source。
 */
export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/uriage/person-monthly-totals')
})
