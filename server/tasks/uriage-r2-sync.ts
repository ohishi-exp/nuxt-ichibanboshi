// nitro scheduled task: rust-ichiban の `/api/uriage/r2/pending` を polling し、
// fingerprint 変化があった raw NDJSON.gz を R2 (URIAGE_R2 binding) に upload + ack する。
//
// nuxt.config の scheduledTasks (`*/15 * * * *` = 15 分おき) で起動する。
// Cloudflare Workers の binding は scheduled context では H3 event 経由で取れないため、
// CF ネイティブの `cloudflare:workers` の `env` から R2 / 認証 secret を読む。
// (compatibility_date 2025-07-15 で利用可。node/vitest からは読めないため task 本体は
//  単体テスト対象外、ロジックは server/utils/uriageR2Sync.ts 側でテスト可能)。
import { env as cfEnv } from 'cloudflare:workers'
import {
  buildRustFetchFromEnv,
  syncUriageR2,
  type R2BucketLike,
} from '../utils/uriageR2Sync'

export default defineTask({
  meta: {
    name: 'uriage-r2-sync',
    description: 'rust-ichiban の raw NDJSON.gz を R2 (URIAGE_R2) に同期 + ack',
  },
  async run() {
    const env = cfEnv as unknown as {
      URIAGE_R2?: R2BucketLike
      NUXT_SALES_API_BASE?: string
      NUXT_CF_ACCESS_CLIENT_ID?: string
      CF_ACCESS_CLIENT_SECRET?: unknown
    }
    const bucket = env.URIAGE_R2
    if (!bucket) {
      console.warn('[uriage-r2-sync] URIAGE_R2 binding 未設定のため skip')
      return { result: 'no_bucket' as const }
    }
    try {
      const rustFetch = await buildRustFetchFromEnv(env)
      const result = await syncUriageR2(bucket, rustFetch)
      console.log('[uriage-r2-sync]', JSON.stringify(result))
      return { result: `attempted=${result.attempted} uploaded=${result.uploaded} acked=${result.acked} failures=${result.failures.length}` }
    } catch (e: unknown) {
      console.error('[uriage-r2-sync] 例外:', e)
      return { result: `error: ${String(e)}` }
    }
  },
})
