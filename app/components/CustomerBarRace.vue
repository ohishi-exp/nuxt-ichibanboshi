<script setup lang="ts">
import VChart from 'vue-echarts'
import type { CustomerMonthly } from '~/types'

const props = defineProps<{
  data: CustomerMonthly[]
  sourceTable?: string
}>()

const colors = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0',
  '#c23531', '#2f4554', '#61a0a8', '#d48265', '#91c7ae',
]

const chartRef = ref()
const currentMonthIdx = ref(0)
const playing = ref(false)
const speed = ref(1200)
const speedOptions = [
  { label: '0.5x', value: 2400 },
  { label: '1x', value: 1200 },
  { label: '2x', value: 600 },
  { label: '3x', value: 400 },
]
let timer: ReturnType<typeof setInterval> | null = null

const months = computed(() => {
  if (!props.data.length) return []
  return props.data[0].months.map(m => m.year_month)
})

const currentLabel = computed(() => {
  if (!months.value.length) return ''
  const ym = months.value[currentMonthIdx.value]
  const [y, m] = ym.split('-')
  return `${y}年${parseInt(m)}月`
})

// 各月の得意先ランキングデータ（上位15社）
function getMonthData(monthIdx: number) {
  return props.data
    .map((c, i) => ({
      name: c.customer_name || c.customer_code,
      value: c.months[monthIdx]?.total_sales || 0,
      color: colors[i % colors.length],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15)
}

const option = computed(() => {
  if (!props.data.length || !months.value.length) return {}

  const monthData = getMonthData(currentMonthIdx.value)

  return {
    grid: { left: 150, right: 80, top: 10, bottom: 30 },
    xAxis: {
      max: 'dataMax',
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toLocaleString()}万`,
      },
    },
    yAxis: {
      type: 'category',
      data: monthData.map(d => d.name),
      inverse: true,
      animationDuration: 300,
      animationDurationUpdate: 300,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        realtimeSort: true,
        type: 'bar',
        data: monthData.map(d => ({
          value: d.value,
          itemStyle: { color: d.color },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => {
            const val = (p.value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })
            return `${val}万`
          },
          fontSize: 11,
        },
      },
    ],
    graphic: {
      elements: [
        {
          type: 'text',
          right: 80,
          bottom: 40,
          style: {
            text: currentLabel.value,
            font: 'bold 36px sans-serif',
            fill: 'rgba(100, 100, 100, 0.2)',
          },
          z: 100,
        },
      ],
    },
    animationDuration: 0,
    animationDurationUpdate: Math.round(speed.value * 0.7),
    animationEasing: 'linear',
    animationEasingUpdate: 'linear',
  }
})

function play() {
  if (playing.value) {
    stop()
    return
  }
  playing.value = true
  timer = setInterval(() => {
    if (currentMonthIdx.value < months.value.length - 1) {
      currentMonthIdx.value++
    } else {
      currentMonthIdx.value = 0
    }
  }, speed.value)
}

function stop() {
  playing.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onUnmounted(() => stop())
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-bold">得意先 売上ランキング（バーレース）</h3>
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-blue-600">{{ currentLabel }}</span>
        <button
          class="px-3 py-1 rounded text-sm text-white"
          :class="playing ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'"
          @click="play"
        >
          {{ playing ? '停止' : '再生' }}
        </button>
        <div class="flex gap-1">
          <button
            v-for="s in speedOptions"
            :key="s.value"
            class="px-2 py-0.5 rounded text-xs"
            :class="speed === s.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
            @click="speed = s.value; if (playing) { stop(); play(); }"
          >
            {{ s.label }}
          </button>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="px-2 py-0.5 rounded text-sm bg-gray-200 hover:bg-gray-300"
            :disabled="currentMonthIdx <= 0"
            @click="stop(); currentMonthIdx--"
          >◀</button>
          <input
            v-model="currentMonthIdx"
            type="range"
            :min="0"
            :max="months.length - 1"
            class="w-40"
            @input="stop()"
          />
          <button
            class="px-2 py-0.5 rounded text-sm bg-gray-200 hover:bg-gray-300"
            :disabled="currentMonthIdx >= months.length - 1"
            @click="stop(); currentMonthIdx++"
          >▶</button>
        </div>
      </div>
    </div>
    <VChart v-if="data.length" ref="chartRef" :option="option" style="height: 500px" autoresize />
    <p v-if="sourceTable" class="text-xs text-gray-400 text-right mt-1">参照: {{ sourceTable }}</p>
  </div>
</template>
