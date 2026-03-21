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
]

const option = computed(() => {
  if (!props.data.length || !props.data[0].months.length) return {}

  const top10 = props.data.slice(0, 10)
  const months = top10[0].months.map(m => m.year_month.split('-')[1] + '月')

  const series = top10.map((customer, i) => ({
    name: customer.customer_name || customer.customer_code,
    type: 'line' as const,
    stack: 'total',
    areaStyle: { opacity: 0.7 },
    emphasis: { focus: 'series' as const },
    data: customer.months.map(m => Math.round(m.total_sales / 10000)),
    itemStyle: { color: colors[i % colors.length] },
    lineStyle: { width: 1 },
    symbol: 'none',
  }))

  return {
    title: { text: '得意先 売上構成推移（上位10社）', left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const lines = params
          .filter((p: any) => p.value > 0)
          .sort((a: any, b: any) => b.value - a.value)
          .map((p: any) => {
            const val = p.value.toLocaleString('ja-JP')
            return `${p.marker} ${p.seriesName}: ${val}万円`
          })
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { fontSize: 10 },
    },
    grid: { left: 80, right: 30, bottom: 60, top: 50 },
    xAxis: { type: 'category', data: months, boundaryGap: false },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => `${v.toLocaleString()}万`,
      },
    },
    series,
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <VChart v-if="data.length" :option="option" style="height: 500px" autoresize />
    <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
  </div>
</template>
