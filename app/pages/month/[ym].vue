<script setup lang="ts">
import type { DailySales, DepartmentSales, CustomerSales } from '~/types'
import { AuthToolbar } from '~/composables/useAuth'

const route = useRoute()
const ym = route.params.ym as string
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
]

const excludeMiyazaki = ref(false)

const amountMode = ref<'tax_excl' | 'raw'>('tax_excl')
const amountModes = [
  { value: 'tax_excl' as const, label: '税抜（月計一致）' },
  { value: 'raw' as const, label: '金額ベース' },
]

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const dept_param = excludeMiyazaki.value ? '宮崎' : undefined
    const [daily, billing, nonBilling, dept, cust] = await Promise.all([
      fetchDailySales(ym, billingMode.value, dept_param),
      fetchDailySales(ym, 'billing', dept_param),
      fetchDailySales(ym, 'non_billing', dept_param),
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
    const daily = await fetchDailySales(ym, mode, excludeMiyazaki.value ? '宮崎' : undefined)
    dailySales.value = daily.data
    dailySource.value = daily.source_table
  } catch {}
}

async function toggleMiyazaki() {
  try {
    const dept_param = excludeMiyazaki.value ? '宮崎' : undefined
    const daily = await fetchDailySales(ym, billingMode.value, dept_param)
    dailySales.value = daily.data
    dailySource.value = daily.source_table
  } catch {}
}

const activeControl = ref<'billing' | 'amount'>('billing')

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    activeControl.value = activeControl.value === 'billing' ? 'amount' : 'billing'
    return
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (activeControl.value === 'billing') {
      const modes = billingModes.map(m => m.value)
      const idx = modes.indexOf(billingMode.value)
      if (e.key === 'ArrowLeft' && idx > 0) {
        switchMode(modes[idx - 1])
      } else if (e.key === 'ArrowRight' && idx < modes.length - 1) {
        switchMode(modes[idx + 1])
      }
    } else {
      const modes = amountModes.map(m => m.value)
      const idx = modes.indexOf(amountMode.value)
      if (e.key === 'ArrowLeft' && idx > 0) {
        amountMode.value = modes[idx - 1] as typeof amountMode.value
      } else if (e.key === 'ArrowRight' && idx < modes.length - 1) {
        amountMode.value = modes[idx + 1] as typeof amountMode.value
      }
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
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
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
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
        <!-- 切替コントロール -->
        <div class="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-6">
          <div
            class="flex items-center gap-2 px-2 py-1 rounded"
            :class="activeControl === 'billing' ? 'ring-2 ring-blue-400' : ''"
            @click="activeControl = 'billing'"
          >
            <span class="text-sm font-medium">請求区分:</span>
            <div class="flex gap-2">
              <button
                v-for="m in billingModes"
                :key="m.value"
                class="px-3 py-1 rounded text-sm"
                :class="billingMode === m.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
                @click="activeControl = 'billing'; switchMode(m.value)"
              >
                {{ m.label }}
              </button>
            </div>
          </div>
          <div
            class="flex items-center gap-2 px-2 py-1 rounded"
            :class="activeControl === 'amount' ? 'ring-2 ring-green-400' : ''"
            @click="activeControl = 'amount'"
          >
            <span class="text-sm font-medium">金額:</span>
            <div class="flex gap-2">
              <button
                v-for="m in amountModes"
                :key="m.value"
                class="px-3 py-1 rounded text-sm"
                :class="amountMode === m.value
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
                @click="activeControl = 'amount'; amountMode = m.value"
              >
                {{ m.label }}
              </button>
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm cursor-pointer select-none ml-auto">
            <input v-model="excludeMiyazaki" type="checkbox" class="rounded" @change="toggleMiyazaki" />
            宮崎除く
          </label>
          <span class="text-xs text-gray-400">Tab: 切替 / ← →: 選択</span>
        </div>

        <DailySalesChart :data="dailySales" :month="displayMonth" :source-table="dailySource" :y-axis-max="yAxisMax" :amount-mode="amountMode" />

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DepartmentSalesChart :data="departmentSales" :source-table="deptSource" />
          <CustomerSalesChart :data="customerSales" :source-table="custSource" />
        </div>
      </div>
    </main>
  </div>
</template>
