<script setup lang="ts">
/**
 * 担当者 売上構成推移 chart (% 推移、stacked area)。
 *
 * 期間内のどこかの月で top N (default 15) に入った担当者を stacked area で描く。
 * Y 軸は 月内構成比 (%) で、各月の合計が 100% になる normalized stack。
 *
 * `excludeYokoyoko=true` で横横=1 行を除外した y0 値で集計する。
 *
 * 入力 `rows`: `/api/uriage/person-monthly-totals` レスポンス。
 */
import VChart from 'vue-echarts'

interface MonthlyTotal {
  month: string
  person_name: string
  eigyosho_id: number
  cal: boolean
  kingaku: number
  yosha_kingaku: number
  kensuu: number
  kingaku_y0?: number
  yosha_kingaku_y0?: number
  kensuu_y0?: number
}

const props = withDefaults(
  defineProps<{
    rows: MonthlyTotal[]
    /** true で横横=1 (他社運行委託) を除外した y0 値で集計する */
    excludeYokoyoko?: boolean
  }>(),
  { excludeYokoyoko: false },
)

function pickKingaku(r: MonthlyTotal): number {
  return props.excludeYokoyoko ? (r.kingaku_y0 ?? 0) : r.kingaku
}

const TOP_N = 15

const colors = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0',
  '#c23531', '#2f4554', '#61a0a8', '#d48265', '#91c7ae',
  '#749f83', '#ca8622', '#bda29a', '#6e7074', '#546570',
]

interface ChartData {
  months: string[]
  /** 各 series は person ごと、values は月別 share (%) */
  series: Array<{ name: string; values: number[]; total: number; sharePct: number }>
}

const chartData = computed<ChartData>(() => {
  if (props.rows.length === 0) return { months: [], series: [] }

  const monthsSet = new Set<string>()
  for (const r of props.rows) monthsSet.add(r.month)
  const months = Array.from(monthsSet).sort()

  // 月 → person → kingaku
  const byMonth = new Map<string, Map<string, number>>()
  for (const r of props.rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, new Map())
    const m = byMonth.get(r.month)!
    m.set(r.person_name, (m.get(r.person_name) ?? 0) + pickKingaku(r))
  }

  // 月別合計
  const monthSums = new Map<string, number>()
  for (const month of months) {
    const m = byMonth.get(month)!
    monthSums.set(month, Array.from(m.values()).reduce((s, v) => s + v, 0))
  }

  // 期間合計で top N を決める
  const totals = new Map<string, number>()
  for (const r of props.rows) {
    totals.set(r.person_name, (totals.get(r.person_name) ?? 0) + pickKingaku(r))
  }
  const grandTotal = Array.from(totals.values()).reduce((s, v) => s + v, 0)
  const topPersons = Array.from(totals.entries())
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name]) => name)

  const series = topPersons.map((name) => {
    const total = totals.get(name) ?? 0
    return {
      name,
      values: months.map((m) => {
        const sum = monthSums.get(m) ?? 0
        const v = byMonth.get(m)?.get(name) ?? 0
        return sum > 0 ? (v / sum) * 100 : 0
      }),
      total,
      sharePct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
    }
  })

  return { months, series }
})

function monthLabel(ym: string): string {
  const m = ym.split('-')[1]
  return m ? `${parseInt(m, 10)}月` : ym
}

const option = computed(() => {
  const d = chartData.value
  if (!d.series.length) return {}

  return {
    title: {
      text: `担当者 売上構成推移 (期間合計 上位 ${d.series.length} 名)${props.excludeYokoyoko ? ' [横横除外]' : ''}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: number; color: string; dataIndex: number }>
        if (!arr.length) return ''
        const month = d.months[arr[0].dataIndex]
        const sorted = [...arr].sort((a, b) => b.value - a.value).slice(0, 10)
        const lines = sorted.map(
          (p) =>
            `<span style="display:inline-block;width:10px;height:10px;background:${p.color};margin-right:4px"></span>${p.seriesName}: <strong>${p.value.toFixed(1)}%</strong>`,
        )
        return `<strong>${month}</strong><br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 50,
      bottom: 20,
      textStyle: { fontSize: 11 },
      formatter: (name: string) => {
        const s = d.series.find((ss) => ss.name === name)
        if (!s) return name
        return `${name}  ${s.sharePct.toFixed(1)}%`
      },
    },
    grid: { left: 60, right: 220, bottom: 30, top: 50 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: d.months.map(monthLabel),
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { formatter: (v: number) => `${v}%` },
    },
    // ECharts の stack は series 配列順で「下→上」に積む。
    // chartData.series は期間合計の大きい順 (legend 表示順) なので、
    // そのまま積むと最大シェアが最下部に来る (= legend 1 位 vs chart 最下段で逆順に
    // 見える、user 2026-06-30 「順番が逆 タイトル？人名の順番合わせて」)。
    // legend と stack の見た目を一致させるため、series を reverse して「大きい順に上」に積む。
    // 各 series の色は legend 順 (= 元 i) に紐付けたまま reverse する。
    series: d.series
      .map((s, i) => ({
        name: s.name,
        type: 'line' as const,
        stack: 'share',
        areaStyle: { opacity: 0.7 },
        lineStyle: { width: 1, color: colors[i % colors.length] },
        itemStyle: { color: colors[i % colors.length] },
        data: s.values,
        symbol: 'circle' as const,
        symbolSize: 4,
        emphasis: { focus: 'series' as const },
      }))
      .reverse(),
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <div v-if="chartData.series.length === 0" class="text-gray-500 text-sm text-center py-10">
      (データなし — 期間を変えるか、<NuxtLink to="/admin/recalc" class="text-blue-600 hover:underline">/admin/recalc</NuxtLink> で再計算してください)
    </div>
    <ClientOnly v-else>
      <VChart :option="option" style="height: 500px" autoresize />
    </ClientOnly>
  </div>
</template>
