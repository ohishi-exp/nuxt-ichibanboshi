/**
 * POST /api/unchin/versions
 *
 * 値上げ確定操作。body の運賃グループを新バージョンとして R2 (`unchin/data/...`) に
 * 保存し、index (`unchin/index/...`) に追記する。
 *
 * 登録者 (`registered_by`) は `logi_auth_token` cookie の JWT から email を取り出して
 * 記録する（自動検知ではなくユーザー操作で保存し、誰が登録したか残す設計。#57 確定事項）。
 * 署名検証はしない — この cookie は既に `server/middleware/auth.ts` の tenant gate を
 * 通過済みの値であり、ここでは email を audit trail として記録するだけの用途のため。
 */
import { decodeJwtPayloadFromToken } from '@ippoan/auth-client/server'
import type { PartnerType, UnchinGroup, UnchinVersionIndexEntry } from '~~/server/utils/unchin'

interface SaveVersionBody {
  partner_type?: string
  partner_code?: string
  effective_from?: string
  items?: UnchinGroup[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SaveVersionBody>(event)
  if (!body?.partner_code || !body.effective_from || !Array.isArray(body.items) || body.items.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'partner_code, effective_from, items (非空配列) は必須',
    })
  }
  const partnerType: PartnerType = body.partner_type === 'subcontractor' ? 'subcontractor' : 'customer'
  const partnerCode = body.partner_code

  const cookie = getCookie(event, 'logi_auth_token')
  const claims: Record<string, unknown> = cookie ? decodeJwtPayloadFromToken(cookie) : {}
  const registeredBy =
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.username === 'string' && claims.username) ||
    'unknown'

  const bucket = getUnchinR2Bucket(event)
  const indexKey = unchinIndexKey(partnerType, partnerCode)
  const existingObj = await bucket.get(indexKey)
  const existing: UnchinVersionIndexEntry[] = existingObj ? JSON.parse(await existingObj.text()) : []

  const versionId = buildVersionId(body.effective_from, existing)
  const registeredAt = new Date().toISOString()
  const sortedItems = [...body.items].sort((a, b) => b.fare - a.fare)

  await bucket.put(unchinDataKey(partnerType, partnerCode, versionId), JSON.stringify(sortedItems), {
    httpMetadata: { contentType: 'application/json' },
  })

  const entry: UnchinVersionIndexEntry = {
    version_id: versionId,
    effective_from: body.effective_from,
    registered_by: registeredBy,
    registered_at: registeredAt,
    item_count: sortedItems.length,
  }
  const nextIndex = sortVersionIndex([entry, ...existing])
  await bucket.put(indexKey, JSON.stringify(nextIndex), {
    httpMetadata: { contentType: 'application/json' },
  })

  return { version_id: versionId, registered_by: registeredBy, registered_at: registeredAt }
})
