/**
 * GET /api/unchin/tags/assignments?partner_type=&partner_code=
 *
 * 得意先・傭車先タグの割り当て一覧を返す。`partner_type`/`partner_code` を渡すと
 * その得意先・傭車先の割り当てだけに絞り込む (省略時は全件、一覧ページのフィルタ用)。
 */
import type { PartnerType } from '~~/server/utils/unchin'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const bucket = getUnchinR2Bucket(event)
  const assignments = await loadTagAssignments(bucket)

  const partnerType = query.partner_type === 'subcontractor' || query.partner_type === 'customer'
    ? (query.partner_type as PartnerType)
    : undefined
  const partnerCode = typeof query.partner_code === 'string' ? query.partner_code : undefined

  const filtered = assignments.filter((a) => {
    if (partnerType && a.partner_type !== partnerType) return false
    if (partnerCode && a.partner_code !== partnerCode) return false
    return true
  })

  return { assignments: filtered }
})
