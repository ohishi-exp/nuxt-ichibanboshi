/**
 * DELETE /api/unchin/tags/assignments/:assignmentId
 *
 * 得意先・傭車先からタグの割り当てを解除する。
 */
export default defineEventHandler(async (event) => {
  const assignmentId = getRouterParam(event, 'assignmentId') ?? ''
  if (!assignmentId) {
    throw createError({ statusCode: 400, statusMessage: 'assignmentId is required' })
  }

  const bucket = getUnchinR2Bucket(event)
  const assignments = await loadTagAssignments(bucket)
  const next = assignments.filter(a => a.assignment_id !== assignmentId)
  if (next.length === assignments.length) {
    throw createError({ statusCode: 404, statusMessage: 'assignment not found' })
  }
  await saveTagAssignments(bucket, next)

  return { deleted: assignmentId }
})
