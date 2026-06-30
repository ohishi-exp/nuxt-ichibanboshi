<script setup lang="ts">
import type { MonthlySales, DepartmentSales, CustomerSales, YoyComparison, CustomerMonthly, CustomerYoyResponse, DepartmentOption } from '~/types'
import { AuthToolbar } from '~/composables/useAuth'

const { fetchMonthlySales, fetchDepartmentSales, fetchCustomerSales, fetchYoy, fetchCustomerTrend, fetchCustomerYoy, fetchCustomerYoyByDept, fetchDepartments } = useSalesData()

const loading = ref(true)
const error = ref('')

const monthlySales = ref<MonthlySales[]>([])
// monthlySales から派生する Y軸 auto max (営業所セレクタ変更時も自動追従)。
// ref + 代入だと reloadMonthly() で更新し忘れて Y軸固定 OFF でも古い値で張り付く
// バグ (chart 上で本社単独データなのに全社合計値の高さで縦軸が固定される) が
// 発生したため computed 化した。
const monthlyYMax = computed(() =>
  monthlySales.value.length > 0
    ? Math.max(...monthlySales.value.map(d => Math.max(d.total_sales, d.prev_year_total)))
    : 0,
)
const departmentSales = ref<DepartmentSales[]>([])
const customerSales = ref<CustomerSales[]>([])
const yoyData = ref<YoyComparison[]>([])

const monthlySource = ref('')
const deptSource = ref('')
const custSource = ref('')
const yoySource = ref('')
const customerTrend = ref<CustomerMonthly[]>([])
const trendSource = ref('')
const customerYoyData = ref<CustomerYoyResponse>({ positive: [], negative: [], min_prev: 0, months: 0 })
const customerYoySource = ref('')
const customerYoyDept = ref('')
const departments = ref<DepartmentOption[]>([])

const currentYear = new Date().getFullYear()
// 期間は localStorage 永続化 (user 2026-06-30 「期間を localstorage 保存にして」)。
// SSR 時は default 値を返し、client mount 後に localStorage から復元 + watch で書き戻し。
// YYYY-MM 形式の妥当性チェック付き (壊れた値は default fallback)。
const PERIOD_FROM_KEY = 'ichibanboshi:period:from'
const PERIOD_TO_KEY = 'ichibanboshi:period:to'
const defaultFrom = `${currentYear - 1}-04`
const defaultTo = `${currentYear}-03`
function loadPeriod(key: string, fallback: string): string {
  if (!import.meta.client) return fallback
  const saved = window.localStorage.getItem(key)
  return saved && /^\d{4}-\d{2}$/.test(saved) ? saved : fallback
}
const from = ref(loadPeriod(PERIOD_FROM_KEY, defaultFrom))
const to = ref(loadPeriod(PERIOD_TO_KEY, defaultTo))
if (import.meta.client) {
  watch(from, (v) => window.localStorage.setItem(PERIOD_FROM_KEY, v))
  watch(to, (v) => window.localStorage.setItem(PERIOD_TO_KEY, v))
}
// 月別売上チャートのフィルタ: '' = 全社 / 'exclude:宮崎' = 宮崎除く / 'include:<code>' = 特定営業所
const monthlyFilter = ref('')

function parseMonthlyFilter(v: string) {
  if (v.startsWith('include:')) return { includeDept: v.slice(8) }
  if (v.startsWith('exclude:')) return { excludeDept: v.slice(8) }
  return {}
}

// Top N 得意先 (期間指定)
const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
const topFrom = ref(currentMonth)
const topTo = ref(currentMonth)
const topLimit = ref(10)
const topLoading = ref(false)
const topError = ref('')
const topTrend = ref<CustomerMonthly[]>([])
const topSource = ref('')

const topRanking = computed(() => {
  const totals = topTrend.value.map((c) => {
    const total = c.months.reduce((sum, m) => sum + (m.total_sales || 0), 0)
    return {
      customer_code: c.customer_code,
      customer_name: c.customer_name,
      total,
    }
  })
  const grandTotal = totals.reduce((sum, t) => sum + t.total, 0)
  return totals
    .sort((a, b) => b.total - a.total)
    .slice(0, topLimit.value)
    .map((t, idx) => ({
      rank: idx + 1,
      customer_code: t.customer_code,
      customer_name: t.customer_name,
      total: t.total,
      share: grandTotal > 0 ? (t.total / grandTotal) * 100 : 0,
    }))
})

async function loadTopRanking() {
  topLoading.value = true
  topError.value = ''
  try {
    // customer-trend は limit=N で上位 N 社のみ返すので、構成比の母数を広く取るため多めに取得
    const fetchLimit = Math.max(topLimit.value, 50)
    const res = await fetchCustomerTrend(topFrom.value, topTo.value, fetchLimit)
    topTrend.value = res.data
    topSource.value = res.source_table
  } catch (e: any) {
    topError.value = e.message || '読み込みに失敗しました'
  } finally {
    topLoading.value = false
  }
}

onMounted(async () => {
  try {
    const deps = await fetchDepartments()
    departments.value = deps.data
  } catch {
    departments.value = []
  }
  await Promise.all([loadData(), loadTopRanking(), loadPersonMonthlyTotals()])
})

// ── 担当者順位推移 / 構成順位 / 構成推移 (rust uriage_person_daily 由来、Refs #762) ──
interface PersonMonthlyTotalRow {
  month: string
  person_name: string
  eigyosho_id: number
  cal: boolean
  kingaku: number
  yosha_kingaku: number
  kensuu: number
  /** 横横=0 (= 自社運行 or sql_from_other) のみの集計値 (横横除外フィルタ用)。
   * backend が省略する場合あり (旧 data) → undefined fallback で 0 扱い。 */
  kingaku_y0?: number
  yosha_kingaku_y0?: number
  kensuu_y0?: number
  calculated_at: string
}
interface PersonMonthlyTotalsResponse {
  from: string
  to: string
  cal: boolean
  rows: PersonMonthlyTotalRow[]
}
const personMonthlyRows = ref<PersonMonthlyTotalRow[]>([])
const personMonthlyError = ref('')
/** 横横除外フィルタ (true = 自社運行のみ、false = 全部) */
const excludeYokoyoko = ref(false)
/** 期間ラベル (構成順位 表のキャプション用) */
const periodLabel = computed(() => `${from.value} 〜 ${to.value}`)

async function loadPersonMonthlyTotals() {
  personMonthlyError.value = ''
  try {
    // ページ全体の期間 (from/to YYYY-MM) と連動。期間を変えて「更新」を押すと
    // chart も再 fetch される。
    const res = await $fetch<PersonMonthlyTotalsResponse>(
      `/api/uriage/person-monthly-totals?from=${from.value}&to=${to.value}&cal=true`,
    )
    personMonthlyRows.value = res.rows
  } catch (e: unknown) {
    // recalc 未実行 / endpoint 未到達でも他チャートは表示する
    personMonthlyRows.value = []
    const err = e as { statusCode?: number; statusMessage?: string }
    personMonthlyError.value = `${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  }
}

async function reloadCustomerYoy() {
  try {
    if (customerYoyDept.value) {
      const res = await fetchCustomerYoyByDept(from.value, to.value, { department_code: customerYoyDept.value })
      customerYoyData.value = {
        positive: res.data.positive as any,
        negative: res.data.negative as any,
        min_prev: res.data.min_prev,
        months: res.data.months,
      }
      customerYoySource.value = res.source_table
    } else {
      const res = await fetchCustomerYoy(from.value, to.value)
      customerYoyData.value = res.data
      customerYoySource.value = res.source_table
    }
  } catch {}
}

function onDeptChange(code: string) {
  customerYoyDept.value = code
  reloadCustomerYoy()
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const custYoyPromise = customerYoyDept.value
      ? fetchCustomerYoyByDept(from.value, to.value, { department_code: customerYoyDept.value })
          .then(r => ({ source_table: r.source_table, data: { positive: r.data.positive, negative: r.data.negative, min_prev: r.data.min_prev, months: r.data.months } as CustomerYoyResponse }))
      : fetchCustomerYoy(from.value, to.value)
    const [monthly, dept, cust, yoy, trend, custYoy] = await Promise.all([
      fetchMonthlySales(from.value, to.value, parseMonthlyFilter(monthlyFilter.value)),
      fetchDepartmentSales(from.value, to.value),
      fetchCustomerSales(from.value, to.value),
      fetchYoy(currentYear),
      fetchCustomerTrend(from.value, to.value),
      custYoyPromise,
    ])
    monthlySales.value = monthly.data
    monthlySource.value = monthly.source_table
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
    // 担当者順位推移 chart も期間と連動 (失敗しても他は影響させない)
    void loadPersonMonthlyTotals()
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}

async function reloadMonthly() {
  try {
    const monthly = await fetchMonthlySales(from.value, to.value, parseMonthlyFilter(monthlyFilter.value))
    monthlySales.value = monthly.data
    monthlySource.value = monthly.source_table
  } catch {}
}

// 月別グラフ Y軸固定 (チェック ON で現在の auto max をスナップショット)
// monthlyYMax は 0 を「auto」として扱うので、composable には > 0 のときだけ値を渡す
const monthlyAutoMax = computed<number | undefined>(() => (monthlyYMax.value > 0 ? monthlyYMax.value : undefined))
const { isLocked: isMonthlyYMaxLocked, yMax: monthlyYMaxLock, lockedLabelMan: monthlyYMaxLabel }
  = useChartYMaxLock('monthly', monthlyAutoMax)
const effectiveMonthlyYMax = computed<number | undefined>(() => monthlyYMaxLock.value ?? monthlyAutoMax.value)
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold">一番星 売上ダッシュボード</h1>
          <NuxtLink
            to="/admin/recalc"
            class="text-sm text-blue-600 hover:underline no-print"
            title="担当者別売上の再計算・verify・R2 同期を実行する管理画面"
          >
            🔧 /admin/recalc
          </NuxtLink>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
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
        <!-- 担当者 chart/table 群の共通フィルタ。3 つすべて (順位推移 / 構成順位 /
             構成推移) を一括で切替。section の最上部に大きめサイズで配置
             (user 2026-06-30 「横横フィルタもない」= toggle が目立たないとの指摘)。 -->
        <div class="bg-white rounded-lg shadow p-3 flex items-center gap-3 no-print">
          <span class="text-sm font-semibold text-gray-700">🔀 担当者集計フィルタ:</span>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input v-model="excludeYokoyoko" type="checkbox" class="rounded w-4 h-4" />
            <span class="text-sm">
              <strong>横横除外</strong>
              <span class="text-xs text-gray-500 ml-1">
                (= 自社運行のみ、他社運行委託 [受注∈ AND 稼動∉] を除外)
              </span>
            </span>
          </label>
          <span class="ml-auto text-xs px-2 py-0.5 rounded" :class="excludeYokoyoko ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'">
            現在: {{ excludeYokoyoko ? '横横除外 (自社運行のみ)' : '全部 (PHP 互換)' }}
          </span>
        </div>

        <div class="print-section print-chart">
          <div v-if="personMonthlyError" class="bg-white rounded-lg shadow p-4 mb-2 text-sm text-red-700">
            担当者順位推移 endpoint エラー: {{ personMonthlyError }}
            <div class="text-xs text-gray-500 mt-1">
              rust-ichiban への接続もしくは認証 (CF Access Service Token) を確認
            </div>
          </div>
          <UriagePersonBumpChart :rows="personMonthlyRows" v-model:exclude-yokoyoko="excludeYokoyoko" />
          <div v-if="personMonthlyRows.length === 0 && !personMonthlyError" class="text-xs text-gray-500 mt-1 text-right">
            データがあれば自動表示されます。<a href="/admin/recalc" class="text-blue-600 hover:underline">/admin/recalc</a> で再計算を実行してください。
          </div>
        </div>

        <!-- 担当者 売上構成順位 (期間合計 table)。full width で見やすく
             (user 2026-06-30: 「表は 2 列にしないで」)。 -->
        <UriagePersonShareRanking
          :rows="personMonthlyRows"
          v-model:exclude-yokoyoko="excludeYokoyoko"
          :period-label="periodLabel"
        />

        <!-- 担当者 売上構成推移 (% trend chart)。横横除外 toggle と連動。 -->
        <div class="print-section print-chart">
          <UriagePersonShareTrendChart :rows="personMonthlyRows" v-model:exclude-yokoyoko="excludeYokoyoko" />
        </div>

        <div>
          <div class="flex justify-end items-center gap-2 mb-1">
            <label class="text-xs text-gray-600">営業所:</label>
            <select v-model="monthlyFilter" class="border rounded px-2 py-0.5 text-xs" @change="reloadMonthly">
              <option value="">全社</option>
              <option value="exclude:宮崎">宮崎除く</option>
              <option v-for="d in departments" :key="d.department_code" :value="`include:${d.department_code}`">
                {{ d.department_name || d.department_code }}
              </option>
            </select>
            <label class="flex items-center gap-1 text-xs cursor-pointer select-none ml-2">
              <input v-model="isMonthlyYMaxLocked" type="checkbox" class="rounded" />
              Y軸固定
              <span v-if="monthlyYMaxLabel" class="text-gray-500">({{ monthlyYMaxLabel }}万)</span>
            </label>
          </div>
          <MonthlySalesChart :data="monthlySales" :source-table="monthlySource" :y-max="effectiveMonthlyYMax" />
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
          <CustomerYoyRanking
            :data="customerYoyData"
            :source-table="customerYoySource"
            :departments="departments"
            :selected-dept="customerYoyDept"
            @update:selected-dept="onDeptChange"
          />
        </div>

        <section class="bg-white rounded-lg shadow p-4 print-section print-table">
          <div class="flex flex-wrap items-center gap-3 mb-3">
            <h2 class="text-lg font-bold mr-2">期間売上 Top 得意先</h2>
            <label class="text-sm font-medium">期間:</label>
            <input v-model="topFrom" type="month" class="border rounded px-2 py-1 text-sm" />
            <span>〜</span>
            <input v-model="topTo" type="month" class="border rounded px-2 py-1 text-sm" />
            <label class="text-sm font-medium ml-2">上位:</label>
            <select v-model.number="topLimit" class="border rounded px-2 py-1 text-sm">
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
            </select>
            <button
              class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700"
              :disabled="topLoading"
              @click="loadTopRanking"
            >
              更新
            </button>
            <span v-if="topSource" class="text-xs text-gray-500 ml-auto">source: {{ topSource }}</span>
          </div>

          <div v-if="topLoading" class="text-center py-8 text-gray-500 text-sm">読み込み中...</div>
          <div v-else-if="topError" class="text-center py-8">
            <p class="text-red-600 text-sm">{{ topError }}</p>
            <button class="mt-2 bg-blue-600 text-white px-4 py-1 rounded text-sm" @click="loadTopRanking">
              再試行
            </button>
          </div>
          <div v-else-if="topRanking.length === 0" class="text-center py-8 text-gray-500 text-sm">
            データがありません
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 border-b">
                  <th class="text-left px-3 py-2 w-12">順位</th>
                  <th class="text-left px-3 py-2">得意先名</th>
                  <th class="text-right px-3 py-2">期間合計 (万円)</th>
                  <th class="text-right px-3 py-2 w-24">構成比 %</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in topRanking"
                  :key="row.customer_code"
                  class="border-b hover:bg-gray-50"
                >
                  <td class="px-3 py-2">{{ row.rank }}</td>
                  <td class="px-3 py-2">{{ row.customer_name }}</td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ Math.round(row.total / 10000).toLocaleString() }}
                  </td>
                  <td class="px-3 py-2 text-right font-mono">{{ row.share.toFixed(1) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

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
