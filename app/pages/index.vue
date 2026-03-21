<script setup lang="ts">
import type { MonthlySales, DepartmentSales, CustomerSales, YoyComparison } from '~/types'

const { isAuthenticated, init, logout, user } = useAuth()
const { fetchMonthlySales, fetchDepartmentSales, fetchCustomerSales, fetchYoy } = useSalesData()

const loading = ref(true)
const error = ref('')

const monthlySales = ref<MonthlySales[]>([])
const departmentSales = ref<DepartmentSales[]>([])
const customerSales = ref<CustomerSales[]>([])
const yoyData = ref<YoyComparison[]>([])

const currentYear = new Date().getFullYear()
const from = ref(`${currentYear - 1}-04`)
const to = ref(`${currentYear}-03`)

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
    const [monthly, dept, cust, yoy] = await Promise.all([
      fetchMonthlySales(from.value, to.value),
      fetchDepartmentSales(from.value, to.value),
      fetchCustomerSales(from.value, to.value),
      fetchYoy(currentYear),
    ])
    monthlySales.value = monthly
    departmentSales.value = dept
    customerSales.value = cust
    yoyData.value = yoy
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Header -->
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 class="text-xl font-bold">一番星 売上ダッシュボード</h1>
        <div class="flex items-center gap-4">
          <span v-if="user" class="text-sm text-gray-600">{{ user.name }}</span>
          <button class="text-sm text-red-600 hover:underline" @click="logout">ログアウト</button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <!-- Period selector -->
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

      <!-- Loading / Error -->
      <div v-if="loading" class="text-center py-20">
        <p class="text-gray-500 text-lg">読み込み中...</p>
      </div>
      <div v-else-if="error" class="text-center py-20">
        <p class="text-red-600 text-lg">{{ error }}</p>
        <button class="mt-4 bg-blue-600 text-white px-4 py-2 rounded" @click="loadData">
          再試行
        </button>
      </div>

      <!-- Charts -->
      <div v-else class="space-y-6">
        <MonthlySalesChart :data="monthlySales" />

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DepartmentSalesChart :data="departmentSales" />
          <CustomerSalesChart :data="customerSales" />
        </div>

        <YoyChart :data="yoyData" :year="currentYear" />
      </div>
    </main>
  </div>
</template>
