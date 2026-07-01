<script setup lang="ts">
/**
 * 傭車先ネット (売上-支払差額) パネル。
 *
 * `/api/unchin/subcontractor-net` (rust-ichibanboshi#66) — 傭車先ごとに、
 * その傭車先が使われた運行の得意先請求合計 (total_sales) と
 * その傭車先への支払合計 (total_payment) を同一運転日報明細行から突き合わせ、
 * 差額 (diff = total_sales - total_payment) を返す。
 *
 * 「同一運行内の両建て」方式 (名寄せではない) — user 2026-07-01「傭車にて
 * 売上ー支払金額での金額って出せるものか」→ 3択で協議し選択。
 */
import VChart from 'vue-echarts'

interface SubcontractorNetRow {
  partner_code: string
  partner_name: string
  total_sales: number
  total_payment: number
  diff: number
  bumon_code: string
  bumon_name: string
}
interface SubcontractorNetResponse {
  source_table: string
  data: SubcontractorNetRow[]
}

const props = defineProps<{
  from: string
  to: string
  kind: string
}>()

const loading = ref(true)
const error = ref('')
const rows = ref<SubcontractorNetRow[]>([])
const sourceTable = ref('')

async function load() {
  if (!props.from || !props.to) return
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ from: props.from, to: props.to, kind: props.kind })
    const res = await $fetch<SubcontractorNetResponse>(
      `/api/unchin/subcontractor-net?${params.toString()}`,
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

/** 差額 (絶対値) の降順で表示する — 相殺インパクトが大きい傭車先を上に出す。 */
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

// チャートは差額インパクトの大きい上位 N 件のみ (件数が多いと見づらいため)
const CHART_TOP_N = 20
const chartRows = computed(() => sortedRows.value.slice(0, CHART_TOP_N))
const hasChartData = computed(() => chartRows.value.length > 0)
const chartHeight = computed(() => `${Math.max(240, chartRows.value.length * 28 + 80)}px`)

const chartOption = computed(() => {
  // ECharts の category yAxis は配列先頭が下に来るため、降順のまま渡すと
  // 一番差額の大きい行が下段に来てしまう。reverse して「上ほど差額大」にする。
  const rows = [...chartRows.value].reverse()
  return {
    title: {
      text: `傭車先ネット 差額 (売上-支払、インパクト上位 ${rows.length} 件)`,
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
        return `${row.partner_name || row.partner_code}<br/>得意先請求: ${fmtMan(row.total_sales)}円<br/>傭車支払: ${fmtMan(row.total_payment)}円<br/><strong>差額: ${fmtMan(row.diff)}円</strong>`
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
    <h2 class="font-semibold text-base mb-1">傭車先ネット (売上-支払差額)</h2>
    <p class="text-xs text-gray-400 mb-3">
      傭車先が使われた運行の得意先請求と、その傭車先への支払を同一運行から突き合わせた差額
      (名寄せではなく「同一運行内の両建て」方式)。{{ sourceTable }}
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
          <VChart :option="chartOption" :style="{ height: chartHeight }" autoresize />
        </ClientOnly>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b text-gray-500">
            <tr>
              <th class="text-left py-1">傭車先</th>
              <th class="text-right py-1">得意先請求</th>
              <th class="text-right py-1">傭車支払</th>
              <th class="text-right py-1">差額</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in sortedRows"
              :key="r.partner_code"
              class="border-b border-gray-100"
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
