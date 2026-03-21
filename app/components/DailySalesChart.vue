<script setup lang="ts">
import VChart from 'vue-echarts'
import type { DailySales } from '~/types'

const props = defineProps<{
  data: DailySales[]
  month: string
  sourceTable?: string
  yAxisMax?: number
  amountMode?: 'tax_excl' | 'raw'
}>()

const isRaw = computed(() => props.amountMode === 'raw')

const option = computed(() => {
  const labels = props.data.map(d => {
    const day = d.date.split('-')[2]
    return `${day}(${d.weekday})`
  })

  const markAreas = props.data
    .map((d, i) => {
      if (d.weekday === '土' || d.weekday === '日') {
        return [
          { xAxis: i - 0.5, itemStyle: { color: d.weekday === '日' ? 'rgba(255,200,200,0.3)' : 'rgba(200,200,255,0.3)' } },
          { xAxis: i + 0.5 },
        ]
      }
      return null
    })
    .filter(Boolean)

  const suffix = isRaw.value ? '（金額ベース）' : '（税抜）'

  return {
    title: { text: `${props.month} 日別売上${suffix}`, left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const label = params[0].axisValue
        const lines = params.map((p: any) => {
          const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          return `${p.marker} ${p.seriesName}: ${val}万円`
        })
        return `${label}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { bottom: 0 },
    grid: { left: 80, right: 30, bottom: 50, top: 50 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        formatter: (v: string) => v,
        color: (value: string) => {
          if (value.includes('日)')) return '#e53e3e'
          if (value.includes('土)')) return '#3182ce'
          return '#333'
        },
      },
    },
    yAxis: {
      type: 'value',
      max: props.yAxisMax || undefined,
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    series: [
      {
        name: '前年',
        type: 'bar',
        data: props.data.map(d => isRaw.value ? d.prev_year_total_raw : d.prev_year_total),
        itemStyle: { color: '#d4d4d4' },
        markArea: { silent: true, data: markAreas },
      },
      {
        name: '自車売上',
        type: 'bar',
        stack: 'current',
        data: props.data.map(d => isRaw.value ? d.own_sales_raw : d.own_sales),
        itemStyle: { color: '#5470c6' },
      },
      {
        name: '傭車売上',
        type: 'bar',
        stack: 'current',
        data: props.data.map(d => isRaw.value ? d.charter_sales_raw : d.charter_sales),
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
