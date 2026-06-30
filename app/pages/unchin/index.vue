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

type Kind = 'billing_only' | 'transport' | 'non_billing' | 'all'
const KIND_OPTIONS: { value: Kind, label: string }[] = [
  { value: 'transport', label: '請求 (請求K=0、default)' },
  { value: 'billing_only', label: '請求のみ (請求K=1)' },
  { value: 'non_billing', label: '非請求 (請求K=2)' },
  { value: 'all', label: '全請求区分' },
]

const loading = ref(true)
const error = ref('')
const currentYear = new Date().getFullYear()
const from = ref(`${currentYear}-01-01`)
const to = ref(`${currentYear + 1}-01-01`)
const kind = ref<Kind>('transport')

const customerSummary = ref<PartnerSummary[]>([])
const subcontractorSummary = ref<PartnerSummary[]>([])
const customerSource = ref('')
const subcontractorSource = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value, kind: kind.value })
    const [customerRes, subcontractorRes] = await Promise.all([
      $fetch<SummaryResponse>(`/api/unchin/summary?${params.toString()}&partner_type=customer`),
      $fetch<SummaryResponse>(`/api/unchin/summary?${params.toString()}&partner_type=subcontractor`),
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
          <NuxtLink to="/" class="text-sm text-blue-600 hover:underline no-print">
            ← トップへ戻る
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
                <th class="text-right py-1">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in customerSummary"
                :key="p.partner_code"
                class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                @click="navigateTo(`/unchin/customer/${encodeURIComponent(p.partner_code)}`)"
              >
                <td class="py-1">{{ p.partner_name || p.partner_code }}</td>
                <td class="py-1 text-right">{{ fmtYen(p.total) }}</td>
              </tr>
              <tr v-if="customerSummary.length === 0">
                <td colspan="2" class="py-6 text-center text-gray-400">データがありません</td>
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
                <th class="text-right py-1">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in subcontractorSummary"
                :key="p.partner_code"
                class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                @click="navigateTo(`/unchin/subcontractor/${encodeURIComponent(p.partner_code)}`)"
              >
                <td class="py-1">{{ p.partner_name || p.partner_code }}</td>
                <td class="py-1 text-right">{{ fmtYen(p.total) }}</td>
              </tr>
              <tr v-if="subcontractorSummary.length === 0">
                <td colspan="2" class="py-6 text-center text-gray-400">データがありません</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </div>
</template>
