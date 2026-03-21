<script setup lang="ts">
import VChart from 'vue-echarts'
import type { MonthlySales } from '~/types'

const props = defineProps<{
  data: MonthlySales[]
}>()

const option = computed(() => {
  const months = props.data.map(d => d.year_month)
  return {
    title: { text: '月別売上推移', left: 'center' },
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
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    series: [
      {
        name: '自車売上',
        type: 'bar',
        stack: 'total',
        data: props.data.map(d => d.own_sales),
        itemStyle: { color: '#5470c6' },
      },
      {
        name: '傭車売上',
        type: 'bar',
        stack: 'total',
        data: props.data.map(d => d.charter_sales),
        itemStyle: { color: '#91cc75' },
      },
      {
        name: '合計',
        type: 'line',
        data: props.data.map(d => d.total_sales),
        itemStyle: { color: '#ee6666' },
        lineStyle: { width: 2 },
      },
    ],
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <VChart :option="option" style="height: 400px" autoresize />
  </div>
</template>
