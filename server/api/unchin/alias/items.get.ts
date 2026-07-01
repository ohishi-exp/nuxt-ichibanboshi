/**
 * GET /api/unchin/alias/items?partner_type=&partner_code=
 *
 * 品名コードの手動エイリアスグループ一覧を返す (R2 `unchin/alias/item-groups.json`)。
 * `partner_type`/`partner_code` を渡すとその得意先・傭車先のグループだけに絞り込む
 * (#92 follow-up、省略時は全件)。
 */
import type { PartnerType } from '~~/server/utils/unchin'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const bucket = getUnchinR2Bucket(event)
  const groups = await loadItemAliasGroups(bucket)

  const partnerType = query.partner_type === 'subcontractor' || query.partner_type === 'customer'
    ? (query.partner_type as PartnerType)
    : undefined
  const partnerCode = typeof query.partner_code === 'string' ? query.partner_code : undefined

  if (!partnerType && !partnerCode) {
    return { groups }
  }
  const filtered = groups.filter((g) => {
    if (partnerType && g.partner_type !== partnerType) return false
    if (partnerCode && g.partner_code !== partnerCode) return false
    return true
  })
  return { groups: filtered }
})
