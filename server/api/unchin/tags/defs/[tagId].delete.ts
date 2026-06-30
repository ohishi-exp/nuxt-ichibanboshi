/**
 * DELETE /api/unchin/tags/defs/:tagId
 *
 * タグ定義を削除する。紐づく得意先への割り当て (assignments) も合わせて削除する
 * (カスケード、孤立した assignment を残さない)。
 */
export default defineEventHandler(async (event) => {
  const tagId = getRouterParam(event, 'tagId') ?? ''
  if (!tagId) {
    throw createError({ statusCode: 400, statusMessage: 'tagId is required' })
  }

  const bucket = getUnchinR2Bucket(event)
  const defs = await loadTagDefs(bucket)
  const nextDefs = defs.filter(d => d.tag_id !== tagId)
  if (nextDefs.length === defs.length) {
    throw createError({ statusCode: 404, statusMessage: 'tag def not found' })
  }
  await saveTagDefs(bucket, nextDefs)

  const assignments = await loadTagAssignments(bucket)
  const nextAssignments = assignments.filter(a => a.tag_id !== tagId)
  if (nextAssignments.length !== assignments.length) {
    await saveTagAssignments(bucket, nextAssignments)
  }

  return { deleted: tagId }
})
