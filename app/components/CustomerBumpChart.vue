<script setup lang="ts">
import VChart from 'vue-echarts'
import type { CustomerMonthly } from '~/types'

const props = defineProps<{
  data: CustomerMonthly[]
  sourceTable?: string
}>()
const colors = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0',
  '#c23531', '#2f4554', '#61a0a8', '#d48265', '#91c7ae',
  '#749f83', '#ca8622', '#bda29a', '#6e7074', '#546570',
]

const option = computed(() => {
  if (!props.data.length) return {}

  const top = props.data.slice(0, 15)
  const months = top[0].months.map(m => m.year_month.split('-')[1] + '月')

  // 各月の順位ごとにバンド幅を計算（売上に比例）
  // まず各月の合計売上を求める
  const monthTotals = months.map((_, mi) =>
    top.reduce((s, c) => s + c.months[mi].total_sales, 0)
  )

  // 各得意先の各月の「帯の上端・下端」を計算
  // 順位順に上から配置、帯の太さは売上/合計の比率
  const bandHeight = 18 // 1社あたりの最大帯高さ
  const maxRank = top.length

  const series: any[] = []

  for (let ci = 0; ci < top.length; ci++) {
    const customer = top[ci]
    const name = customer.customer_name || customer.customer_code
    const color = colors[ci % colors.length]

    // リボン風: 太い線 + 半透明エリア
    series.push({
      name,
      type: 'line',
      data: customer.months.map(m => m.rank),
      symbolSize: 10,
      symbol: 'circle',
      lineStyle: {
        width: 8,
        color,
        opacity: 0.6,
        cap: 'round' as const,
        join: 'round' as const,
      },
      itemStyle: { color },
      emphasis: {
        lineStyle: { width: 14, opacity: 0.9 },
        itemStyle: { borderWidth: 3, borderColor: '#fff' },
      },
      label: {
        show: true,
        position: 'right',
        formatter: (p: any) => {
          if (p.dataIndex === customer.months.length - 1) {
            const sales = Math.round(customer.months[p.dataIndex].total_sales / 10000)
            return `${formatMan(sales)}`
          }
          return ''
        },
        fontSize: 10,
        color,
      },
      z: top.length - ci, // 上位を前面に
    })
  }

  return {
    title: { text: '得意先 売上順位推移（期間合計 上位15社）', left: 'center' },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const customer = top[p.seriesIndex]
        if (!customer) return ''
        const md = customer.months[p.dataIndex]
        if (!md) return ''
        const sales = formatMan(Math.round(md.total_sales / 10000))
        return `<strong>${p.seriesName}</strong><br/>${months[p.dataIndex]}: ${md.rank}位 (${sales}円)`
      },
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { fontSize: 10 },
    },
    grid: { left: 50, right: 140, bottom: 70, top: 50 },
    xAxis: { type: 'category', data: months },
    yAxis: {
      type: 'value',
      inverse: true,
      min: 1,
      max: maxRank,
      interval: 1,
      axisLabel: { formatter: (v: number) => `${v}位` },
    },
    series,
  }
})

function formatMan(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}億`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}千万`
  return `${v}万`
}
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <VChart v-if="data.length" :option="option" style="height: 600px" autoresize />
    <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
  </div>
</template>
