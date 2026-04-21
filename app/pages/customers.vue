<script setup lang="ts">
import VChart from 'vue-echarts'
import type { CustomerDetailResponse, CustomerYoyWithDept, DepartmentOption } from '~/types'
import { AuthToolbar } from '~/composables/useAuth'

const { fetchCustomerYoy, fetchCustomerYoyByDept, fetchCustomerDetail, fetchDepartments } = useSalesData()

const loading = ref(true)
const error = ref('')
// CustomerYoy と CustomerYoyWithDept の統一バケット（全社時は dept フィールドを空文字で埋める）
interface YoyBucket {
  positive: CustomerYoyWithDept[]
  negative: CustomerYoyWithDept[]
  min_prev: number
  months: number
}
const yoyData = ref<YoyBucket>({ positive: [], negative: [], min_prev: 0, months: 0 })
const yoySource = ref('')

const currentYear = new Date().getFullYear()
const from = ref(`${currentYear - 1}-04`)
const to = ref(`${currentYear}-03`)

// 営業所
const selectedDept = ref('')
const departments = ref<DepartmentOption[]>([])

// 増加TOP 表示切替
const showPositive = ref(true)

// 選択中の得意先
const selected = ref<CustomerYoyWithDept | null>(null)
const detailLoading = ref(false)
const detail = ref<CustomerDetailResponse | null>(null)

// ソート状態（プラス・マイナス独立）
type SortKey = 'customer_name' | 'current_total' | 'prev_total' | 'yoy_percent'
type SortOrder = 'asc' | 'desc'
interface SortState { key: SortKey; order: SortOrder }
const positiveSort = ref<SortState>({ key: 'prev_total', order: 'desc' })
const negativeSort = ref<SortState>({ key: 'yoy_percent', order: 'asc' })

function compareYoy(a: CustomerYoyWithDept, b: CustomerYoyWithDept, key: SortKey, order: SortOrder): number {
  const mul = order === 'asc' ? 1 : -1
  if (key === 'customer_name') return a.customer_name.localeCompare(b.customer_name, 'ja') * mul
  return (((a[key] as number) ?? 0) - ((b[key] as number) ?? 0)) * mul
}

const sortedPositive = computed(() => {
  const { key, order } = positiveSort.value
  return [...yoyData.value.positive].sort((a, b) => compareYoy(a, b, key, order))
})
const sortedNegative = computed(() => {
  const { key, order } = negativeSort.value
  return [...yoyData.value.negative].sort((a, b) => compareYoy(a, b, key, order))
})

function toggleSort(which: 'positive' | 'negative', key: SortKey) {
  const stateRef = which === 'positive' ? positiveSort : negativeSort
  if (stateRef.value.key === key) {
    stateRef.value = { key, order: stateRef.value.order === 'asc' ? 'desc' : 'asc' }
  } else {
    stateRef.value = { key, order: key === 'customer_name' ? 'asc' : 'desc' }
  }
}

function sortIcon(state: SortState, key: SortKey): string {
  if (state.key !== key) return '⇅'
  return state.order === 'asc' ? '▲' : '▼'
}

onMounted(async () => {
  // departments と初回データを並列取得
  try {
    const depsRes = await fetchDepartments()
    departments.value = depsRes.data
  } catch {
    departments.value = []
  }
  await loadData()
})

async function loadData() {
  loading.value = true
  error.value = ''
  selected.value = null
  detail.value = null
  try {
    if (selectedDept.value) {
      const res = await fetchCustomerYoyByDept(from.value, to.value, { department_code: selectedDept.value })
      yoyData.value = {
        positive: res.data.positive,
        negative: res.data.negative,
        min_prev: res.data.min_prev,
        months: res.data.months,
      }
      yoySource.value = res.source_table
      // departments は API のレスポンスからも返ってくるので最新化
      if (res.data.departments && res.data.departments.length > 0) {
        departments.value = res.data.departments
      }
    } else {
      const res = await fetchCustomerYoy(from.value, to.value)
      // 全社モードは dept 情報を空文字で埋めて CustomerYoyWithDept 互換に
      yoyData.value = {
        positive: res.data.positive.map(x => ({ ...x, department_code: '', department_name: '' })),
        negative: res.data.negative.map(x => ({ ...x, department_code: '', department_name: '' })),
        min_prev: res.data.min_prev,
        months: res.data.months,
      }
      yoySource.value = res.source_table
    }
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}

async function selectCustomer(item: CustomerYoyWithDept) {
  if (selected.value?.customer_code === item.customer_code) {
    selected.value = null
    detail.value = null
    return
  }
  selected.value = item
  detail.value = null
  detailLoading.value = true
  try {
    const res = await fetchCustomerDetail(item.customer_code)
    detail.value = res.data
  } catch {
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}

function formatMan(val: number) {
  return Math.round(val / 10000).toLocaleString('ja-JP')
}

function formatPct(val: number) {
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}%`
}

// チャート用
const currentFy = computed(() => {
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
})
const fyList = computed(() => {
  const fy = currentFy.value
  return [fy - 4, fy - 3, fy - 2, fy - 1, fy]
})
const monthOrder = ['04月', '05月', '06月', '07月', '08月', '09月', '10月', '11月', '12月', '01月', '02月', '03月']
const colors = ['#d4d4d4', '#b0c4de', '#73c0de', '#5470c6', '#ee6666']

const fyData = computed(() => {
  if (!detail.value) return new Map<number, Map<string, number>>()
  const map = new Map<number, Map<string, number>>()
  for (const m of detail.value.months) {
    const [y, mm] = m.year_month.split('-')
    const mi = parseInt(mm)
    const fy = mi >= 4 ? parseInt(y) : parseInt(y) - 1
    if (!map.has(fy)) map.set(fy, new Map())
    map.get(fy)!.set(`${mm}月`, m.total_sales)
  }
  return map
})

const barOption = computed(() => {
  if (!detail.value) return {}
  return {
    title: { text: `${detail.value.customer_name}　月別売上（5年度比較）`, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const lines = params.filter((p: any) => p.value > 0).map((p: any) => {
          const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          return `${p.marker} ${p.seriesName}: ${val}万円`
        })
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 70, right: 20, bottom: 50, top: 45 },
    xAxis: { type: 'category', data: monthOrder },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 10000).toLocaleString()}万` } },
    series: fyList.value.map((fy, i) => {
      const monthMap = fyData.value.get(fy)
      return { name: `${fy}年度`, type: 'bar', data: monthOrder.map(m => monthMap?.get(m) ?? 0), itemStyle: { color: colors[i] } }
    }),
  }
})

const lineOption = computed(() => {
  if (!detail.value) return {}
  return {
    title: { text: `${detail.value.customer_name}　年度別推移`, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const lines = params.filter((p: any) => p.value != null && p.value > 0).map((p: any) => {
          const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          return `${p.marker} ${p.seriesName}: ${val}万円`
        })
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 70, right: 20, bottom: 50, top: 45 },
    xAxis: { type: 'category', data: monthOrder },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 10000).toLocaleString()}万` } },
    series: fyList.value.map((fy, i) => {
      const monthMap = fyData.value.get(fy)
      return {
        name: `${fy}年度`, type: 'line',
        data: monthOrder.map(m => monthMap?.get(m) ?? null),
        connectNulls: false,
        itemStyle: { color: colors[i] },
        lineStyle: { width: i === 4 ? 3 : 1.5 },
        symbol: 'circle', symbolSize: i === 4 ? 6 : 4,
      }
    }),
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <button class="text-sm text-blue-600 hover:underline" @click="navigateTo('/')">
            &larr; ダッシュボード
          </button>
          <h1 class="text-xl font-bold">得意先 前年同期比ランキング</h1>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <!-- 期間セレクタ + 営業所セレクタ -->
      <div class="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4 flex-wrap">
        <label class="text-sm font-medium">期間:</label>
        <input v-model="from" type="month" class="border rounded px-2 py-1 text-sm" />
        <span>〜</span>
        <input v-model="to" type="month" class="border rounded px-2 py-1 text-sm" />
        <label class="text-sm font-medium ml-2">営業所:</label>
        <select v-model="selectedDept" class="border rounded px-2 py-1 text-sm" @change="loadData">
          <option value="">全社</option>
          <option v-for="d in departments" :key="d.department_code" :value="d.department_code">
            {{ d.department_name || d.department_code }}
          </option>
        </select>
        <button class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700" @click="loadData">更新</button>
        <span v-if="yoySource" class="text-xs text-gray-400 ml-auto">
          前年{{ yoyData.months }}ヶ月合計 {{ formatMan(yoyData.min_prev) }}万円以上 / {{ yoySource }}
        </span>
      </div>

      <div v-if="loading" class="text-center py-20">
        <p class="text-gray-500 text-lg">読み込み中...</p>
      </div>
      <div v-else-if="error" class="text-center py-20">
        <p class="text-red-600 text-lg">{{ error }}</p>
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- 左: ランキング2列 -->
        <div class="lg:col-span-1 space-y-4">
          <!-- 増加 -->
          <div class="bg-white rounded-lg shadow p-3">
            <h3 class="text-sm font-semibold text-green-700 mb-2 flex items-center justify-between">
              <span class="flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full bg-green-500" /> 増加 TOP
              </span>
              <button class="text-xs text-gray-400 hover:text-gray-600" @click="showPositive = !showPositive">
                {{ showPositive ? '非表示' : '表示' }}
              </button>
            </h3>
            <div v-if="showPositive" class="overflow-auto max-h-[400px]">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-white">
                  <tr class="border-b text-gray-500">
                    <th class="text-left py-1 w-6">#</th>
                    <th v-if="selectedDept" class="text-left py-1">営業所</th>
                    <th class="text-left py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'customer_name')">
                        得意先<span class="text-[10px]">{{ sortIcon(positiveSort, 'customer_name') }}</span>
                      </button>
                    </th>
                    <th class="text-right py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'prev_total')">
                        前年<span class="text-[10px]">{{ sortIcon(positiveSort, 'prev_total') }}</span>
                      </button>
                    </th>
                    <th class="text-right py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'current_total')">
                        今期<span class="text-[10px]">{{ sortIcon(positiveSort, 'current_total') }}</span>
                      </button>
                    </th>
                    <th class="text-right py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'yoy_percent')">
                        YoY%<span class="text-[10px]">{{ sortIcon(positiveSort, 'yoy_percent') }}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(item, i) in sortedPositive" :key="item.customer_code"
                    class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                    :class="{ 'bg-blue-100': selected?.customer_code === item.customer_code }"
                    @click="selectCustomer(item)"
                  >
                    <td class="py-1 text-gray-400">{{ i + 1 }}</td>
                    <td v-if="selectedDept" class="py-1 truncate max-w-[90px]" :title="item.department_name || item.department_code">{{ item.department_name || item.department_code }}</td>
                    <td class="py-1 truncate max-w-[120px]" :title="item.customer_name">{{ item.customer_name }}</td>
                    <td class="py-1 text-right text-gray-500">{{ formatMan(item.prev_total) }}</td>
                    <td class="py-1 text-right">{{ formatMan(item.current_total) }}</td>
                    <td class="py-1 text-right font-semibold text-green-600">{{ formatPct(item.yoy_percent) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 減少 -->
          <div class="bg-white rounded-lg shadow p-3">
            <h3 class="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
              <span class="inline-block w-2 h-2 rounded-full bg-red-500" /> 減少 TOP
            </h3>
            <div class="overflow-auto max-h-[400px]">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-white">
                  <tr class="border-b text-gray-500">
                    <th class="text-left py-1 w-6">#</th>
                    <th v-if="selectedDept" class="text-left py-1">営業所</th>
                    <th class="text-left py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'customer_name')">
                        得意先<span class="text-[10px]">{{ sortIcon(negativeSort, 'customer_name') }}</span>
                      </button>
                    </th>
                    <th class="text-right py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'prev_total')">
                        前年<span class="text-[10px]">{{ sortIcon(negativeSort, 'prev_total') }}</span>
                      </button>
                    </th>
                    <th class="text-right py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'current_total')">
                        今期<span class="text-[10px]">{{ sortIcon(negativeSort, 'current_total') }}</span>
                      </button>
                    </th>
                    <th class="text-right py-1">
                      <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'yoy_percent')">
                        YoY%<span class="text-[10px]">{{ sortIcon(negativeSort, 'yoy_percent') }}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(item, i) in sortedNegative" :key="item.customer_code"
                    class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                    :class="{ 'bg-blue-100': selected?.customer_code === item.customer_code }"
                    @click="selectCustomer(item)"
                  >
                    <td class="py-1 text-gray-400">{{ i + 1 }}</td>
                    <td v-if="selectedDept" class="py-1 truncate max-w-[90px]" :title="item.department_name || item.department_code">{{ item.department_name || item.department_code }}</td>
                    <td class="py-1 truncate max-w-[120px]" :title="item.customer_name">{{ item.customer_name }}</td>
                    <td class="py-1 text-right text-gray-500">{{ formatMan(item.prev_total) }}</td>
                    <td class="py-1 text-right">{{ formatMan(item.current_total) }}</td>
                    <td class="py-1 text-right font-semibold text-red-600">{{ formatPct(item.yoy_percent) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 右: 選択した得意先のチャート -->
        <div class="lg:col-span-2">
          <div v-if="!selected" class="bg-white rounded-lg shadow p-8 text-center text-gray-400">
            <p class="text-lg">得意先をクリックすると売上推移を表示します</p>
          </div>

          <div v-else-if="detailLoading" class="bg-white rounded-lg shadow p-8 text-center">
            <p class="text-gray-500">{{ selected.customer_name }} を読み込み中...</p>
          </div>

          <div v-else-if="detail" class="space-y-4">
            <div class="bg-white rounded-lg shadow p-3">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm font-bold">{{ detail.customer_name }} <span class="text-gray-400 font-normal">{{ detail.customer_code }}</span></span>
                <span class="text-xs px-2 py-0.5 rounded" :class="selected.yoy_percent >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                  YoY {{ formatPct(selected.yoy_percent) }}
                </span>
              </div>
              <VChart :option="barOption" style="height: 350px" autoresize />
            </div>

            <div class="bg-white rounded-lg shadow p-3">
              <VChart :option="lineOption" style="height: 300px" autoresize />
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
