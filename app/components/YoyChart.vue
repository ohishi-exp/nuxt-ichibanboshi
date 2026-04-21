<script setup lang="ts">
import VChart from 'vue-echarts'
import type { YoyComparison } from '~/types'

const props = defineProps<{
  data: YoyComparison[]
  year: number
  sourceTable?: string
}>()

/**
 * YoY差分のパーセンテージを符号付き・小数第1位で整形する。
 * 前年が 0 のレコード (ゼロ割・Infinity/NaN) では '-' を返す。
 */
function formatYoyPercent(comp: YoyComparison): string {
  if (!comp || comp.previous_year === 0 || !Number.isFinite(comp.diff_percent)) return '-'
  const sign = comp.diff_percent > 0 ? '+' : ''
  return `${sign}${comp.diff_percent.toFixed(1)}%`
}

/** プラス=成長(緑)、マイナス=減少(赤)、ゼロ/無効=グレー */
function yoyColor(comp: YoyComparison): string {
  if (!comp || comp.previous_year === 0 || !Number.isFinite(comp.diff_percent)) return '#9ca3af'
  if (comp.diff_percent > 0) return '#16a34a' // green-600 (成長)
  if (comp.diff_percent < 0) return '#dc2626' // red-600 (減少)
  return '#9ca3af'
}

const option = computed(() => {
  const months = props.data.map(d => `${d.month}月`)
  // ラベル表示用: バーインデックス → YoY% 情報
  const yoyLabels = props.data.map(d => ({
    text: formatYoyPercent(d),
    color: yoyColor(d),
  }))
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
        // tooltip に YoY% も表示
        const idx = params[0].dataIndex
        const comp = props.data[idx]
        if (comp) {
          const diffVal = (comp.diff / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
          const diffSign = comp.diff > 0 ? '+' : ''
          const pctText = formatYoyPercent(comp)
          const color = yoyColor(comp)
          lines.push(
            `<span style="color:${color};font-weight:bold">YoY: ${diffSign}${diffVal}万円 (${pctText})</span>`,
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
        data: props.data.map((d, i) => ({
          value: d.current_year,
          // 各バーに YoY% ラベルを表示（増減に応じて色分け）
          label: {
            show: true,
            position: 'top',
            formatter: yoyLabels[i].text,
            color: yoyLabels[i].color,
            fontWeight: 'bold',
            fontSize: 11,
          },
        })),
        itemStyle: { color: '#5470c6' },
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
