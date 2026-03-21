<script setup lang="ts">
import VChart from 'vue-echarts'
import type { YoyComparison } from '~/types'

const props = defineProps<{
  data: YoyComparison[]
  year: number
}>()

const option = computed(() => {
  const months = props.data.map(d => `${d.month}月`)
  return {
    title: { text: `前年同月比較 (${props.year} vs ${props.year - 1})`, left: 'center' },
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
        name: `${props.year - 1}年`,
        type: 'bar',
        data: props.data.map(d => d.previous_year),
        itemStyle: { color: '#b0c4de' },
      },
      {
        name: `${props.year}年`,
        type: 'bar',
        data: props.data.map(d => d.current_year),
        itemStyle: { color: '#5470c6' },
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
