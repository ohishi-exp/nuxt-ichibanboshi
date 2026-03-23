<script setup lang="ts">
import type { MonthlySales, DepartmentSales, CustomerSales, YoyComparison, CustomerMonthly, CustomerYoyResponse } from '~/types'

const { isAuthenticated, init, logout, user } = useAuth()
const { fetchMonthlySales, fetchDepartmentSales, fetchCustomerSales, fetchYoy, fetchCustomerTrend, fetchCustomerYoy } = useSalesData()

const loading = ref(true)
const error = ref('')

const monthlySales = ref<MonthlySales[]>([])
const monthlyYMax = ref(0)
const departmentSales = ref<DepartmentSales[]>([])
const customerSales = ref<CustomerSales[]>([])
const yoyData = ref<YoyComparison[]>([])

const monthlySource = ref('')
const deptSource = ref('')
const custSource = ref('')
const yoySource = ref('')
const customerTrend = ref<CustomerMonthly[]>([])
const trendSource = ref('')
const customerYoyData = ref<CustomerYoyResponse>({ positive: [], negative: [] })
const customerYoySource = ref('')

const currentYear = new Date().getFullYear()
const from = ref(`${currentYear - 1}-04`)
const to = ref(`${currentYear}-03`)
const excludeMiyazaki = ref(false)

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
    const [monthly, dept, cust, yoy, trend, custYoy] = await Promise.all([
      fetchMonthlySales(from.value, to.value, excludeMiyazaki.value ? '宮崎' : undefined),
      fetchDepartmentSales(from.value, to.value),
      fetchCustomerSales(from.value, to.value),
      fetchYoy(currentYear),
      fetchCustomerTrend(from.value, to.value),
      fetchCustomerYoy(from.value, to.value),
    ])
    monthlySales.value = monthly.data
    monthlySource.value = monthly.source_table
    monthlyYMax.value = Math.max(...monthly.data.map(d => Math.max(d.total_sales, d.prev_year_total)))
    departmentSales.value = dept.data
    deptSource.value = dept.source_table
    customerSales.value = cust.data
    custSource.value = cust.source_table
    yoyData.value = yoy.data
    yoySource.value = yoy.source_table
    customerTrend.value = trend.data
    trendSource.value = trend.source_table
    customerYoyData.value = custYoy.data
    customerYoySource.value = custYoy.source_table
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}

async function reloadMonthly() {
  try {
    const monthly = await fetchMonthlySales(from.value, to.value, excludeMiyazaki.value ? '宮崎' : undefined)
    monthlySales.value = monthly.data
    monthlySource.value = monthly.source_table
  } catch {}
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 class="text-xl font-bold">一番星 売上ダッシュボード</h1>
        <div class="flex items-center gap-4">
          <span v-if="user" class="text-sm text-gray-600">{{ user.name }}</span>
          <button class="text-sm text-red-600 hover:underline no-print" @click="logout">ログアウト</button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4">
        <label class="text-sm font-medium">期間:</label>
        <input v-model="from" type="month" class="border rounded px-2 py-1 text-sm" />
        <span>〜</span>
        <input v-model="to" type="month" class="border rounded px-2 py-1 text-sm" />
        <button
          class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700"
          @click="loadData"
        >
          更新
        </button>
      </div>

      <div v-if="loading" class="text-center py-20">
        <p class="text-gray-500 text-lg">読み込み中...</p>
      </div>
      <div v-else-if="error" class="text-center py-20">
        <p class="text-red-600 text-lg">{{ error }}</p>
        <button class="mt-4 bg-blue-600 text-white px-4 py-2 rounded" @click="loadData">
          再試行
        </button>
      </div>

      <div v-else class="space-y-6">
        <div>
          <div class="flex justify-end mb-1">
            <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input v-model="excludeMiyazaki" type="checkbox" class="rounded" @change="reloadMonthly" />
              宮崎除く
            </label>
          </div>
          <MonthlySalesChart :data="monthlySales" :source-table="monthlySource" :y-max="monthlyYMax" />
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="print-section print-chart">
            <DepartmentSalesChart :data="departmentSales" :source-table="deptSource" />
          </div>
          <div class="print-section print-chart">
            <CustomerSalesChart :data="customerSales" :source-table="custSource" />
          </div>
        </div>

        <div class="print-section print-chart">
          <YoyChart :data="yoyData" :year="currentYear" :source-table="yoySource" />
        </div>

        <div class="print-section print-table">
          <CustomerYoyRanking :data="customerYoyData" :source-table="customerYoySource" />
        </div>

        <div class="print-section print-chart">
          <CustomerBumpChart :data="customerTrend" :source-table="trendSource" />
        </div>

        <div class="print-section print-chart">
          <CustomerBarRace :data="customerTrend" :source-table="trendSource" />
        </div>

        <div class="print-section print-chart">
          <CustomerStackedArea :data="customerTrend" :source-table="trendSource" />
        </div>
      </div>
    </main>
  </div>
</template>
