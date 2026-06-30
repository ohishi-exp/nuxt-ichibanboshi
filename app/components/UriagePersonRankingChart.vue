<script setup lang="ts">
/**
 * 担当者別売上ランキング (横向き bar chart)。
 *
 * `/admin/recalc` の上部に表示する用。recalc 結果の全 (month, eigyosho_id)
 * から日次データを集約し、担当者別 SUM を金額順に並べる。
 *
 * 入力 `data`: 担当者名 → 金額 (cal=true ベース、全営業所合算済み)
 */
import VChart from 'vue-echarts'

const props = defineProps<{
  /** 担当者名 → 売上金額 (cal=true) */
  data: Record<string, number>
  /** title に含める月レンジ表示 (例: "2026-06") */
  monthLabel?: string
}>()

const TOP_N = 15

const sortedData = computed(() => {
  return Object.entries(props.data)
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
})

const option = computed(() => {
  const items = sortedData.value
  // 横向き bar: y 軸が担当者名、上から下に金額順 → ECharts は配列を下から積むので reverse
  const names = items.map((e) => e[0]).reverse()
  const values = items.map((e) => e[1]).reverse()
  return {
    title: {
      text: `担当者別売上 TOP ${TOP_N}${props.monthLabel ? ` (${props.monthLabel})` : ''}`,
      left: 'center',
      textStyle: { fontSize: 14 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = (params as Array<{ name: string; value: number }>)[0]
        if (!p) return ''
        const man = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })
        const yen = p.value.toLocaleString('ja-JP')
        return `${p.name}<br/><strong>${man} 万円</strong> (${yen} 円)`
      },
    },
    grid: { left: 80, right: 40, top: 40, bottom: 30, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) =>
          v >= 10000 ? `${(v / 10000).toLocaleString('ja-JP')}万` : v.toString(),
      },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: { color: '#2563eb' },
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          formatter: (p: { value: number }) =>
            (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + '万',
        },
      },
    ],
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <div v-if="sortedData.length === 0" class="text-gray-500 text-sm text-center py-10">
      (データなし — recalc 後に表示されます)
    </div>
    <ClientOnly v-else>
      <VChart :option="option" :style="{ height: Math.max(300, sortedData.length * 30 + 80) + 'px' }" autoresize />
    </ClientOnly>
  </div>
</template>
