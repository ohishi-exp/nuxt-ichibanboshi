/**
 * 得意先・傭車先別運賃リスト (Refs ohishi-exp/rust-ichibanboshi#57) の
 * R2 キー規約・グルーピングロジック。
 *
 * ストレージは既存 `URIAGE_R2` バケットを `unchin/` prefix で流用する
 * (CCoW から Cloudflare 認証して新規 KV/R2 を provisioning できないため。
 * `docs/plan-unchin-rate-list.md`（rust-ichibanboshi リポジトリ）参照)。
 */
import type { H3Event } from 'h3'

export type PartnerType = 'customer' | 'subcontractor'

/** rust-ichibanboshi `GET /api/unchin/candidates` の 1 行。 */
export interface UnchinCandidateRow {
  partner_code: string
  partner_name: string
  item_code: string
  item_name: string
  fare: number
  origin: string
  dest: string
  sale_date: string
}

export interface UnchinRoutePair {
  origin: string
  dest: string
}

/** `(partner_code, item_code, fare)` でまとめた 1 運賃グループ。 */
export interface UnchinGroup {
  partner_code: string
  partner_name: string
  item_code: string
  item_name: string
  fare: number
  routes: UnchinRoutePair[]
  /** このグループに属する raw 行数 (= 取引回数。合計金額計算に使う)。 */
  count: number
  /** このグループに属する raw 行の `sale_date` 最小値 (YYYY-MM-DD)。 */
  min_date: string
  /** このグループに属する raw 行の `sale_date` 最大値 (YYYY-MM-DD)。 */
  max_date: string
}

export interface UnchinVersionIndexEntry {
  version_id: string
  effective_from: string
  registered_by: string
  registered_at: string
  item_count: number
}

/** 空品名コード（汎用コード、過剰集約の補正対象。#57 確定事項）。 */
const GENERIC_ITEM_CODES = new Set(['0000', '0002'])

/**
 * 品名コードの手動エイリアスグループ。「この品名Cとこの品名Cは同一」をユーザーが
 * 手動登録する（表示名一致による自動マージはしない。#57 で確定）。
 *
 * `kind`:
 * - `'merge'` (default): まとめて表示する通常のグルーピング
 * - `'exception'`: 似ているが意図的に同一視しない品名コードの組を記録する
 *   (誤統合を防ぐための備忘。`groupUnchinRows` のまとめ処理には使わない)
 */
export interface UnchinItemAliasGroup {
  group_id: string
  label: string
  item_codes: string[]
  kind: 'merge' | 'exception'
  note: string
  registered_by: string
  registered_at: string
}

export function unchinItemAliasKey(): string {
  return 'unchin/alias/item-groups.json'
}

export async function loadItemAliasGroups(bucket: UnchinR2BucketLike): Promise<UnchinItemAliasGroup[]> {
  const obj = await bucket.get(unchinItemAliasKey())
  if (!obj) return []
  try {
    const parsed = JSON.parse(await obj.text())
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveItemAliasGroups(bucket: UnchinR2BucketLike, groups: UnchinItemAliasGroup[]): Promise<void> {
  await bucket.put(unchinItemAliasKey(), JSON.stringify(groups, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })
}

/**
 * `item_code -> 所属グループ` の逆引き map を組み立てる。
 * `kind: 'exception'` (同一視しない、として記録されたもの) はまとめ処理の対象外なので除外する。
 */
export function buildItemAliasLookup(groups: UnchinItemAliasGroup[]): Map<string, UnchinItemAliasGroup> {
  const map = new Map<string, UnchinItemAliasGroup>()
  for (const group of groups) {
    if (group.kind === 'exception') continue
    for (const code of group.item_codes) {
      map.set(code, group)
    }
  }
  return map
}

/**
 * `(partner_code, item_code, fare)` でグルーピングし、積卸ペア配列を組み立てる。
 * `item_code` が空品名コードの場合は `origin`+`dest` も同一性キーに含める
 * （過剰集約防止、#57 確定事項）。
 *
 * `itemAliases` を渡すと、手動登録された品名エイリアスグループ単位でまとめる
 * （表示名一致による自動マージはしない。グルーピングは必ずユーザー登録経由）。
 *
 * 戻り値は運賃 (`fare`) 降順（= 運賃順表示）。
 */
export function groupUnchinRows(
  rows: UnchinCandidateRow[],
  itemAliases?: Map<string, UnchinItemAliasGroup>,
): UnchinGroup[] {
  const map = new Map<string, UnchinGroup>()
  for (const row of rows) {
    const alias = itemAliases?.get(row.item_code)
    const effectiveItemCode = alias ? `alias:${alias.group_id}` : row.item_code
    const effectiveItemName = alias ? alias.label : row.item_name
    // alias でまとめた場合は積地・卸地違いを許容してまとめる (ユーザーが明示同一視した品名のため)
    const useRouteInKey = !alias && GENERIC_ITEM_CODES.has(row.item_code)
    const key = useRouteInKey
      ? `${row.partner_code} ${effectiveItemCode} ${row.fare} ${row.origin} ${row.dest}`
      : `${row.partner_code} ${effectiveItemCode} ${row.fare}`

    let group = map.get(key)
    if (!group) {
      group = {
        partner_code: row.partner_code,
        partner_name: row.partner_name,
        item_code: effectiveItemCode,
        item_name: effectiveItemName,
        fare: row.fare,
        routes: [],
        count: 0,
        min_date: row.sale_date,
        max_date: row.sale_date,
      }
      map.set(key, group)
    }
    if (!group.routes.some(r => r.origin === row.origin && r.dest === row.dest)) {
      group.routes.push({ origin: row.origin, dest: row.dest })
    }
    group.count += 1
    if (row.sale_date < group.min_date) group.min_date = row.sale_date
    if (row.sale_date > group.max_date) group.max_date = row.sale_date
  }
  return Array.from(map.values()).sort((a, b) => b.fare - a.fare)
}

/**
 * `得意先C-得意先H` 形式の `partner_code` から `得意先C` 部分のみを取り出す。
 * H は支店違い等で正当に異なる場合があるため、自動で名前一致マージはしない
 * （#57 確定事項）。この関数はユーザーが明示的に opt-in した時にのみ使う。
 */
export function partnerBaseCode(partnerCode: string): string {
  const idx = partnerCode.indexOf('-')
  return idx === -1 ? partnerCode : partnerCode.slice(0, idx)
}

export interface UnchinPartnerSummaryRow {
  partner_code: string
  partner_name: string
  total: number
}

/**
 * `得意先C` 単位（H 無視）で集計をまとめ直す。**opt-in 専用**
 * （default では呼ばない。ユーザーが明示的にチェックを入れた時だけ使う、#57 確定事項）。
 */
export function mergePartnerSummaryByBaseCode(rows: UnchinPartnerSummaryRow[]): UnchinPartnerSummaryRow[] {
  const map = new Map<string, UnchinPartnerSummaryRow>()
  for (const row of rows) {
    const base = partnerBaseCode(row.partner_code)
    let group = map.get(base)
    if (!group) {
      group = { partner_code: base, partner_name: row.partner_name, total: 0 }
      map.set(base, group)
    }
    group.total += row.total
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// ── 得意先・傭車先タグ (Refs #57 follow-up) ──
//
// 得意先を「値上げ候補」「サーチャージ導入候補」「除外」等に分類するための自由形式タグ。
// タグの種類自体もユーザーが自由に追加・削除できる (固定リストにしない)。
// 1 つの得意先が複数タグに所属することもある (多対多)。
// 日付による分類は付与日時刻の記録ではなく、タグ自体を日付・期間単位で作成して
// 管理する (例: 「2026-06値上げ」タグ。#57 follow-up で確定)。

export interface UnchinPartnerTagDef {
  tag_id: string
  label: string
  registered_by: string
  registered_at: string
}

export interface UnchinPartnerTagAssignment {
  assignment_id: string
  partner_type: PartnerType
  partner_code: string
  tag_id: string
  /** 例外・備考 (#57 follow-up で「例外も記録したい」に対応)。 */
  note: string
  assigned_by: string
}

export function unchinTagDefsKey(): string {
  return 'unchin/tags/defs.json'
}

export function unchinTagAssignmentsKey(): string {
  return 'unchin/tags/assignments.json'
}

export async function loadTagDefs(bucket: UnchinR2BucketLike): Promise<UnchinPartnerTagDef[]> {
  const obj = await bucket.get(unchinTagDefsKey())
  if (!obj) return []
  try {
    const parsed = JSON.parse(await obj.text())
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveTagDefs(bucket: UnchinR2BucketLike, defs: UnchinPartnerTagDef[]): Promise<void> {
  await bucket.put(unchinTagDefsKey(), JSON.stringify(defs, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })
}

export async function loadTagAssignments(bucket: UnchinR2BucketLike): Promise<UnchinPartnerTagAssignment[]> {
  const obj = await bucket.get(unchinTagAssignmentsKey())
  if (!obj) return []
  try {
    const parsed = JSON.parse(await obj.text())
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveTagAssignments(
  bucket: UnchinR2BucketLike,
  assignments: UnchinPartnerTagAssignment[],
): Promise<void> {
  await bucket.put(unchinTagAssignmentsKey(), JSON.stringify(assignments, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })
}

export function unchinIndexKey(partnerType: PartnerType, partnerCode: string): string {
  return `unchin/index/${partnerType}/${partnerCode}.json`
}

export function unchinDataKey(partnerType: PartnerType, partnerCode: string, versionId: string): string {
  return `unchin/data/${partnerType}/${partnerCode}/${versionId}.json`
}

/**
 * `effective_from` (YYYY-MM-DD) + 連番でユニークな version_id を作る。
 * 同日に複数回登録された場合は `-02` 等を付与する。
 */
export function buildVersionId(effectiveFrom: string, existing: UnchinVersionIndexEntry[]): string {
  const datePart = effectiveFrom.replace(/-/g, '')
  const sameDateCount = existing.filter(e => e.version_id.startsWith(`${datePart}-`)).length
  return `${datePart}-${String(sameDateCount + 1).padStart(2, '0')}`
}

/** index エントリを effective_from 降順（新しい順）にソートする。 */
export function sortVersionIndex(entries: UnchinVersionIndexEntry[]): UnchinVersionIndexEntry[] {
  return [...entries].sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
}

// ── R2 binding helper ──

export interface UnchinR2Object {
  text(): Promise<string>
}

export interface UnchinR2BucketLike {
  get(key: string): Promise<UnchinR2Object | null>
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete?(key: string): Promise<unknown>
}

/** `URIAGE_R2` binding を取得する。未設定なら 503 (= 運賃リスト機能は無効)。 */
export function getUnchinR2Bucket(event: H3Event): UnchinR2BucketLike {
  const cfEnv = (event.context.cloudflare as { env?: { URIAGE_R2?: UnchinR2BucketLike } } | undefined)
    ?.env
  const bucket = cfEnv?.URIAGE_R2
  if (!bucket) {
    throw createError({
      statusCode: 503,
      statusMessage: 'URIAGE_R2 binding 未設定: 運賃リストは無効',
    })
  }
  return bucket
}
