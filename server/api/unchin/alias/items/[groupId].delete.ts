/**
 * DELETE /api/unchin/alias/items/:groupId
 *
 * 品名コードの手動エイリアスグループを削除する。
 */
export default defineEventHandler(async (event) => {
  const groupId = getRouterParam(event, 'groupId') ?? ''
  if (!groupId) {
    throw createError({ statusCode: 400, statusMessage: 'groupId is required' })
  }

  const bucket = getUnchinR2Bucket(event)
  const groups = await loadItemAliasGroups(bucket)
  const next = groups.filter(g => g.group_id !== groupId)
  if (next.length === groups.length) {
    throw createError({ statusCode: 404, statusMessage: 'alias group not found' })
  }
  await saveItemAliasGroups(bucket, next)

  return { deleted: groupId }
})
