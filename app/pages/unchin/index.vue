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
import { AuthToolbar } from '~/composables/useAuth'

interface PartnerSummary {
  partner_code: string
  partner_name: string
  total: number
}
interface SummaryResponse {
  source_table: string
  data: PartnerSummary[]
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
 * 得意先C (得意先H 無視) でまとめる opt-in トグル。default OFF。
 * 表示名一致による自動マージはしない (#57 確定事項。得意先H は支店違い等で正当に
 * 異なる場合があるため)。ON の時だけ得意先Cでサーバー集計を合算し直す。
 */
const groupByCode = ref(false)

const customerSummary = ref<PartnerSummary[]>([])
const subcontractorSummary = ref<PartnerSummary[]>([])
const customerSource = ref('')
const subcontractorSource = ref('')

/** `得意先C-得意先H` の `得意先C` 部分のみ取り出す（クライアント側、server/utils と同ロジック）。 */
function partnerBaseCode(partnerCode: string): string {
  const idx = partnerCode.indexOf('-')
  return idx === -1 ? partnerCode : partnerCode.slice(0, idx)
}
function mergeByBaseCode(rows: PartnerSummary[]): PartnerSummary[] {
  const map = new Map<string, PartnerSummary>()
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

const customerSummaryDisplay = computed(() => {
  const rows = groupByCode.value ? mergeByBaseCode(customerSummary.value) : customerSummary.value
  return rows.filter(p => passesTagFilter('customer', p.partner_code))
})
const subcontractorSummaryDisplay = computed(() => {
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
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold">運賃リスト</h1>
          <NuxtLink
            to="/"
            class="text-sm text-gray-700 border rounded px-3 py-1 hover:bg-gray-100 no-print"
          >
            ← トップへ戻る
          </NuxtLink>
          <NuxtLink
            to="/unchin/alias-items"
            class="text-sm text-gray-700 border rounded px-3 py-1 hover:bg-gray-100 no-print"
          >
            品名グルーピング管理
          </NuxtLink>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
      </div>
    </header>

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
          得意先コードでまとめる (支店違いを合算、opt-in)
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
                <td class="py-1">{{ p.partner_name || p.partner_code }}</td>
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
                <td class="py-1">{{ p.partner_name || p.partner_code }}</td>
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
