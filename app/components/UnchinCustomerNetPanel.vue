<script setup lang="ts">
/**
 * 得意先ネット (売上-支払差額) パネル。
 *
 * `/api/unchin/customer-net` (rust-ichibanboshi#68) — 得意先ごとに、
 * 請求合計 (total_sales) とその運行で傭車を使った分の支払合計 (total_payment) を
 * 同一運転日報明細行から突き合わせ、差額 (diff = total_sales - total_payment、
 * 粗利に相当) を返す。
 *
 * 「同一運行内の両建て」方式 (名寄せではない)。当初は傭車先軸
 * (UnchinSubcontractorNetPanel、rust-ichibanboshi#66) だったが、同じ会社が
 * 得意先マスタにも傭車先マスタにも登録されているケースがあり、傭車先軸の行の
 * 「得意先請求」が誤解を招く (自分自身への請求ではなく、その傭車先を使った
 * 様々な得意先の請求合計) との指摘を受け、得意先軸に変更した
 * (user 2026-07-01「傭車先じゃなくて得意先にグラフ直して」)。
 * 自社便のみの得意先は total_payment=0 となり diff = total_sales になる。
 */
import VChart from 'vue-echarts'

interface CustomerNetRow {
  partner_code: string
  partner_name: string
  total_sales: number
  total_payment: number
  diff: number
  bumon_code: string
  bumon_name: string
}
interface CustomerNetResponse {
  source_table: string
  data: CustomerNetRow[]
}

const props = defineProps<{
  from: string
  to: string
  kind: string
}>()

const loading = ref(true)
const error = ref('')
const rows = ref<CustomerNetRow[]>([])
const sourceTable = ref('')

async function load() {
  if (!props.from || !props.to) return
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ from: props.from, to: props.to, kind: props.kind })
    const res = await $fetch<CustomerNetResponse>(
      `/api/unchin/customer-net?${params.toString()}`,
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

watch(() => [props.from, props.to, props.kind], load, { immediate: true })

/** 差額 (絶対値) の降順で表示する — 儲け/逆ざやのインパクトが大きい得意先を上に出す。 */
const sortedRows = computed(() => [...rows.value].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)))

const grandSales = computed(() => rows.value.reduce((s, r) => s + r.total_sales, 0))
const grandPayment = computed(() => rows.value.reduce((s, r) => s + r.total_payment, 0))
const grandDiff = computed(() => rows.value.reduce((s, r) => s + r.diff, 0))

function fmtYen(n: number): string {
  return `${n.toLocaleString('ja-JP')} 円`
}
function fmtMan(yen: number): string {
  const man = Math.round(yen / 10000)
  if (man >= 10000) return `${(man / 10000).toFixed(1)}億`
  if (man >= 1000) return `${(man / 1000).toFixed(1)}千万`
  return `${man.toLocaleString('ja-JP')}万`
}

/** 行クリックで得意先ネットのドリルダウンページへ遷移 (運行単位の明細を表示)。 */
function goToDetail(row: CustomerNetRow) {
  const idx = row.partner_code.indexOf('-')
  const code = idx === -1 ? row.partner_code : row.partner_code.slice(0, idx)
  const h = idx === -1 ? '' : row.partner_code.slice(idx + 1)
  const params = new URLSearchParams({
    from: props.from,
    to: props.to,
    kind: props.kind,
    code,
    h,
    name: row.partner_name,
  })
  navigateTo(`/unchin/customer-net/${encodeURIComponent(row.partner_code)}?${params.toString()}`)
}

// チャートは差額インパクトの大きい上位 N 件のみ (件数が多いと見づらいため)
const CHART_TOP_N = 20
const chartRows = computed(() => sortedRows.value.slice(0, CHART_TOP_N))
const hasChartData = computed(() => chartRows.value.length > 0)
const chartHeight = computed(() => `${Math.max(240, chartRows.value.length * 28 + 80)}px`)

/** バークリックでドリルダウンページへ遷移 (chartRows は reverse 表示のため逆算する)。 */
function onChartClick(params: { dataIndex: number }) {
  const reversed = [...chartRows.value].reverse()
  const row = reversed[params.dataIndex]
  if (row) goToDetail(row)
}

const chartOption = computed(() => {
  // ECharts の category yAxis は配列先頭が下に来るため、降順のまま渡すと
  // 一番差額の大きい行が下段に来てしまう。reverse して「上ほど差額大」にする。
  const rows = [...chartRows.value].reverse()
  return {
    title: {
      text: `得意先ネット 差額 (売上-支払、インパクト上位 ${rows.length} 件)`,
      left: 'center',
      textStyle: { fontSize: 13 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const arr = params as Array<{ dataIndex: number }>
        if (!arr.length) return ''
        const row = rows[arr[0].dataIndex]
        if (!row) return ''
        return `${row.partner_name || row.partner_code}<br/>請求: ${fmtMan(row.total_sales)}円<br/>傭車支払: ${fmtMan(row.total_payment)}円<br/><strong>差額: ${fmtMan(row.diff)}円</strong>`
      },
    },
    grid: { left: 160, right: 40, top: 50, bottom: 30 },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => fmtMan(v) },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map(r => r.partner_name || r.partner_code),
      axisLabel: { fontSize: 11, width: 140, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: rows.map(r => r.diff),
        itemStyle: {
          color: (p: { value: number }) => (p.value >= 0 ? '#3ba272' : '#ee6666'),
        },
      },
    ],
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <h2 class="font-semibold text-base mb-1">得意先ネット (売上-支払差額)</h2>
    <p class="text-xs text-gray-400 mb-3">
      得意先ごとの請求合計と、その運行で傭車を使った分の支払を同一運行から突き合わせた
      差額 (粗利に相当。名寄せではなく「同一運行内の両建て」方式、自社便のみの得意先は
      差額=請求額)。{{ sourceTable }}
    </p>

    <div v-if="loading" class="text-center py-10 text-gray-500 text-sm">読み込み中...</div>
    <div v-else-if="error" class="text-center py-10">
      <p class="text-red-600 text-sm">{{ error }}</p>
      <button class="mt-2 bg-blue-600 text-white px-3 py-1 rounded text-xs" @click="load">
        再試行
      </button>
    </div>
    <div v-else-if="rows.length === 0" class="text-center py-10 text-gray-500 text-sm">
      データがありません
    </div>
    <template v-else>
      <div v-if="hasChartData" class="mb-4">
        <ClientOnly>
          <VChart :option="chartOption" :style="{ height: chartHeight }" autoresize @click="onChartClick" />
        </ClientOnly>
      </div>

      <p class="text-xs text-gray-500 mb-1 no-print">行をクリックすると運行単位の明細を表示します</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b text-gray-500">
            <tr>
              <th class="text-left py-1">得意先</th>
              <th class="text-right py-1">請求</th>
              <th class="text-right py-1">傭車支払</th>
              <th class="text-right py-1">差額</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in sortedRows"
              :key="r.partner_code"
              class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
              @click="goToDetail(r)"
            >
              <td class="py-1">{{ r.partner_name || r.partner_code }}</td>
              <td class="py-1 text-right" :title="fmtYen(r.total_sales)">{{ fmtMan(r.total_sales) }}</td>
              <td class="py-1 text-right" :title="fmtYen(r.total_payment)">{{ fmtMan(r.total_payment) }}</td>
              <td
                class="py-1 text-right font-mono"
                :class="r.diff >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                :title="fmtYen(r.diff)"
              >
                {{ fmtMan(r.diff) }}
              </td>
            </tr>
          </tbody>
          <tfoot class="border-t-2 border-gray-300 bg-gray-50">
            <tr>
              <td class="py-2 font-semibold">合計 ({{ sortedRows.length }} 件)</td>
              <td class="py-2 text-right font-mono font-semibold" :title="fmtYen(grandSales)">
                {{ fmtMan(grandSales) }}
              </td>
              <td class="py-2 text-right font-mono font-semibold" :title="fmtYen(grandPayment)">
                {{ fmtMan(grandPayment) }}
              </td>
              <td
                class="py-2 text-right font-mono font-semibold"
                :class="grandDiff >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                :title="fmtYen(grandDiff)"
              >
                {{ fmtMan(grandDiff) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </template>
  </div>
</template>
