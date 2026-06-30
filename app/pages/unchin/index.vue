<script setup lang="ts">
/**
 * 運賃リスト 一覧ページ (Refs ohishi-exp/rust-ichibanboshi#57)。
 * 得意先別・傭車先別の合計金額を表示し、クリックで明細ページへ遷移する。
 */
import { AuthToolbar } from '~/composables/useAuth'

interface RoutePair { origin: string, dest: string }
interface UnchinGroup {
  partner_code: string
  partner_name: string
  item_code: string
  item_name: string
  fare: number
  routes: RoutePair[]
  count: number
}
interface CandidatesResponse {
  partner_type: 'customer' | 'subcontractor'
  source_table: string
  groups: UnchinGroup[]
}
interface PartnerSummary {
  partner_code: string
  partner_name: string
  total: number
}

const loading = ref(true)
const error = ref('')
const currentYear = new Date().getFullYear()
const from = ref(`${currentYear}-01-01`)
const to = ref(`${currentYear + 1}-01-01`)

const customerSummary = ref<PartnerSummary[]>([])
const subcontractorSummary = ref<PartnerSummary[]>([])

function summarize(groups: UnchinGroup[]): PartnerSummary[] {
  const map = new Map<string, PartnerSummary>()
  for (const g of groups) {
    const amount = g.fare * g.count
    const existing = map.get(g.partner_code)
    if (existing) {
      existing.total += amount
    } else {
      map.set(g.partner_code, { partner_code: g.partner_code, partner_name: g.partner_name, total: amount })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value })
    const [customerRes, subcontractorRes] = await Promise.all([
      $fetch<CandidatesResponse>(`/api/unchin/candidates?${params.toString()}&partner_type=customer`),
      $fetch<CandidatesResponse>(`/api/unchin/candidates?${params.toString()}&partner_type=subcontractor`),
    ])
    customerSummary.value = summarize(customerRes.groups)
    subcontractorSummary.value = summarize(subcontractorRes.groups)
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
        <button class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700" @click="load">
          更新
        </button>
        <span class="text-xs text-gray-400">
          ※ 候補データを `運転日報明細` から直接集計した合計です（登録済みバージョンとは別）
        </span>
      </div>

      <div v-if="loading" class="text-center py-20 text-gray-500">読み込み中...</div>
      <div v-else-if="error" class="text-center py-20 text-red-600">{{ error }}</div>
      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white rounded-lg shadow p-4">
          <h2 class="font-semibold text-base mb-3">得意先別 売上(請求)金額</h2>
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
