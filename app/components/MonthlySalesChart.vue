<script setup lang="ts">
import VChart from 'vue-echarts'
import type { MonthlySales } from '~/types'

const props = defineProps<{
  data: MonthlySales[]
  sourceTable?: string
  yMax?: number
}>()
function onChartClick(params: any) {
  if (params.dataIndex !== undefined && props.data[params.dataIndex]) {
    const ym = props.data[params.dataIndex].year_month
    navigateTo(`/month/${ym}`)
  }
}

const option = computed(() => {
  const months = props.data.map(d => {
    const m = d.year_month.split('-')[1]
    return `${m}月`
  })

  return {
    title: { text: '月別売上推移（前年比較）', left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const lines = params.map((p: any) => {
          const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          return `${p.marker} ${p.seriesName}: ${val}万円`
        })
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 80, right: 30, bottom: 50, top: 50 },
    xAxis: { type: 'category', data: months },
    yAxis: {
      type: 'value',
      max: props.yMax || undefined,
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    series: [
      {
        name: '前年自車',
        type: 'bar',
        stack: 'prev',
        data: props.data.map(d => d.prev_year_own),
        itemStyle: { color: '#d4d4d4' },
      },
      {
        name: '前年傭車',
        type: 'bar',
        stack: 'prev',
        data: props.data.map(d => d.prev_year_charter),
        itemStyle: { color: '#bfbfbf' },
      },
      {
        name: '自車売上',
        type: 'bar',
        stack: 'current',
        data: props.data.map(d => d.own_sales),
        itemStyle: { color: '#5470c6' },
      },
      {
        name: '傭車売上',
        type: 'bar',
        stack: 'current',
        data: props.data.map(d => d.charter_sales),
        itemStyle: { color: '#91cc75' },
      },
    ],
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <VChart :option="option" style="height: 400px; cursor: pointer" autoresize @click="onChartClick" />
    <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
  </div>
</template>
