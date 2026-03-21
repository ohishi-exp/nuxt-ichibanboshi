<script setup lang="ts">
import VChart from 'vue-echarts'
import type { DepartmentSales } from '~/types'

const props = defineProps<{
  data: DepartmentSales[]
  sourceTable?: string
}>()
const option = computed(() => {
  const sorted = [...props.data].filter(d => d.total_sales > 0).slice(0, 15)
  const names = sorted.map(d => d.department_name || d.department_code)
  return {
    title: { text: '部門別売上', left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const name = params[0].axisValue
        const lines = params.map((p: any) => {
          const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          return `${p.marker} ${p.seriesName}: ${val}万円`
        })
        return `${name}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 100, right: 30, bottom: 50, top: 50 },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    yAxis: { type: 'category', data: names.reverse(), inverse: false },
    series: [
      {
        name: '自車売上',
        type: 'bar',
        stack: 'total',
        data: sorted.map(d => d.own_sales).reverse(),
        itemStyle: { color: '#5470c6' },
      },
      {
        name: '傭車売上',
        type: 'bar',
        stack: 'total',
        data: sorted.map(d => d.charter_sales).reverse(),
        itemStyle: { color: '#91cc75' },
      },
    ],
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <VChart :option="option" style="height: 400px" autoresize />
    <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
  </div>
</template>
