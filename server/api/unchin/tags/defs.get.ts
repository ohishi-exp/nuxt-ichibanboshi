/**
 * GET /api/unchin/tags/defs
 *
 * 得意先・傭車先タグの定義一覧を返す (R2 `unchin/tags/defs.json`)。
 * タグは固定リストではなくユーザーが自由に追加・削除できる (#57 follow-up)。
 */
export default defineEventHandler(async (event) => {
  const bucket = getUnchinR2Bucket(event)
  const defs = await loadTagDefs(bucket)
  return { defs }
})
