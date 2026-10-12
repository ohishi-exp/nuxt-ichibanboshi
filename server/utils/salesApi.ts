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

type ServiceBinding = { fetch(r: Request): Promise<Response> }

/**
 * Service Binding (wrangler.toml の `[[services]]`) 越しに Worker を叩いて JSON を返す。
 * `workerName` は Request URL の host にだけ使う (Service Binding は host を見ない)。
 * 失敗は salesApiPost と同じく本文の先頭 500 字を `data` に付ける。Refs ohishi-exp/rust-ichibanboshi#322
 */
async function serviceBindingFetch(
  event: H3Event,
  bindingName: string,
  workerName: string,
  path: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  const env = (event.context.cloudflare as { env?: Record<string, unknown> } | undefined)?.env
  const binding = env?.[bindingName] as ServiceBinding | undefined
  if (!binding || typeof binding.fetch !== 'function') {
    throw createError({ statusCode: 503, statusMessage: `${bindingName} service binding is not configured` })
  }
  const res = await binding.fetch(new Request(`https://${workerName}${path}`, {
    method: opts?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts?.headers,
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  }))
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw createError({ statusCode: res.status, statusMessage: res.statusText, data: text.slice(0, 500) })
  }
  return res.json()
}

function withQuery(event: H3Event, path: string): string {
  const qs = new URLSearchParams(getQuery(event) as Record<string, string>).toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * 一番星 Worker (Service Binding ICHIBAN_DB) から JSON を取る。対象は Worker にある口だけ
 * (一番星の 15 本: employees・departments・sales 9・unchin 4)。Refs ohishi-exp/rust-ichibanboshi#322
 */
export async function ichibanWorkerFetch(event: H3Event, path: string) {
  return serviceBindingFetch(event, 'ICHIBAN_DB', 'ichibanboshi-ichiban', withQuery(event, path))
}

/**
 * 売上 Worker (Service Binding URIAGE) を叩く。query は素通し。
 * `write: true` のときだけ Secrets Store `URIAGE_WRITE_TOKEN` を `X-Uriage-Write-Token` に付ける。
 */
export async function uriageWorker(
  event: H3Event,
  path: string,
  opts?: { method?: 'GET' | 'POST'; write?: boolean },
) {
  const headers: Record<string, string> = {}
  if (opts?.write) {
    const env = (event.context.cloudflare as { env?: { URIAGE_WRITE_TOKEN?: unknown } } | undefined)?.env
    const token = await resolveSecret(env?.URIAGE_WRITE_TOKEN)
    if (!token) throw createError({ statusCode: 503, statusMessage: 'URIAGE_WRITE_TOKEN is not configured' })
    headers['X-Uriage-Write-Token'] = token
  }
  return serviceBindingFetch(event, 'URIAGE', 'ichibanboshi-uriage', withQuery(event, path), {
    method: opts?.method ?? 'GET',
    headers,
  })
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
