<script setup lang="ts">
/**
 * 運賃リスト 一覧ページ (Refs ohishi-exp/rust-ichibanboshi#57)。
 * 得意先別・傭車先別の合計金額を表示し、クリックで明細ページへ遷移する。
 *
 * 合計金額は rust 側 `/api/unchin/summary`（SQL の SUM/GROUP BY）から取得する。
 * raw 行を TOP-N で取得してクライアント側集計する旧方式だと、一部の取引先
 * （非請求のダミー得意先等）が行数を食い潰して他の取引先が表示されなくなる
 * 問題があったため、SQL 側で得意先・傭車先ごとに集計済みの値を使う。
 */
interface PartnerSummary {
  partner_code: string
  partner_name: string
  total: number
  /**
   * `得意先ﾏｽﾀ`/`傭車先ﾏｽﾀ`.`部門C`（自社側の受注部門/営業所コード。得意先・傭車先
   * 自身の拠点とは別軸。#92 follow-up 実機調査で確認済み、rust-ichibanboshi#64）。
   */
  bumon_code: string
  /** `部門ﾏｽﾀ.部門N`（自社営業所名）。未設定・未マッチ時は空文字。 */
  bumon_name: string
}
interface SummaryResponse {
  source_table: string
  data: PartnerSummary[]
}
/** 得意先C 単位でまとめた時の内訳 1 件 (自社営業所単位、#92 follow-up)。 */
interface BumonBreakdownEntry {
  bumon_code: string
  bumon_name: string
  total: number
}
/** 得意先コードでまとめた行。`breakdown` は自社営業所 (部門) 別内訳 (2件以上の時のみ)。 */
interface MergedPartnerSummary extends PartnerSummary {
  breakdown?: BumonBreakdownEntry[]
}
interface BarSegment {
  label: string
  amount: number
  pct: number
  colorClass: string
  title: string
}

type PartnerTypeLiteral = 'customer' | 'subcontractor'

/**
 * 得意先・傭車先タグ (Refs ohishi-exp/rust-ichibanboshi#57 follow-up)。
 * 「値上げ候補」「サーチャージ導入候補」「除外」等、ユーザーが自由に追加・削除できる
 * フィルター形式のタグ。1 得意先が複数タグに所属することもある (多対多)。
 */
interface TagDef {
  tag_id: string
  label: string
  registered_by: string
  registered_at: string
}
interface TagDefsResponse {
  defs: TagDef[]
}
interface TagAssignment {
  assignment_id: string
  partner_type: PartnerTypeLiteral
  partner_code: string
  tag_id: string
  note: string
  assigned_by: string
}
interface TagAssignmentsResponse {
  assignments: TagAssignment[]
}

type Kind = 'with_billing_only' | 'with_non_billing'
const KIND_OPTIONS: { value: Kind, label: string }[] = [
  { value: 'with_non_billing', label: '請求＋非請求 (請求K IN (0,2)、default)' },
  { value: 'with_billing_only', label: '請求＋請求のみ (請求K IN (0,1))' },
]

const loading = ref(true)
const error = ref('')
const currentYear = new Date().getFullYear()
const from = ref(`${currentYear}-01-01`)
const to = ref(`${currentYear + 1}-01-01`)
const kind = ref<Kind>('with_non_billing')
/**
 * 得意先C (得意先H 無視) でまとめるトグル。**default ON**
 * (#92 follow-up でデフォルト表示に変更。自社営業所別の構成比バーを常時見せるため)。
 * 表示名一致による自動マージはしない (#57 確定事項。得意先H は支店違い等で正当に
 * 異なる場合があるため) — あくまで得意先C単位の合算であり、名前一致でのマージはしない。
 * OFF にすれば従来通り 得意先H 単位のバラ表示に戻せる。
 */
const groupByCode = ref(true)

const customerSummary = ref<PartnerSummary[]>([])
const subcontractorSummary = ref<PartnerSummary[]>([])
const customerSource = ref('')
const subcontractorSource = ref('')

/** `得意先C-得意先H` の `得意先C` 部分のみ取り出す（クライアント側、server/utils と同ロジック）。 */
function partnerBaseCode(partnerCode: string): string {
  const idx = partnerCode.indexOf('-')
  return idx === -1 ? partnerCode : partnerCode.slice(0, idx)
}
/**
 * 得意先C 単位でまとめ、自社営業所 (`部門C`/`部門N`) 別の内訳も合わせて集計する。
 *
 * 内訳の軸は「得意先H (支店名の自由記述テキスト)」ではなく「自社営業所 (`部門C`)」
 * にしている — 得意先N は H と1:1対応せず表記揺れも多い自由記述だが (#93 実機調査)、
 * `部門C` は `部門ﾏｽﾀ` に紐づく構造化データで会社ごとに意味のある値を持つため
 * (#92 follow-up、rust-ichibanboshi#64 で summary に追加)。
 */
function mergeByBaseCode(rows: PartnerSummary[]): MergedPartnerSummary[] {
  interface Building extends MergedPartnerSummary {
    bumonMap: Map<string, BumonBreakdownEntry>
  }
  const map = new Map<string, Building>()
  for (const row of rows) {
    const base = partnerBaseCode(row.partner_code)
    let group = map.get(base)
    if (!group) {
      group = {
        partner_code: base,
        partner_name: row.partner_name,
        total: 0,
        bumon_code: row.bumon_code,
        bumon_name: row.bumon_name,
        bumonMap: new Map(),
      }
      map.set(base, group)
    }
    group.total += row.total
    const bumonKey = row.bumon_code || '(未設定)'
    let bumon = group.bumonMap.get(bumonKey)
    if (!bumon) {
      bumon = { bumon_code: row.bumon_code, bumon_name: row.bumon_name || '(未設定)', total: 0 }
      group.bumonMap.set(bumonKey, bumon)
    }
    bumon.total += row.total
  }
  const result = Array.from(map.values()).map((g) => {
    const breakdown = Array.from(g.bumonMap.values()).sort((a, b) => b.total - a.total)
    return {
      partner_code: g.partner_code,
      partner_name: g.partner_name,
      total: g.total,
      bumon_code: g.bumon_code,
      bumon_name: g.bumon_name,
      // 自社営業所が1件だけでも breakdown を持たせる (= 単色100%のバーとして表示する。
      // user 2026-07-01「営業所別バーをすべての得意先、傭車先にも表示して」)。
      breakdown,
    }
  })
  return result.sort((a, b) => b.total - a.total)
}

/**
 * テーブル行 (グループ済み `MergedPartnerSummary` またはグループ無し `PartnerSummary`)
 * から営業所内訳バー用の breakdown を取り出す。`groupByCode` OFF 時の生 `PartnerSummary`
 * は breakdown を持たないため、自分自身の bumon_code/bumon_name を単一要素の内訳として
 * 合成する (= どちらのモードでも常にバーを表示できるようにする)。
 */
function rowBreakdown(p: MergedPartnerSummary): BumonBreakdownEntry[] {
  if (p.breakdown && p.breakdown.length > 0) return p.breakdown
  return [{ bumon_code: p.bumon_code, bumon_name: p.bumon_name || '(未設定)', total: p.total }]
}

/**
 * 自社営業所 (`部門`) 別の内訳を構成比バー用セグメントに変換する (#92)。
 * 金額上位5件だけ色分けし、残りは「その他」に1セグメントへ集約する
 * (実機で最大19件の 得意先H を持つ得意先を確認済み。ただし内訳の軸が営業所
 * (15件/12件しかない構造化マスタ) になったため、実際には5件を超えるケースは稀)。
 *
 * 営業所が1件だけの得意先・傭車先でも単色100%のバーとして表示する
 * (user 2026-07-01「営業所別バーをすべての得意先、傭車先にも表示して」— 従来は
 * 2件以上の時のみ表示していた)。
 *
 * 色は「金額順位」ではなく **営業所 (`bumon_code`) 単位で固定**する。順位だと
 * 行によって同じ色が別の営業所を指してしまい、凡例と実際の色が対応しなくなるため
 * (フィードバック対応)。`bumonColorMap` (全得意先・傭車先を横断して構築) を参照する。
 */
const BAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-fuchsia-500', 'bg-cyan-500',
  'bg-rose-500', 'bg-lime-600', 'bg-indigo-500', 'bg-orange-500', 'bg-teal-500',
  'bg-purple-500', 'bg-yellow-500',
]
const OTHER_BAR_COLOR = 'bg-gray-300'
const BAR_TOP_N = 5

/**
 * 得意先別・傭車先別サマリ全体から distinct な営業所 (`bumon_code`) を集め、
 * 合計金額の大きい順に色を固定割り当てする (パレットを超える分は色を使い回す —
 * 実機で最大15件だが、それでも収まらない場合の保険)。
 */
const bumonColorMap = computed<Map<string, string>>(() => {
  const totals = new Map<string, { name: string, total: number }>()
  for (const row of [...customerSummary.value, ...subcontractorSummary.value]) {
    const key = row.bumon_code || '(未設定)'
    const cur = totals.get(key) ?? { name: row.bumon_name || '(未設定)', total: 0 }
    cur.total += row.total
    totals.set(key, cur)
  }
  const ordered = Array.from(totals.entries()).sort((a, b) => b[1].total - a[1].total)
  const map = new Map<string, string>()
  ordered.forEach(([code], i) => {
    map.set(code, BAR_COLORS[i % BAR_COLORS.length]!)
  })
  return map
})

/** 凡例表示用: `bumonColorMap` を色順にラベル付きで並べたもの。 */
const bumonLegend = computed(() => {
  const totals = new Map<string, { name: string, total: number }>()
  for (const row of [...customerSummary.value, ...subcontractorSummary.value]) {
    const key = row.bumon_code || '(未設定)'
    const cur = totals.get(key) ?? { name: row.bumon_name || '(未設定)', total: 0 }
    cur.total += row.total
    totals.set(key, cur)
  }
  return Array.from(totals.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([code, v]) => ({ code, name: v.name, colorClass: bumonColorMap.value.get(code)! }))
})

function buildBreakdownSegments(breakdown: BumonBreakdownEntry[] | undefined, total: number): BarSegment[] {
  if (!breakdown || breakdown.length === 0) return []
  const top = breakdown.slice(0, BAR_TOP_N)
  const rest = breakdown.slice(BAR_TOP_N)
  const pct = (amount: number) => (total > 0 ? (amount / total) * 100 : 0)
  const segments: BarSegment[] = top.map(r => ({
    label: r.bumon_name,
    amount: r.total,
    pct: pct(r.total),
    colorClass: bumonColorMap.value.get(r.bumon_code || '(未設定)') ?? OTHER_BAR_COLOR,
    title: `${r.bumon_name} (${r.bumon_code}): ${fmtYen(r.total)} (${pct(r.total).toFixed(1)}%)`,
  }))
  if (rest.length > 0) {
    const restTotal = rest.reduce((sum, r) => sum + r.total, 0)
    segments.push({
      label: `その他 (${rest.length}件)`,
      amount: restTotal,
      pct: pct(restTotal),
      colorClass: OTHER_BAR_COLOR,
      title: `その他 ${rest.length}件: ${fmtYen(restTotal)} (${pct(restTotal).toFixed(1)}%)`,
    })
  }
  return segments
}

/**
 * バー全体にホバーした時に出す集約 tooltip (複数行)。個別セグメントは細くて
 * 正確にホバーしづらいため、バー全体のどこにマウスを乗せても全内訳が見えるように
 * する (「凡例とホバーを入れてほしい」フィードバック対応)。
 */
function buildBreakdownTitle(segments: BarSegment[]): string {
  return segments.map(s => `${s.label}: ${fmtYen(s.amount)} (${s.pct.toFixed(1)}%)`).join('\n')
}

// ── 得意先・傭車先タグ ──
const tagDefs = ref<TagDef[]>([])
const tagAssignments = ref<TagAssignment[]>([])
/** OR フィルタ: いずれかの選択タグを持つ行だけ表示。空なら絞り込みなし。 */
const activeTagFilters = ref<Set<string>>(new Set())
const newTagLabel = ref('')
const tagBusy = ref(false)
/** タグ追加ピッカーを開いている行の key (`${partnerType}:${partnerCode}`)。 */
const openTagPickerKey = ref<string | null>(null)
const pickerTagId = ref('')
const pickerNote = ref('')

async function loadTags() {
  const [defsRes, assignRes] = await Promise.all([
    $fetch<TagDefsResponse>('/api/unchin/tags/defs'),
    $fetch<TagAssignmentsResponse>('/api/unchin/tags/assignments'),
  ])
  tagDefs.value = defsRes.defs
  tagAssignments.value = assignRes.assignments
}

function tagsFor(partnerType: PartnerTypeLiteral, partnerCode: string): TagAssignment[] {
  return tagAssignments.value.filter(a => a.partner_type === partnerType && a.partner_code === partnerCode)
}

function tagLabel(tagId: string): string {
  return tagDefs.value.find(d => d.tag_id === tagId)?.label ?? tagId
}

function toggleTagFilter(tagId: string) {
  const next = new Set(activeTagFilters.value)
  if (next.has(tagId)) next.delete(tagId)
  else next.add(tagId)
  activeTagFilters.value = next
}

function passesTagFilter(partnerType: PartnerTypeLiteral, partnerCode: string): boolean {
  if (activeTagFilters.value.size === 0) return true
  return tagsFor(partnerType, partnerCode).some(a => activeTagFilters.value.has(a.tag_id))
}

async function createTagDef() {
  const label = newTagLabel.value.trim()
  if (!label) return
  tagBusy.value = true
  try {
    await $fetch('/api/unchin/tags/defs', { method: 'POST', body: { label } })
    newTagLabel.value = ''
    await loadTags()
  } finally {
    tagBusy.value = false
  }
}

async function deleteTagDef(tagId: string) {
  if (!confirm('このタグを削除しますか？(割り当ても全て解除されます)')) return
  await $fetch(`/api/unchin/tags/defs/${tagId}`, { method: 'DELETE' })
  if (activeTagFilters.value.has(tagId)) {
    const next = new Set(activeTagFilters.value)
    next.delete(tagId)
    activeTagFilters.value = next
  }
  await loadTags()
}

function openTagPicker(partnerType: PartnerTypeLiteral, partnerCode: string) {
  openTagPickerKey.value = `${partnerType}:${partnerCode}`
  pickerTagId.value = ''
  pickerNote.value = ''
}

async function assignTag(partnerType: PartnerTypeLiteral, partnerCode: string) {
  if (!pickerTagId.value) return
  await $fetch('/api/unchin/tags/assignments', {
    method: 'POST',
    body: {
      partner_type: partnerType,
      partner_code: partnerCode,
      tag_id: pickerTagId.value,
      note: pickerNote.value.trim(),
    },
  })
  openTagPickerKey.value = null
  await loadTags()
}

async function removeTagAssignment(assignmentId: string) {
  await $fetch(`/api/unchin/tags/assignments/${assignmentId}`, { method: 'DELETE' })
  await loadTags()
}

const customerSummaryDisplay = computed<MergedPartnerSummary[]>(() => {
  const rows = groupByCode.value ? mergeByBaseCode(customerSummary.value) : customerSummary.value
  return rows.filter(p => passesTagFilter('customer', p.partner_code))
})
const subcontractorSummaryDisplay = computed<MergedPartnerSummary[]>(() => {
  const rows = groupByCode.value ? mergeByBaseCode(subcontractorSummary.value) : subcontractorSummary.value
  return rows.filter(p => passesTagFilter('subcontractor', p.partner_code))
})

function detailLink(partnerType: PartnerTypeLiteral, partnerCode: string): string {
  const base = `/unchin/${partnerType}/${encodeURIComponent(partnerCode)}`
  return groupByCode.value ? `${base}?groupByCode=1` : base
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value, kind: kind.value })
    const [customerRes, subcontractorRes] = await Promise.all([
      $fetch<SummaryResponse>(`/api/unchin/summary?${params.toString()}&partner_type=customer`),
      $fetch<SummaryResponse>(`/api/unchin/summary?${params.toString()}&partner_type=subcontractor`),
      loadTags(),
    ])
    customerSummary.value = customerRes.data
    customerSource.value = customerRes.source_table
    subcontractorSummary.value = subcontractorRes.data
    subcontractorSource.value = subcontractorRes.source_table
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    error.value = `読み込みに失敗しました: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    loading.value = false
  }
}

onMounted(load)

function fmtYen(n: number): string {
  return `${n.toLocaleString('ja-JP')} 円`
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <AppHeader title="運賃リスト" />

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div>
          <label class="block text-xs text-gray-500">期間 (売上年月日) from</label>
          <input v-model="from" type="date" class="border rounded px-2 py-1 text-sm">
        </div>
        <div>
          <label class="block text-xs text-gray-500">to (含まない)</label>
          <input v-model="to" type="date" class="border rounded px-2 py-1 text-sm">
        </div>
        <div>
          <label class="block text-xs text-gray-500">請求区分</label>
          <select v-model="kind" class="border rounded px-2 py-1 text-sm">
            <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </div>
        <button class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700" @click="load">
          更新
        </button>
        <label class="flex items-center gap-1 text-sm text-gray-600 ml-2">
          <input v-model="groupByCode" type="checkbox" class="rounded">
          得意先コードでまとめる (支店違いを合算、default ON。OFFでH単位のバラ表示)
        </label>
      </div>

      <div class="bg-white rounded-lg shadow p-4 mb-6">
        <h2 class="font-semibold text-sm mb-2 text-gray-600">タグ (値上げ候補・サーチャージ導入候補・除外 等、自由に追加可能)</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <span
            v-for="d in tagDefs"
            :key="d.tag_id"
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer border"
            :class="activeTagFilters.has(d.tag_id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'"
            @click="toggleTagFilter(d.tag_id)"
          >
            {{ d.label }}
            <button
              class="ml-1 opacity-60 hover:opacity-100"
              title="タグ定義を削除"
              @click.stop="deleteTagDef(d.tag_id)"
            >×</button>
          </span>
          <span v-if="tagDefs.length === 0" class="text-xs text-gray-400">登録済みタグはありません</span>
          <span class="flex items-center gap-1 ml-2">
            <input
              v-model="newTagLabel"
              type="text"
              placeholder="新規タグ名 (例: 値上げ候補)"
              class="border rounded px-2 py-1 text-xs"
              @keyup.enter="createTagDef"
            >
            <button
              :disabled="tagBusy || !newTagLabel.trim()"
              class="bg-gray-700 text-white px-2 py-1 rounded text-xs hover:bg-gray-800 disabled:bg-gray-300"
              @click="createTagDef"
            >
              + 追加
            </button>
          </span>
        </div>
        <p v-if="activeTagFilters.size > 0" class="text-xs text-gray-400 mt-2">
          選択中のタグのいずれかを持つ得意先・傭車先のみ表示中 (クリックで解除)
        </p>
      </div>

      <div
        v-if="!loading && !error && groupByCode"
        class="flex items-center gap-3 flex-wrap text-xs text-gray-500 mb-3"
      >
        <span>営業所内訳バーの色 (自社営業所ごとに固定):</span>
        <span v-for="b in bumonLegend" :key="b.code" class="inline-flex items-center gap-1">
          <span class="inline-block w-3 h-3 rounded-sm" :class="b.colorClass" />{{ b.name }}
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="inline-block w-3 h-3 rounded-sm" :class="OTHER_BAR_COLOR" />その他
        </span>
        <span class="text-gray-400">(バーにカーソルを合わせると営業所名・金額・比率を表示)</span>
      </div>

      <div v-if="loading" class="text-center py-20 text-gray-500">読み込み中...</div>
      <div v-else-if="error" class="text-center py-20 text-red-600">{{ error }}</div>
      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white rounded-lg shadow p-4">
          <h2 class="font-semibold text-base mb-3">得意先別 売上(請求)金額</h2>
          <p class="text-xs text-gray-400 mb-2">{{ customerSource }}</p>
          <table class="w-full text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="text-left py-1">得意先</th>
                <th class="text-left py-1">タグ</th>
                <th class="text-right py-1">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in customerSummaryDisplay"
                :key="p.partner_code"
                class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                @click="navigateTo(detailLink('customer', p.partner_code))"
              >
                <td class="py-1">
                  {{ p.partner_name || p.partner_code }}
                  <div
                    v-if="buildBreakdownSegments(rowBreakdown(p), p.total).length > 0"
                    class="mt-1 flex h-2 w-full max-w-[160px] rounded overflow-hidden bg-gray-100"
                    :title="buildBreakdownTitle(buildBreakdownSegments(rowBreakdown(p), p.total))"
                  >
                    <span
                      v-for="(seg, si) in buildBreakdownSegments(rowBreakdown(p), p.total)"
                      :key="si"
                      :class="seg.colorClass"
                      :style="{ width: seg.pct + '%' }"
                      :title="seg.title"
                      class="h-full"
                    />
                  </div>
                </td>
                <td class="py-1" @click.stop>
                  <span
                    v-for="a in tagsFor('customer', p.partner_code)"
                    :key="a.assignment_id"
                    class="inline-flex items-center gap-1 mr-1 mb-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs"
                    :title="a.note"
                  >
                    {{ tagLabel(a.tag_id) }}
                    <button class="opacity-60 hover:opacity-100" @click="removeTagAssignment(a.assignment_id)">×</button>
                  </span>
                  <span v-if="openTagPickerKey === `customer:${p.partner_code}`" class="inline-flex items-center gap-1">
                    <input v-model="pickerNote" type="text" placeholder="備考(任意)" class="border rounded text-xs px-1 py-0.5 w-16">
                    <select
                      v-model="pickerTagId"
                      class="border rounded text-xs px-1 py-0.5"
                      @change="assignTag('customer', p.partner_code)"
                    >
                      <option value="">タグ選択（選ぶと即保存）</option>
                      <option v-for="d in tagDefs" :key="d.tag_id" :value="d.tag_id">{{ d.label }}</option>
                    </select>
                    <button class="text-xs text-gray-400" @click="openTagPickerKey = null">×</button>
                  </span>
                  <button v-else class="text-xs text-gray-400 hover:text-blue-600" @click="openTagPicker('customer', p.partner_code)">+ タグ</button>
                </td>
                <td class="py-1 text-right">{{ fmtYen(p.total) }}</td>
              </tr>
              <tr v-if="customerSummaryDisplay.length === 0">
                <td colspan="3" class="py-6 text-center text-gray-400">データがありません</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <h2 class="font-semibold text-base mb-3">傭車先別 支払金額</h2>
          <p class="text-xs text-gray-400 mb-2">{{ subcontractorSource }}</p>
          <table class="w-full text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="text-left py-1">傭車先</th>
                <th class="text-left py-1">タグ</th>
                <th class="text-right py-1">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in subcontractorSummaryDisplay"
                :key="p.partner_code"
                class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                @click="navigateTo(detailLink('subcontractor', p.partner_code))"
              >
                <td class="py-1">
                  {{ p.partner_name || p.partner_code }}
                  <div
                    v-if="buildBreakdownSegments(rowBreakdown(p), p.total).length > 0"
                    class="mt-1 flex h-2 w-full max-w-[160px] rounded overflow-hidden bg-gray-100"
                    :title="buildBreakdownTitle(buildBreakdownSegments(rowBreakdown(p), p.total))"
                  >
                    <span
                      v-for="(seg, si) in buildBreakdownSegments(rowBreakdown(p), p.total)"
                      :key="si"
                      :class="seg.colorClass"
                      :style="{ width: seg.pct + '%' }"
                      :title="seg.title"
                      class="h-full"
                    />
                  </div>
                </td>
                <td class="py-1" @click.stop>
                  <span
                    v-for="a in tagsFor('subcontractor', p.partner_code)"
                    :key="a.assignment_id"
                    class="inline-flex items-center gap-1 mr-1 mb-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs"
                    :title="a.note"
                  >
                    {{ tagLabel(a.tag_id) }}
                    <button class="opacity-60 hover:opacity-100" @click="removeTagAssignment(a.assignment_id)">×</button>
                  </span>
                  <span v-if="openTagPickerKey === `subcontractor:${p.partner_code}`" class="inline-flex items-center gap-1">
                    <input v-model="pickerNote" type="text" placeholder="備考(任意)" class="border rounded text-xs px-1 py-0.5 w-16">
                    <select
                      v-model="pickerTagId"
                      class="border rounded text-xs px-1 py-0.5"
                      @change="assignTag('subcontractor', p.partner_code)"
                    >
                      <option value="">タグ選択（選ぶと即保存）</option>
                      <option v-for="d in tagDefs" :key="d.tag_id" :value="d.tag_id">{{ d.label }}</option>
                    </select>
                    <button class="text-xs text-gray-400" @click="openTagPickerKey = null">×</button>
                  </span>
                  <button v-else class="text-xs text-gray-400 hover:text-blue-600" @click="openTagPicker('subcontractor', p.partner_code)">+ タグ</button>
                </td>
                <td class="py-1 text-right">{{ fmtYen(p.total) }}</td>
              </tr>
              <tr v-if="subcontractorSummaryDisplay.length === 0">
                <td colspan="3" class="py-6 text-center text-gray-400">データがありません</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </div>
</template>
