/**
 * GET /api/unchin/candidates?from=&to=&partner_type=customer|subcontractor&limit=
 *
 * rust-ichibanboshi の `/api/unchin/candidates` を呼び、
 * `(partner_code, item_code, fare)` でグルーピングして積卸ペア配列を返す。
 * グルーピングロジックは `server/utils/unchin.ts` の `groupUnchinRows`
 * (Refs ohishi-exp/rust-ichibanboshi#57)。
 */
import type { UnchinCandidateRow } from '~~/server/utils/unchin'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerType = query.partner_type === 'subcontractor' ? 'subcontractor' : 'customer'

  const res = (await salesApiFetch(event, '/api/unchin/candidates')) as {
    source_table: string
    data: UnchinCandidateRow[]
  }

  return {
    partner_type: partnerType,
    source_table: res.source_table,
    groups: groupUnchinRows(res.data),
  }
})
