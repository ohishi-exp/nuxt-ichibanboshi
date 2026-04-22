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

function yoyFrom(prev: number, cur: number): { pct: number | null; diff: number } {
  const diff = cur - prev
  if (prev === 0) return { pct: null, diff }
  return { pct: (diff / prev) * 100, diff }
}

function calcTotalYoy(d: MonthlySales) {
  return yoyFrom((d.prev_year_own ?? 0) + (d.prev_year_charter ?? 0), (d.own_sales ?? 0) + (d.charter_sales ?? 0))
}
function calcOwnYoy(d: MonthlySales) {
  return yoyFrom(d.prev_year_own ?? 0, d.own_sales ?? 0)
}
function calcCharterYoy(d: MonthlySales) {
  return yoyFrom(d.prev_year_charter ?? 0, d.charter_sales ?? 0)
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

function formatDiff(diff: number): string {
  const val = (diff / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
  const sign = diff > 0 ? '+' : ''
  return `${sign}${val}万円`
}

const option = computed(() => {
  const months = props.data.map(d => {
    const m = d.year_month.split('-')[1]
    return `${m}月`
  })

  const totalYoy = props.data.map(d => calcTotalYoy(d))
  const ownYoy = props.data.map(d => calcOwnYoy(d))
  const charterYoy = props.data.map(d => calcCharterYoy(d))

  return {
    title: { text: '月別売上推移（前年比較）', left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const m = params[0].axisValue
        const visible = params.filter((p: any) => p.seriesName !== 'YoY全体')
        const lines = visible.map((p: any) => {
          const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          return `${p.marker} ${p.seriesName}: ${val}万円`
        })
        const idx = params[0].dataIndex
        const d = props.data[idx]
        if (d) {
          const o = ownYoy[idx]
          const c = charterYoy[idx]
          const t = totalYoy[idx]
          lines.push(
            `<span style="color:${yoyColor(o.pct)}">YoY(自車): ${formatDiff(o.diff)} (${formatYoyPct(o.pct)})</span>`,
            `<span style="color:${yoyColor(c.pct)}">YoY(傭車): ${formatDiff(c.diff)} (${formatYoyPct(c.pct)})</span>`,
            `<span style="color:${yoyColor(t.pct)};font-weight:bold">YoY(全体): ${formatDiff(t.diff)} (${formatYoyPct(t.pct)})</span>`,
          )
        }
        return `${m}<br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      bottom: 0,
      data: ['前年自車', '前年傭車', '自車売上', '傭車売上'],
    },
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
        // 自車バー内に自車単体 YoY% を inside 表示（白背景の色付き文字）
        data: props.data.map((d, i) => ({
          value: d.own_sales,
          label: {
            show: true,
            position: 'inside',
            formatter: formatYoyPct(ownYoy[i].pct),
            color: yoyColor(ownYoy[i].pct),
            backgroundColor: '#ffffff',
            padding: [2, 4],
            borderRadius: 3,
            fontWeight: 'bold',
            fontSize: 11,
            overflow: 'truncate',
          },
        })),
        itemStyle: { color: '#5470c6' },
      },
      {
        name: '傭車売上',
        type: 'bar',
        stack: 'current',
        // 傭車バー内に傭車単体 YoY% を inside 表示（白背景の色付き文字）
        data: props.data.map((d, i) => ({
          value: d.charter_sales,
          label: {
            show: true,
            position: 'inside',
            formatter: formatYoyPct(charterYoy[i].pct),
            color: yoyColor(charterYoy[i].pct),
            backgroundColor: '#ffffff',
            padding: [2, 4],
            borderRadius: 3,
            fontWeight: 'bold',
            fontSize: 11,
            overflow: 'truncate',
          },
        })),
        itemStyle: { color: '#91cc75' },
      },
      {
        // current stack 最上段に 0 値の透明バーを重ね、position: 'top' で全体 YoY% を表示するためのアンカー
        name: 'YoY全体',
        type: 'bar',
        stack: 'current',
        silent: true,
        legendHoverLink: false,
        itemStyle: { color: 'transparent' },
        data: props.data.map((_, i) => ({
          value: 0,
          label: {
            show: true,
            position: 'top',
            formatter: formatYoyPct(totalYoy[i].pct),
            color: yoyColor(totalYoy[i].pct),
            fontWeight: 'bold',
            fontSize: 11,
          },
        })),
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
