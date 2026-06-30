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

/// CF Access ヘッダ (client_id + client_secret) を取得。`event` 無しでも動く形にして
/// scheduled handler (cron) からも同 util を使えるようにする。
export async function getCfAccessHeaders(event?: H3Event): Promise<{
  'CF-Access-Client-Id': string
  'CF-Access-Client-Secret': string
}> {
  const config = useRuntimeConfig()
  // event 経由 (HTTP) か、Nitro `useRuntimeConfig` の app secret 経由のどちらかで
  // CF_ACCESS_CLIENT_SECRET binding を取得する。cron では event が無い + cloudflare env
  // は Nitro `useNitroApp` の context にバインドされている前提 (runtime: cloudflare)。
  const cfEnv =
    (event?.context?.cloudflare as { env?: { CF_ACCESS_CLIENT_SECRET?: unknown } } | undefined)
      ?.env ?? (globalThis as { __env__?: { CF_ACCESS_CLIENT_SECRET?: unknown } }).__env__
  const clientSecret = await resolveSecret(cfEnv?.CF_ACCESS_CLIENT_SECRET)
  return {
    'CF-Access-Client-Id': config.cfAccessClientId,
    'CF-Access-Client-Secret': clientSecret,
  }
}

export async function salesApiFetch(event: H3Event, path: string) {
  const config = useRuntimeConfig()
  const query = getQuery(event)
  const qs = new URLSearchParams(query as Record<string, string>).toString()
  const url = `${config.salesApiBase}${path}${qs ? '?' + qs : ''}`

  const cfHeaders = await getCfAccessHeaders(event)
  // Authorization ヘッダーをクライアントから引き継ぐ
  const authHeader = getHeader(event, 'authorization') || ''

  const res = await fetch(url, {
    headers: {
      ...cfHeaders,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  })

  if (!res.ok) {
    throw createError({ statusCode: res.status, statusMessage: res.statusText })
  }

  return res.json()
}

/// rust-ichiban に POST する。query を `path` に直接含めるか、`searchParams` に分けて渡す。
/// `body` 不要 (rust 側 endpoint が body を見ない場合) なら省略。
export async function salesApiPost(
  event: H3Event,
  path: string,
  opts?: { searchParams?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  const config = useRuntimeConfig()
  const qs = opts?.searchParams
    ? '?' + new URLSearchParams(opts.searchParams).toString()
    : ''
  const url = `${config.salesApiBase}${path}${qs}`

  const cfHeaders = await getCfAccessHeaders(event)
  const authHeader = getHeader(event, 'authorization') || ''

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...cfHeaders,
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw createError({
      statusCode: res.status,
      statusMessage: res.statusText,
      data: text.slice(0, 500),
    })
  }
  return res.json()
}

/// 任意 path を GET し ArrayBuffer で返す (rust-ichiban の `/api/uriage/raw/:m/:e` 用)。
/// event 無し版 (cron 経由) も可。
export async function salesApiGetBytes(
  pathOrEvent: H3Event | string,
  pathIfEvent?: string,
): Promise<ArrayBuffer> {
  const config = useRuntimeConfig()
  const event = typeof pathOrEvent === 'string' ? undefined : pathOrEvent
  const path = typeof pathOrEvent === 'string' ? pathOrEvent : pathIfEvent!
  const url = `${config.salesApiBase}${path}`
  const cfHeaders = await getCfAccessHeaders(event)
  const res = await fetch(url, { headers: cfHeaders })
  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: `rust-ichiban GET ${path} failed`,
    })
  }
  return res.arrayBuffer()
}

/// 任意 path を POST (body 無し、認証 cron 用)。event 無し版あり。
export async function salesApiPostNoBody(
  pathOrEvent: H3Event | string,
  pathIfEvent?: string,
): Promise<void> {
  const config = useRuntimeConfig()
  const event = typeof pathOrEvent === 'string' ? undefined : pathOrEvent
  const path = typeof pathOrEvent === 'string' ? pathOrEvent : pathIfEvent!
  const url = `${config.salesApiBase}${path}`
  const cfHeaders = await getCfAccessHeaders(event)
  const res = await fetch(url, { method: 'POST', headers: cfHeaders })
  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: `rust-ichiban POST ${path} failed`,
    })
  }
}
