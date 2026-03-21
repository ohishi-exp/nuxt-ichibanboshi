<script setup lang="ts">
import VChart from 'vue-echarts'
import type { CustomerSales } from '~/types'

const props = defineProps<{
  data: CustomerSales[]
  sourceTable?: string
}>()
const option = computed(() => {
  const top10 = [...props.data].slice(0, 10)
  return {
    title: { text: '得意先別売上 TOP10', left: 'center' },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
        return `${p.name}<br/>${val}万円 (${p.percent}%)`
      },
    },
    legend: { orient: 'vertical', right: 10, top: 'middle', type: 'scroll', textStyle: { fontSize: 11, width: 150, overflow: 'truncate' } },
    series: [
      {
        type: 'pie',
        radius: ['25%', '55%'],
        center: ['35%', '50%'],
        data: top10.map(d => ({
          name: d.customer_name || d.customer_code,
          value: d.total_sales,
        })),
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' },
        },
        label: { show: false },
        labelLine: { show: false },
      },
    ],
  }
})
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <VChart :option="option" style="height: 500px" autoresize />
    <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
  </div>
</template>
