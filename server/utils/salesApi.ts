import type { H3Event } from 'h3'

// CF Access client_secret は CF Secrets Store binding (CF_ACCESS_CLIENT_SECRET) から取る。
// wrangler secret (NUXT_CF_ACCESS_CLIENT_SECRET、read 不可) をやめ、824a8b3c のペアに統一。
// nitro cloudflare_module では event.context.cloudflare.env に binding が入り、
// Secrets Store binding は `.get()` で値を返す (string 直値もそのまま受ける)。
async function resolveSecret(binding: unknown): Promise<string> {
  if (typeof binding === 'string') return binding
  if (binding && typeof (binding as { get?: unknown }).get === 'function') {
    return (await (binding as { get(): Promise<string> }).get()) ?? ''
  }
  return ''
}

export async function salesApiFetch(event: H3Event, path: string) {
  const config = useRuntimeConfig()
  const query = getQuery(event)
  const qs = new URLSearchParams(query as Record<string, string>).toString()
  const url = `${config.salesApiBase}${path}${qs ? '?' + qs : ''}`

  const env = (
    event.context.cloudflare as { env?: { CF_ACCESS_CLIENT_SECRET?: unknown } } | undefined
  )?.env
  const clientSecret = await resolveSecret(env?.CF_ACCESS_CLIENT_SECRET)

  // Authorization ヘッダーをクライアントから引き継ぐ
  const authHeader = getHeader(event, 'authorization') || ''

  const res = await fetch(url, {
    headers: {
      'CF-Access-Client-Id': config.cfAccessClientId,
      'CF-Access-Client-Secret': clientSecret,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  })

  if (!res.ok) {
    throw createError({ statusCode: res.status, statusMessage: res.statusText })
  }

  return res.json()
}
