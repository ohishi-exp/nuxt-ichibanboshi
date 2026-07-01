<script setup lang="ts">
/**
 * 得意先ネット ドリルダウンページ (rust-ichibanboshi#68)。
 *
 * `UnchinCustomerNetPanel` の行/バークリックから
 * `/unchin/customer-net/<partner_code>?from=&to=&kind=&code=&h=&name=` で遷移する
 * (`customer/[code].vue` と同じ別ページ遷移パターン)。運行 (運転日報明細の行) 単位で
 * 請求 (sales)・傭車支払 (payment)・行単位の差額を一覧表示する。
 * 自社便 (傭車を使わなかった運行) は rust-ichibanboshi#69 で SQL 側から常に
 * 除外されるため、`subcontractor_name` は基本的に空にならない (データ異常時の
 * 保険として fallback 表示のみ残す)。
 */
import { AuthToolbar } from '~/composables/useAuth'

interface CustomerNetDetailRow {
  item_code: string
  item_name: string
  subcontractor_name: string
  sales: number
  payment: number
  diff: number
  origin: string
  dest: string
  sale_date: string
  bumon_code: string
  bumon_name: string
}
interface CustomerNetDetailResponse {
  source_table: string
  data: CustomerNetDetailRow[]
}

type Kind = 'with_billing_only' | 'with_non_billing'
const KIND_OPTIONS: { value: Kind, label: string }[] = [
  { value: 'with_non_billing', label: '請求＋非請求 (請求K IN (0,2)、default)' },
  { value: 'with_billing_only', label: '請求＋請求のみ (請求K IN (0,1))' },
]

const route = useRoute()
const partnerCode = computed(() => decodeURIComponent(String(route.params.code ?? '')))
const partnerName = computed(() => String(route.query.name ?? ''))

/** `得意先C-得意先H` を分割する (query の code/h が無い直接アクセス時の fallback)。 */
function splitPartnerCode(code: string): { code: string, h: string } {
  const idx = code.indexOf('-')
  return idx === -1 ? { code, h: '' } : { code: code.slice(0, idx), h: code.slice(idx + 1) }
}

const currentYear = new Date().getFullYear()
const from = ref((route.query.from as string) || `${currentYear}-01-01`)
const to = ref((route.query.to as string) || `${currentYear + 1}-01-01`)
const kind = ref<Kind>((route.query.kind as Kind) || 'with_non_billing')

const loading = ref(true)
const error = ref('')
const rows = ref<CustomerNetDetailRow[]>([])
const sourceTable = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const split = splitPartnerCode(partnerCode.value)
    const code = (route.query.code as string) || split.code
    const h = (route.query.h as string) || split.h
    const params = new URLSearchParams({
      from: from.value,
      to: to.value,
      kind: kind.value,
      code,
      h,
    })
    const res = await $fetch<CustomerNetDetailResponse>(
      `/api/unchin/customer-net-detail?${params.toString()}`,
    )
    rows.value = res.data
    sourceTable.value = res.source_table
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    error.value = `読み込みに失敗しました: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

function fmtYen(n: number): string {
  return n.toLocaleString('ja-JP')
}

const grandSales = computed(() => rows.value.reduce((s, r) => s + r.sales, 0))
const grandPayment = computed(() => rows.value.reduce((s, r) => s + r.payment, 0))
const grandDiff = computed(() => rows.value.reduce((s, r) => s + r.diff, 0))
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow no-print">
      <div class="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <button
            type="button"
            class="text-sm text-gray-700 border border-gray-400 rounded px-3 py-1 bg-white hover:bg-gray-100"
            @click="navigateTo('/unchin')"
          >
            ← 一覧へ戻る
          </button>
          <h1 class="text-xl font-bold">
            得意先ネット明細 — {{ partnerName || partnerCode }}
          </h1>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" />
      </div>
    </header>

    <main class="max-w-6xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-4 flex items-end gap-3 flex-wrap no-print">
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

      <div class="bg-white rounded-lg shadow p-4 print-section">
        <p class="text-xs text-gray-400 mb-3">{{ sourceTable }}</p>
        <div v-if="loading" class="text-center py-10 text-gray-500 text-sm">読み込み中...</div>
        <div v-else-if="error" class="text-center py-10 text-red-600 text-sm">{{ error }}</div>
        <div v-else-if="rows.length === 0" class="text-center py-10 text-gray-500 text-sm">
          データがありません
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="text-left py-1">日付</th>
                <th class="text-left py-1">品目</th>
                <th class="text-left py-1">傭車先</th>
                <th class="text-left py-1">積地・卸地</th>
                <th class="text-right py-1">請求</th>
                <th class="text-right py-1">傭車支払</th>
                <th class="text-right py-1">差額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="i" class="border-b border-gray-100">
                <td class="py-1">{{ r.sale_date }}</td>
                <td class="py-1">{{ r.item_name || r.item_code }}</td>
                <td class="py-1">{{ r.subcontractor_name || '(不明)' }}</td>
                <td class="py-1 text-xs text-gray-500">{{ r.origin }} → {{ r.dest }}</td>
                <td class="py-1 text-right">{{ fmtYen(r.sales) }}</td>
                <td class="py-1 text-right">{{ fmtYen(r.payment) }}</td>
                <td
                  class="py-1 text-right font-mono"
                  :class="r.diff >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                >
                  {{ fmtYen(r.diff) }}
                </td>
              </tr>
            </tbody>
            <tfoot class="border-t-2 border-gray-300 bg-gray-50">
              <tr>
                <td class="py-2 font-semibold" colspan="4">合計 ({{ rows.length }} 件)</td>
                <td class="py-2 text-right font-mono font-semibold">{{ fmtYen(grandSales) }}</td>
                <td class="py-2 text-right font-mono font-semibold">{{ fmtYen(grandPayment) }}</td>
                <td
                  class="py-2 text-right font-mono font-semibold"
                  :class="grandDiff >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                >
                  {{ fmtYen(grandDiff) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </main>
  </div>
</template>
