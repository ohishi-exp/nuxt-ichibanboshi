import type { H3Event } from 'h3'

export async function salesApiFetch(event: H3Event, path: string) {
  const config = useRuntimeConfig()
  const query = getQuery(event)
  const qs = new URLSearchParams(query as Record<string, string>).toString()
  const url = `${config.salesApiBase}${path}${qs ? '?' + qs : ''}`

  // Authorization ヘッダーをクライアントから引き継ぐ
  const authHeader = getHeader(event, 'authorization') || ''

  const res = await fetch(url, {
    headers: {
      'CF-Access-Client-Id': config.cfAccessClientId,
      'CF-Access-Client-Secret': config.cfAccessClientSecret,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  })

  if (!res.ok) {
    throw createError({ statusCode: res.status, statusMessage: res.statusText })
  }

  return res.json()
}
