/**
 * GET /api/unchin/versions/:versionId?partner_type=&partner_code=
 *
 * R2 data オブジェクト (`unchin/data/{partner_type}/{partner_code}/{versionId}.json`)
 * を読んで、その時点で確定した運賃グループ一覧を返す。
 */
import type { PartnerType, UnchinGroup } from '~~/server/utils/unchin'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerType: PartnerType = query.partner_type === 'subcontractor' ? 'subcontractor' : 'customer'
  const partnerCode = typeof query.partner_code === 'string' ? query.partner_code : ''
  const versionId = getRouterParam(event, 'versionId') ?? ''
  if (!partnerCode || !versionId) {
    throw createError({ statusCode: 400, statusMessage: 'partner_code and versionId are required' })
  }

  const bucket = getUnchinR2Bucket(event)
  const obj = await bucket.get(unchinDataKey(partnerType, partnerCode, versionId))
  if (!obj) {
    throw createError({ statusCode: 404, statusMessage: 'version not found' })
  }
  const items: UnchinGroup[] = JSON.parse(await obj.text())

  return { partner_type: partnerType, partner_code: partnerCode, version_id: versionId, items }
})
