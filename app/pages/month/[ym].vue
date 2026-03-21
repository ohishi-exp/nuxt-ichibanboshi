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
const yAxisMax = ref<number | undefined>(undefined)

const billingMode = ref('billing')
const billingModes = [
  { value: 'billing', label: '請求+請求のみ' },
  { value: 'non_billing', label: '請求+非請求' },
  { value: 'all', label: '全て' },
]

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const [daily, billing, nonBilling, dept, cust] = await Promise.all([
      fetchDailySales(ym, billingMode.value),
      fetchDailySales(ym, 'billing'),
      fetchDailySales(ym, 'non_billing'),
      fetchDepartmentSales(ym, ym),
      fetchCustomerSales(ym, ym),
    ])
    dailySales.value = daily.data
    dailySource.value = daily.source_table

    // 両モードの最大値で Y軸を固定（切り替え時にスケールが動かないように）
    const allTotals = [
      ...billing.data.map(d => d.total_sales + (d.prev_year_total || 0)),
      ...nonBilling.data.map(d => d.total_sales + (d.prev_year_total || 0)),
    ]
    const maxVal = Math.max(...allTotals, 0)
    // 切りの良い数字に丸める
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal || 1)))
    yAxisMax.value = Math.ceil(maxVal / magnitude) * magnitude

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

async function switchMode(mode: string) {
  billingMode.value = mode
  try {
    const daily = await fetchDailySales(ym, mode)
    dailySales.value = daily.data
    dailySource.value = daily.source_table
  } catch {}
}

function handleKeydown(e: KeyboardEvent) {
  const modes = billingModes.map(m => m.value)
  const idx = modes.indexOf(billingMode.value)
  if (e.key === 'ArrowLeft' && idx > 0) {
    switchMode(modes[idx - 1])
  } else if (e.key === 'ArrowRight' && idx < modes.length - 1) {
    switchMode(modes[idx + 1])
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  init()
  if (!isAuthenticated.value) {
    navigateTo('/login')
    return
  }
  await loadData()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

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
        <!-- 請求K モード切替 -->
        <div class="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <span class="text-sm font-medium">請求区分:</span>
          <div class="flex gap-2">
            <button
              v-for="m in billingModes"
              :key="m.value"
              class="px-3 py-1 rounded text-sm"
              :class="billingMode === m.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
              @click="switchMode(m.value)"
            >
              {{ m.label }}
            </button>
          </div>
        </div>

        <DailySalesChart :data="dailySales" :month="displayMonth" :source-table="dailySource" :y-axis-max="yAxisMax" />

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DepartmentSalesChart :data="departmentSales" :source-table="deptSource" />
          <CustomerSalesChart :data="customerSales" :source-table="custSource" />
        </div>
      </div>
    </main>
  </div>
</template>
