/**
 * 担当者別売上 R2 同期ロジック (Refs ohishi-exp/rust-ichibanboshi#37 = Phase 2 PR-C2/D)。
 *
 * rust-ichiban の `/api/uriage/r2/pending` を polling し、各 entry の raw NDJSON.gz を
 * `/api/uriage/raw/:month/:eigyosho_id` から fetch → R2 にコピー → `/ack` を叩く。
 *
 * 純粋関数として書き、event なし版 (cron) と event 付き版 (HTTP) の両方から使えるように
 * している (Cloudflare scheduled context では `cloudflare:workers` の `env` から binding
 * を取るため、event は持てない)。
 */
import type { H3Event } from 'h3'

export interface R2PendingItem {
  month: string
  eigyosho_id: number
  raw_path: string
  fingerprint_after: string
  computed_at: string
  /** verify_jobs に存在する (date, cal) 行数 (全 cal 合計) */
  verified_count: number
  /** verify_jobs.ok=1 の行数 */
  verified_ok: number
  /** verify_jobs.ok=0 の行数 */
  verified_ng: number
  /** 月の日数 × 2 cal (= 完全 verify を満たす期待 cell 数) */
  expected_count: number
  /** `true` なら sync 進めて良い */
  ready: boolean
  /** `'ng_present'` (NGあり) | `'unverified'` (cells 不足) | `null` */
  blocker: 'ng_present' | 'unverified' | null
}

export interface R2PendingResponse {
  count: number
  items: R2PendingItem[]
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>
}

export interface UriageSyncResult {
  attempted: number
  uploaded: number
  acked: number
  failures: Array<{ month: string; eigyosho_id: number; stage: string; error: string }>
  /** verify gate で sync が skip された bucket (reason 内訳付き) */
  skipped: Array<{
    month: string
    eigyosho_id: number
    reason: 'unverified' | 'ng_present'
    verified_count: number
    verified_ng: number
    expected_count: number
  }>
}

/**
 * R2 オブジェクトキー規約: `uriage/{month}/eigyosho-{id}.ndjson.gz`
 *
 * rust 側の disk path (`/opt/ichibanboshi/raw/{month}/eigyosho-{id}.ndjson.gz`) と
 * 1:1 で対応する。R2 prefix `uriage/` で他データと分離。
 */
export function r2Key(month: string, eigyoshoId: number): string {
  return `uriage/${month}/eigyosho-${eigyoshoId}.ndjson.gz`
}

/**
 * 1 entry を R2 に sync。
 * fetcher は `(path: string, init?: RequestInit) => Promise<Response>` のような形で
 * salesApi util から構築する。
 */
async function syncOne(
  item: R2PendingItem,
  bucket: R2BucketLike,
  rustFetch: (path: string, init?: { method?: string }) => Promise<Response>,
): Promise<{ uploaded: boolean; acked: boolean; error?: string }> {
  // 1) raw bytes を rust から取得
  const rawRes = await rustFetch(`/api/uriage/raw/${item.month}/${item.eigyosho_id}`)
  if (!rawRes.ok) {
    return {
      uploaded: false,
      acked: false,
      error: `raw fetch ${rawRes.status}`,
    }
  }
  const buf = await rawRes.arrayBuffer()

  // 2) R2 に put
  try {
    await bucket.put(r2Key(item.month, item.eigyosho_id), buf, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: {
        fingerprint: item.fingerprint_after,
        computed_at: item.computed_at,
      },
    })
  } catch (e) {
    return { uploaded: false, acked: false, error: `R2 put: ${String(e)}` }
  }

  // 3) ack
  const ackRes = await rustFetch(
    `/api/uriage/raw/${item.month}/${item.eigyosho_id}/ack`,
    { method: 'POST' },
  )
  if (!ackRes.ok) {
    return { uploaded: true, acked: false, error: `ack ${ackRes.status}` }
  }

  return { uploaded: true, acked: true }
}

/**
 * R2 同期のメイン loop。pending を取り、**`ready=true` の entry のみ** 順次 sync する。
 * `unverified` / `ng_present` blocker のある entry は `skipped` 配列に積んで報告する。
 *
 * verify-first orchestration (= 未検証なら先に verify) は CF Workers の
 * subrequest 上限を避けるため **browser-side (UI) で iterate** する設計。サーバ側
 * (本関数) は ready のみを sync して、未検証は呼び元 (UI) が verify してから再 sync 起動。
 *
 * (Refs ohishi-exp/rust-ichibanboshi#43 — verify_jobs 永続化 + R2 gate)
 */
export async function syncUriageR2(
  bucket: R2BucketLike,
  rustFetch: (path: string, init?: { method?: string }) => Promise<Response>,
): Promise<UriageSyncResult> {
  const result: UriageSyncResult = {
    attempted: 0,
    uploaded: 0,
    acked: 0,
    failures: [],
    skipped: [],
  }

  // pending list
  const pendingRes = await rustFetch('/api/uriage/r2/pending')
  if (!pendingRes.ok) {
    result.failures.push({
      month: '',
      eigyosho_id: 0,
      stage: 'pending',
      error: `pending fetch ${pendingRes.status}`,
    })
    return result
  }
  const pending = (await pendingRes.json()) as R2PendingResponse

  for (const item of pending.items) {
    // verify gate
    if (!item.ready) {
      const reason: 'unverified' | 'ng_present' = item.blocker === 'ng_present' ? 'ng_present' : 'unverified'
      result.skipped.push({
        month: item.month,
        eigyosho_id: item.eigyosho_id,
        reason,
        verified_count: item.verified_count,
        verified_ng: item.verified_ng,
        expected_count: item.expected_count,
      })
      continue
    }

    result.attempted++
    const r = await syncOne(item, bucket, rustFetch)
    if (r.uploaded) result.uploaded++
    if (r.acked) result.acked++
    if (r.error) {
      result.failures.push({
        month: item.month,
        eigyosho_id: item.eigyosho_id,
        stage: r.uploaded ? 'ack' : 'upload',
        error: r.error,
      })
    }
  }

  return result
}

/**
 * Cloudflare scheduled context (cron) で使う event-less fetch builder。
 * `cloudflare:workers` の `env` から CF_ACCESS_CLIENT_SECRET binding と
 * NUXT_SALES_API_BASE / NUXT_CF_ACCESS_CLIENT_ID env を読み、認証 fetch を作る。
 *
 * scheduled context 用 (env を直接渡す)。HTTP context は `buildRustFetchFromEvent`。
 */
export async function buildRustFetchFromEnv(env: {
  NUXT_SALES_API_BASE?: string
  NUXT_CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: unknown
}): Promise<(path: string, init?: { method?: string }) => Promise<Response>> {
  const base = env.NUXT_SALES_API_BASE
  const clientId = env.NUXT_CF_ACCESS_CLIENT_ID
  if (!base || !clientId) {
    throw new Error('NUXT_SALES_API_BASE / NUXT_CF_ACCESS_CLIENT_ID env が未設定')
  }
  let clientSecret = ''
  const sec = env.CF_ACCESS_CLIENT_SECRET
  if (typeof sec === 'string') {
    clientSecret = sec
  } else if (sec && typeof (sec as { get?: unknown }).get === 'function') {
    clientSecret = (await (sec as { get(): Promise<string> }).get()) ?? ''
  }
  return (path, init) =>
    fetch(`${base}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'CF-Access-Client-Id': clientId,
        'CF-Access-Client-Secret': clientSecret,
      },
    })
}

/**
 * H3Event 経由で rust-fetch を作る (HTTP API endpoint から sync を叩く用途)。
 * runtimeConfig + event.context.cloudflare.env を読む。
 */
export async function buildRustFetchFromEvent(
  event: H3Event,
): Promise<(path: string, init?: { method?: string }) => Promise<Response>> {
  const config = useRuntimeConfig()
  const env = (event.context.cloudflare as { env?: { CF_ACCESS_CLIENT_SECRET?: unknown } } | undefined)
    ?.env
  let clientSecret = ''
  const sec = env?.CF_ACCESS_CLIENT_SECRET
  if (typeof sec === 'string') {
    clientSecret = sec
  } else if (sec && typeof (sec as { get?: unknown }).get === 'function') {
    clientSecret = (await (sec as { get(): Promise<string> }).get()) ?? ''
  }
  return (path, init) =>
    fetch(`${config.salesApiBase}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'CF-Access-Client-Id': config.cfAccessClientId,
        'CF-Access-Client-Secret': clientSecret,
      },
    })
}
