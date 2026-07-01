<script setup lang="ts">
/**
 * 担当者 売上順位推移 bump chart。CustomerBumpChart の担当者版。
 *
 * 入力 `rows`: rust の `/api/uriage/person-monthly-totals` レスポンス。
 * `(month, person_name)` で sort 済の月次集計を月ごとに rank 化して描く。
 *
 * 期間内のどこかの月で top N (default 15) に入った担当者を line で表示する。
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
  /** 横横=0 (自社運行+sql_from_other) のみの集計値。
   * backend が省略 (旧 data) する場合あり → undefined fallback で 0 扱い。 */
  kingaku_y0?: number
  yosha_kingaku_y0?: number
  kensuu_y0?: number
}

const props = withDefaults(
  defineProps<{
    rows: MonthlyTotal[]
    /** ドリルダウンページ (`/person/[name]`) に引き継ぐ期間 (YYYY-MM)。 */
    from?: string
    to?: string
  }>(),
  { from: '', to: '' },
)

/** line/point クリックで担当者ドリルダウンページへ遷移 (ShareRanking と同じ navigateTo パターン)。
 * legend クリックは ECharts 標準の系列表示/非表示トグルのまま (ここでは奪わない)。
 * user 2026-07-01「担当者売上順位系にも入れて」。 */
interface ChartClickParams {
  seriesName?: string
}
function onChartClick(params: ChartClickParams) {
  if (!params.seriesName) return
  const query = new URLSearchParams({ from: props.from, to: props.to })
  navigateTo(`/person/${encodeURIComponent(params.seriesName)}?${query.toString()}`)
}

/** 横横除外フィルタ (v-model:exclude-yokoyoko で親と双方向 binding)。
 * true で横横=1 (他社運行委託) を除外した y0 値で集計する。
 * default false (= 合計、PHP 互換 view)。
 * user 2026-06-30 「個々にも横横フィルタ表示」要望で component 内 toggle も持つ。 */
const excludeYokoyoko = defineModel<boolean>('excludeYokoyoko', { default: false })

/** 横横除外フィルタを考慮した kingaku 取得 */
function pickKingaku(r: MonthlyTotal): number {
  return excludeYokoyoko.value ? (r.kingaku_y0 ?? 0) : r.kingaku
}

// 30 名に拡張 (user 2026-06-30 「30 位にしたら? とりあえず 20 人くらいしかいないが」)。
const TOP_N = 30

const colors = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0',
  '#c23531', '#2f4554', '#61a0a8', '#d48265', '#91c7ae',
  '#749f83', '#ca8622', '#bda29a', '#6e7074', '#546570',
]

interface ChartData {
  months: string[]
  series: Array<{ name: string; ranks: (number | null)[]; values: (number | null)[]; total: number }>
}

const chartData = computed<ChartData>(() => {
  if (props.rows.length === 0) return { months: [], series: [] }

  // 月の sorted unique list
  const monthsSet = new Set<string>()
  for (const r of props.rows) monthsSet.add(r.month)
  const months = Array.from(monthsSet).sort()

  // 月 → person → kingaku の Map (集計済み前提だが念のため SUM)
  // excludeYokoyoko=true なら kingaku_y0 (横横=0 のみ) を使う
  const byMonth = new Map<string, Map<string, number>>()
  for (const r of props.rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, new Map())
    const m = byMonth.get(r.month)!
    m.set(r.person_name, (m.get(r.person_name) ?? 0) + pickKingaku(r))
  }

  // 月ごとに rank 計算 (kingaku DESC)。同額は名前順で安定 sort
  const monthlyRank = new Map<string, Map<string, number>>() // month → person → rank (1-indexed)
  for (const month of months) {
    const m = byMonth.get(month)!
    const sorted = Array.from(m.entries())
      .filter(([_, v]) => v > 0)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    const rankMap = new Map<string, number>()
    sorted.forEach(([name], i) => rankMap.set(name, i + 1))
    monthlyRank.set(month, rankMap)
  }

  // 期間合計で top N を決める
  const totals = new Map<string, number>()
  for (const r of props.rows) {
    totals.set(r.person_name, (totals.get(r.person_name) ?? 0) + pickKingaku(r))
  }
  const topPersons = Array.from(totals.entries())
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name]) => name)

  const series = topPersons.map((name) => ({
    name,
    ranks: months.map((m) => monthlyRank.get(m)?.get(name) ?? null),
    values: months.map((m) => byMonth.get(m)?.get(name) ?? null),
    total: totals.get(name) ?? 0,
  }))

  return { months, series }
})

function fmtMan(yen: number): string {
  const man = Math.round(yen / 10000)
  if (man >= 10000) return `${(man / 10000).toFixed(1)}億`
  if (man >= 1000) return `${(man / 1000).toFixed(1)}千万`
  return `${man.toLocaleString('ja-JP')}万`
}

function monthLabel(ym: string): string {
  // "2026-06" → "6月" (12 ヶ月以内ならコンパクトに)
  const m = ym.split('-')[1]
  return m ? `${parseInt(m, 10)}月` : ym
}

const option = computed(() => {
  const d = chartData.value
  if (!d.series.length) return {}

  return {
    title: {
      text: `担当者 売上順位推移 (期間合計 上位 ${d.series.length} 名)${excludeYokoyoko.value ? ' [横横除外]' : ''}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const param = p as { seriesName: string; seriesIndex: number; dataIndex: number }
        const s = d.series[param.seriesIndex]
        if (!s) return ''
        const rank = s.ranks[param.dataIndex]
        const value = s.values[param.dataIndex]
        if (rank == null || value == null) return `<strong>${param.seriesName}</strong><br/>${d.months[param.dataIndex]}: データなし`
        return `<strong>${param.seriesName}</strong><br/>${d.months[param.dataIndex]}: ${rank} 位 (${fmtMan(value)}円)`
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
        return `${name}  ${fmtMan(s.total)}円`
      },
    },
    grid: { left: 50, right: 280, bottom: 30, top: 50 },
    xAxis: {
      type: 'category',
      data: d.months.map(monthLabel),
    },
    yAxis: {
      type: 'value',
      inverse: true,
      min: 1,
      max: d.series.length,
      interval: 1,
      axisLabel: { formatter: (v: number) => `${v}位` },
    },
    series: d.series.map((s, i) => ({
      name: s.name,
      type: 'line',
      data: s.ranks,
      symbolSize: 10,
      symbol: 'circle',
      lineStyle: {
        width: 6,
        color: colors[i % colors.length],
        opacity: 0.7,
        cap: 'round' as const,
        join: 'round' as const,
      },
      itemStyle: { color: colors[i % colors.length] },
      emphasis: {
        lineStyle: { width: 12, opacity: 0.95 },
        itemStyle: { borderWidth: 3, borderColor: '#fff' },
      },
      connectNulls: false,
      label: { show: false },
      z: d.series.length - i,
    })),
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <!-- component 内 toggle (親と v-model:exclude-yokoyoko で同期) -->
    <div class="flex items-center justify-end mb-1 no-print">
      <label class="flex items-center gap-1 text-xs cursor-pointer select-none">
        <input v-model="excludeYokoyoko" type="checkbox" class="rounded" />
        横横除外
      </label>
    </div>
    <div v-if="chartData.series.length === 0" class="text-gray-500 text-sm text-center py-10">
      (データなし — 期間を変えるか、`/admin/recalc` で再計算してください)
    </div>
    <template v-else>
      <p class="text-xs text-gray-500 mb-1 no-print">
        線/点をクリックすると得意先・傭車先の内訳を表示します
      </p>
      <ClientOnly>
        <VChart :option="option" style="height: 600px" autoresize @click="onChartClick" />
      </ClientOnly>
    </template>
  </div>
</template>
