<script setup lang="ts">
import type { DailySales, DepartmentSales, CustomerSales } from '~/types'

const route = useRoute()
const ym = route.params.ym as string
const { isAuthenticated, init, logout, user } = useAuth()
const { fetchDailySales, fetchDepartmentSales, fetchCustomerSales } = useSalesData()

const loading = ref(true)
const error = ref('')
const dailySales = ref<DailySales[]>([])
const departmentSales = ref<DepartmentSales[]>([])
const customerSales = ref<CustomerSales[]>([])
const dailySource = ref('')
const deptSource = ref('')
const custSource = ref('')

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
    const [daily, dept, cust] = await Promise.all([
      fetchDailySales(ym),
      fetchDepartmentSales(ym, ym),
      fetchCustomerSales(ym, ym),
    ])
    dailySales.value = daily.data
    dailySource.value = daily.source_table
    departmentSales.value = dept.data
    deptSource.value = dept.source_table
    customerSales.value = cust.data
    custSource.value = cust.source_table
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}

const [year, month] = ym.split('-')
const displayMonth = `${year}年${parseInt(month)}月`
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <button class="text-blue-600 hover:underline text-sm" @click="navigateTo('/')">
            ← ダッシュボード
          </button>
          <h1 class="text-xl font-bold">{{ displayMonth }} 売上詳細</h1>
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
      </div>

      <div v-else class="space-y-6">
        <DailySalesChart :data="dailySales" :month="displayMonth" :source-table="dailySource" />

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DepartmentSalesChart :data="departmentSales" :source-table="deptSource" />
          <CustomerSalesChart :data="customerSales" :source-table="custSource" />
        </div>
      </div>
    </main>
  </div>
</template>
