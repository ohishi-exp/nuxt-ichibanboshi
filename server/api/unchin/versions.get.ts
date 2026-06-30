/**
 * GET /api/unchin/versions?partner_type=&partner_code=
 *
 * R2 index オブジェクト (`unchin/index/{partner_type}/{partner_code}.json`) を読んで
 * バージョン一覧 (effective_from 降順) を返す。
 */
import type { PartnerType, UnchinVersionIndexEntry } from '~~/server/utils/unchin'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerType: PartnerType = query.partner_type === 'subcontractor' ? 'subcontractor' : 'customer'
  const partnerCode = typeof query.partner_code === 'string' ? query.partner_code : ''
  if (!partnerCode) {
    throw createError({ statusCode: 400, statusMessage: 'partner_code is required' })
  }

  const bucket = getUnchinR2Bucket(event)
  const obj = await bucket.get(unchinIndexKey(partnerType, partnerCode))
  const versions: UnchinVersionIndexEntry[] = obj ? JSON.parse(await obj.text()) : []

  return { partner_type: partnerType, partner_code: partnerCode, versions }
})
