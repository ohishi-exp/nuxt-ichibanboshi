/**
 * GET /api/uriage/person-partner-totals?person=<name>&from=YYYY-MM&to=YYYY-MM&cal=true
 *
 * 売上 Worker (Service Binding URIAGE, `/api/uriage/person-partner-totals`) への proxy。
 * 指定担当者の期間内 得意先別・傭車先別 内訳を返す (全営業所合算)。
 * 「担当者 売上構成順位」テーブルからのドリルダウン data source。
 */
export default defineEventHandler(async (event) => {
  return uriageWorker(event, '/api/uriage/person-partner-totals')
})
