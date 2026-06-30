/**
 * POST /api/unchin/tags/assignments
 *
 * 得意先・傭車先にタグを割り当てる。1 つの得意先が複数タグに所属することもある
 * (多対多、#57 follow-up)。同一 (partner_type, partner_code, tag_id) の重複割り当ては
 * 既存を返す (冪等)。`assigned_at` (付与日) を記録するだけで、有効期間は持たない
 * (#57 follow-up で「タグ付与日を記録」に確定)。`note` は例外・備考用。
 */
import { decodeJwtPayloadFromToken } from '@ippoan/auth-client/server'
import type { PartnerType, UnchinPartnerTagAssignment } from '~~/server/utils/unchin'

interface CreateAssignmentBody {
  partner_type?: string
  partner_code?: string
  tag_id?: string
  note?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateAssignmentBody>(event)
  const partnerType: PartnerType = body?.partner_type === 'subcontractor' ? 'subcontractor' : 'customer'
  const partnerCode = (body?.partner_code ?? '').trim()
  const tagId = (body?.tag_id ?? '').trim()
  const note = (body?.note ?? '').trim()
  if (!partnerCode || !tagId) {
    throw createError({ statusCode: 400, statusMessage: 'partner_code と tag_id は必須' })
  }

  const bucket = getUnchinR2Bucket(event)
  const defs = await loadTagDefs(bucket)
  if (!defs.some(d => d.tag_id === tagId)) {
    throw createError({ statusCode: 404, statusMessage: 'tag def not found' })
  }

  const assignments = await loadTagAssignments(bucket)
  const existing = assignments.find(
    a => a.partner_type === partnerType && a.partner_code === partnerCode && a.tag_id === tagId,
  )
  if (existing) return existing

  const cookie = getCookie(event, 'logi_auth_token')
  const claims: Record<string, unknown> = cookie ? decodeJwtPayloadFromToken(cookie) : {}
  const assignedBy =
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.username === 'string' && claims.username) ||
    'unknown'

  const assignmentId = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const entry: UnchinPartnerTagAssignment = {
    assignment_id: assignmentId,
    partner_type: partnerType,
    partner_code: partnerCode,
    tag_id: tagId,
    note,
    assigned_by: assignedBy,
    assigned_at: new Date().toISOString(),
  }
  await saveTagAssignments(bucket, [entry, ...assignments])

  return entry
})
