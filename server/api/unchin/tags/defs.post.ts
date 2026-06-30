/**
 * POST /api/unchin/tags/defs
 *
 * 得意先・傭車先タグの定義を新規作成する。「値上げ候補」「サーチャージ導入候補」
 * 「除外」等、ユーザーが自由にタグ名を追加できる (#57 follow-up)。同じ label が
 * 既にあれば新規作成せず既存を返す (重複防止)。
 */
import { decodeJwtPayloadFromToken } from '@ippoan/auth-client/server'
import type { UnchinPartnerTagDef } from '~~/server/utils/unchin'

interface CreateTagDefBody {
  label?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateTagDefBody>(event)
  const label = (body?.label ?? '').trim()
  if (!label) {
    throw createError({ statusCode: 400, statusMessage: 'label は必須' })
  }

  const bucket = getUnchinR2Bucket(event)
  const defs = await loadTagDefs(bucket)

  const existing = defs.find(d => d.label === label)
  if (existing) return existing

  const cookie = getCookie(event, 'logi_auth_token')
  const claims: Record<string, unknown> = cookie ? decodeJwtPayloadFromToken(cookie) : {}
  const registeredBy =
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.username === 'string' && claims.username) ||
    'unknown'

  const tagId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const entry: UnchinPartnerTagDef = {
    tag_id: tagId,
    label,
    registered_by: registeredBy,
    registered_at: new Date().toISOString(),
  }
  await saveTagDefs(bucket, [entry, ...defs])

  return entry
})
