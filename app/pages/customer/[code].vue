<script setup lang="ts">
import VChart from 'vue-echarts'
import type { CustomerDetailResponse } from '~/types'

const route = useRoute()
const code = route.params.code as string

const { isAuthenticated, init, logout, user } = useAuth()
const { fetchCustomerDetail } = useSalesData()

const loading = ref(true)
const error = ref('')
const detail = ref<CustomerDetailResponse | null>(null)
const sourceTable = ref('')

onMounted(async () => {
  init()
  if (!isAuthenticated.value) {
    navigateTo('/login')
    return
  }
  await loadData()
})

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchCustomerDetail(code)
    detail.value = res.data
    sourceTable.value = res.source_table
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}

// 直近5年度を算出（4月始まり。今が2026-03なら現年度は2025年度）
const currentFy = computed(() => {
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
})

const fyList = computed(() => {
  const fy = currentFy.value
  return [fy - 4, fy - 3, fy - 2, fy - 1, fy]
})

const monthOrder = ['04月', '05月', '06月', '07月', '08月', '09月', '10月', '11月', '12月', '01月', '02月', '03月']

// データを年度×月のマップに変換
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

// メインチャート: 5年度横並び棒グラフ（月別）
const colors = ['#d4d4d4', '#b0c4de', '#73c0de', '#5470c6', '#ee6666']

const chartOption = computed(() => {
  if (!detail.value) return {}
  const d = detail.value

  return {
    title: { text: `${d.customer_name}　月別売上推移（5年度比較）`, left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const lines = params
          .filter((p: any) => p.value != null && p.value > 0)
          .map((p: any) => {
            const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
            return `${p.marker} ${p.seriesName}: ${val}万円`
          })
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 80, right: 30, bottom: 50, top: 50 },
    xAxis: { type: 'category', data: monthOrder },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    series: fyList.value.map((fy, i) => {
      const monthMap = fyData.value.get(fy)
      return {
        name: `${fy}年度`,
        type: 'bar',
        data: monthOrder.map(m => monthMap?.get(m) ?? 0),
        itemStyle: { color: colors[i] },
      }
    }),
  }
})

// 年度別比較（折れ線）— 5年度固定
const yoyOption = computed(() => {
  if (!detail.value) return null
  const d = detail.value

  return {
    title: { text: `${d.customer_name}　年度別推移（4月〜3月）`, left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const lines = params
          .filter((p: any) => p.value != null && p.value > 0)
          .map((p: any) => {
            const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
            return `${p.marker} ${p.seriesName}: ${val}万円`
          })
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 80, right: 30, bottom: 50, top: 50 },
    xAxis: { type: 'category', data: monthOrder },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    series: fyList.value.map((fy, i) => {
      const monthMap = fyData.value.get(fy)
      return {
        name: `${fy}年度`,
        type: 'line',
        data: monthOrder.map(m => monthMap?.get(m) ?? null),
        connectNulls: false,
        itemStyle: { color: colors[i] },
        lineStyle: { width: i === 4 ? 3 : 1.5 },
        symbol: 'circle',
        symbolSize: i === 4 ? 6 : 4,
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
          <h1 class="text-xl font-bold">
            {{ detail?.customer_name || code }}
          </h1>
          <span class="text-sm text-gray-400">{{ code }}</span>
        </div>
        <div class="flex items-center gap-4">
          <span v-if="user" class="text-sm text-gray-600">{{ user.name }}</span>
          <button class="text-sm text-red-600 hover:underline" @click="logout">ログアウト</button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div v-if="loading" class="text-center py-20">
        <p class="text-gray-500 text-lg">読み込み中...</p>
      </div>
      <div v-else-if="error" class="text-center py-20">
        <p class="text-red-600 text-lg">{{ error }}</p>
        <button class="mt-4 bg-blue-600 text-white px-4 py-2 rounded" @click="loadData">再試行</button>
      </div>

      <div v-else-if="detail" class="space-y-6">
        <!-- 月別売上 5年度横並び棒グラフ -->
        <div class="bg-white rounded-lg shadow p-4">
          <VChart :option="chartOption" style="height: 400px" autoresize />
          <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
        </div>

        <!-- 年度別比較（折れ線） -->
        <div v-if="yoyOption" class="bg-white rounded-lg shadow p-4">
          <VChart :option="yoyOption" style="height: 400px" autoresize />
        </div>
      </div>
    </main>
  </div>
</template>
