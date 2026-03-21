export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  const token = body?.token

  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Token required' })
  }

  // JWT payload をデコード（署名検証はrust-alc-apiが済み）
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.tenant_id !== config.allowedTenantId) {
      throw createError({ statusCode: 403, statusMessage: 'このアカウントではアクセスできません' })
    }
    return { ok: true }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({ statusCode: 400, statusMessage: 'Invalid token' })
  }
})
