/**
 * POST /api/uriage/r2-sync
 *
 * 手動 R2 同期トリガー (admin page の「R2 同期」ボタン用)。
 * scheduled task と同じ `syncUriageR2` を H3Event 経由で呼ぶだけ。
 *
 * cron (15 分おき) を待ちたくない場合に「再計算」直後にも叩ける。
 *
 * Nitro auto-import で `buildRustFetchFromEvent` / `syncUriageR2` が `server/utils/` から
 * 解決される。R2 binding は HTTP context では `event.context.cloudflare.env` 経由。
 */
import type { R2BucketLike } from '~~/server/utils/uriageR2Sync'

export default defineEventHandler(async (event) => {
  const cfEnv = (event.context.cloudflare as { env?: { URIAGE_R2?: R2BucketLike } } | undefined)
    ?.env
  const bucket = cfEnv?.URIAGE_R2
  if (!bucket) {
    throw createError({
      statusCode: 503,
      statusMessage: 'URIAGE_R2 binding 未設定: R2 同期は無効',
    })
  }
  const rustFetch = await buildRustFetchFromEvent(event)
  return syncUriageR2(bucket, rustFetch)
})
