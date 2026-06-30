/**
 * POST /api/unchin/alias/items
 *
 * 品名コードの手動エイリアスグループ (または「同一視しない」例外記録) を新規作成する。
 * 「この品名Cとこの品名Cは同一」をユーザーが手動登録する機能 (#57 確定事項、表示名
 * 一致による自動マージはしない)。`kind: 'exception'` を指定すると、似ているが
 * 意図的に同一視しない品名コードの組を備忘として記録できる (#57 follow-up)。
 * 登録者は `versions.post.ts` と同じく `logi_auth_token` cookie の JWT から
 * email を取り出して記録する。
 */
import { decodeJwtPayloadFromToken } from '@ippoan/auth-client/server'
import type { UnchinItemAliasGroup } from '~~/server/utils/unchin'

interface CreateAliasGroupBody {
  label?: string
  item_codes?: string[]
  kind?: string
  note?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateAliasGroupBody>(event)
  const label = (body?.label ?? '').trim()
  const itemCodes = Array.isArray(body?.item_codes)
    ? [...new Set(body.item_codes.map(c => String(c).trim()).filter(Boolean))]
    : []
  const kind: UnchinItemAliasGroup['kind'] = body?.kind === 'exception' ? 'exception' : 'merge'
  const note = (body?.note ?? '').trim()
  if (!label || itemCodes.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'label と item_codes (2件以上) は必須',
    })
  }

  const cookie = getCookie(event, 'logi_auth_token')
  const claims: Record<string, unknown> = cookie ? decodeJwtPayloadFromToken(cookie) : {}
  const registeredBy =
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.username === 'string' && claims.username) ||
    'unknown'

  const bucket = getUnchinR2Bucket(event)
  const groups = await loadItemAliasGroups(bucket)

  const groupId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const entry: UnchinItemAliasGroup = {
    group_id: groupId,
    label,
    item_codes: itemCodes,
    kind,
    note,
    registered_by: registeredBy,
    registered_at: new Date().toISOString(),
  }
  const next = [entry, ...groups]
  await saveItemAliasGroups(bucket, next)

  return entry
})
