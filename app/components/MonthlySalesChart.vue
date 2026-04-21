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

function calcYoy(d: MonthlySales): { pct: number | null; diff: number } {
  const prev = (d.prev_year_own ?? 0) + (d.prev_year_charter ?? 0)
  const cur = (d.own_sales ?? 0) + (d.charter_sales ?? 0)
  const diff = cur - prev
  if (prev === 0) return { pct: null, diff }
  return { pct: (diff / prev) * 100, diff }
}

function formatYoyPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '-'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function yoyColor(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '#9ca3af'
  if (pct > 0) return '#16a34a'
  if (pct < 0) return '#dc2626'
  return '#9ca3af'
}

const option = computed(() => {
  const months = props.data.map(d => {
    const m = d.year_month.split('-')[1]
    return `${m}月`
  })

  const yoyLabels = props.data.map(d => {
    const { pct } = calcYoy(d)
    return { text: formatYoyPct(pct), color: yoyColor(pct) }
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
        const idx = params[0].dataIndex
        const d = props.data[idx]
        if (d) {
          const { pct, diff } = calcYoy(d)
          const diffVal = (diff / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          const diffSign = diff > 0 ? '+' : ''
          lines.push(
            `<span style="color:${yoyColor(pct)};font-weight:bold">YoY: ${diffSign}${diffVal}万円 (${formatYoyPct(pct)})</span>`,
          )
        }
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
        // 今期スタックの最上段にのみ YoY% ラベルを出す
        data: props.data.map((d, i) => ({
          value: d.charter_sales,
          label: {
            show: true,
            position: 'top',
            formatter: yoyLabels[i].text,
            color: yoyLabels[i].color,
            fontWeight: 'bold',
            fontSize: 11,
          },
        })),
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
