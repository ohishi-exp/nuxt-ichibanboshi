/**
 * GET /api/unchin/alias/items
 *
 * 品名コードの手動エイリアスグループ一覧を返す (R2 `unchin/alias/item-groups.json`)。
 */
export default defineEventHandler(async (event) => {
  const bucket = getUnchinR2Bucket(event)
  const groups = await loadItemAliasGroups(bucket)
  return { groups }
})
