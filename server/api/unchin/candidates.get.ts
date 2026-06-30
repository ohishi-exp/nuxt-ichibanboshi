/**
 * GET /api/unchin/candidates?from=&to=&partner_type=customer|subcontractor&kind=
 *
 * rust-ichibanboshi の `/api/unchin/candidates` を呼び、
 * `(partner_code, item_code, fare)` でグルーピングして積卸ペア配列を返す。
 * グルーピングロジックは `server/utils/unchin.ts` の `groupUnchinRows`
 * (Refs ohishi-exp/rust-ichibanboshi#57)。
 *
 * 品名コードの手動エイリアスグループ (R2 `unchin/alias/item-groups.json`) が
 * 登録されていれば、それも適用してグルーピングする (表示名一致による自動マージはしない)。
 */
import type { UnchinCandidateRow } from '~~/server/utils/unchin'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerType = query.partner_type === 'subcontractor' ? 'subcontractor' : 'customer'

  const res = (await salesApiFetch(event, '/api/unchin/candidates')) as {
    source_table: string
    data: UnchinCandidateRow[]
  }

  // R2 binding が無い環境でもライブ候補閲覧自体は止めない (alias 機能だけ無効化)
  let aliasLookup: ReturnType<typeof buildItemAliasLookup> | undefined
  try {
    const bucket = getUnchinR2Bucket(event)
    aliasLookup = buildItemAliasLookup(await loadItemAliasGroups(bucket))
  } catch {
    aliasLookup = undefined
  }

  return {
    partner_type: partnerType,
    source_table: res.source_table,
    groups: groupUnchinRows(res.data, aliasLookup),
  }
})
