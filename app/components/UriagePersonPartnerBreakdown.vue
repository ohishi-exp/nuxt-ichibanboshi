<script setup lang="ts">
/**
 * 担当者ドリルダウン: 得意先別・傭車先別 売上構成 (円グラフ 2 枚)。
 *
 * 「担当者 売上構成順位」テーブルの行クリックで起動する。
 * `/api/uriage/person-partner-totals?person=&from=&to=&cal=true` (rust の
 * uriage_person_partner_daily 由来) を叩く。cal は常に true 固定 (全営業所合算、
 * 他の担当者系コンポーネントと同じ規約)。`excludeYokoyoko` は client 側で
 * kingaku/kingaku_y0 を切り替えるだけで再 fetch はしない (同レスポンスに両方入っている)。
 */
import VChart from 'vue-echarts'

const props = defineProps<{
  personName: string
  from: string
  to: string
}>()

/** 横横除外フィルタ (v-model:exclude-yokoyoko で親と双方向 binding、他コンポーネントと同期) */
const excludeYokoyoko = defineModel<boolean>('excludeYokoyoko', { default: false })

interface PartnerTotal {
  partner_code: string
  partner_name: string
  kingaku: number
  kensuu: number
  kingaku_y0?: number
  kensuu_y0?: number
}
interface PersonPartnerTotalsResponse {
  person: string
  from: string
  to: string
  cal: boolean
  customers: PartnerTotal[]
  subcontractors: PartnerTotal[]
}

const loading = ref(true)
const error = ref('')
const data = ref<PersonPartnerTotalsResponse | null>(null)

async function load() {
  if (!props.personName || !props.from || !props.to) return
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      person: props.personName,
      from: props.from,
      to: props.to,
      cal: 'true',
    })
    data.value = await $fetch<PersonPartnerTotalsResponse>(
      `/api/uriage/person-partner-totals?${params.toString()}`,
    )
  } catch (e: any) {
    error.value = e.message || '読み込みに失敗しました'
    data.value = null
  } finally {
    loading.value = false
  }
}

watch(() => [props.personName, props.from, props.to], load, { immediate: true })

function pickKingaku(r: PartnerTotal): number {
  return excludeYokoyoko.value ? (r.kingaku_y0 ?? 0) : r.kingaku
}

// 得意先/傭車先とも上位 10 + その他 (CustomerSalesChart と同じ方式)
const TOP_N = 10

function buildPieData(rows: PartnerTotal[]): Array<{ name: string; value: number }> {
  const sorted = rows
    .map((r) => ({ name: r.partner_name || r.partner_code, value: pickKingaku(r) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, TOP_N)
  const restTotal = sorted.slice(TOP_N).reduce((s, r) => s + r.value, 0)
  if (restTotal > 0) top.push({ name: 'その他', value: restTotal })
  return top
}

function fmtMan(yen: number): string {
  const man = Math.round(yen / 10000)
  if (man >= 10000) return `${(man / 10000).toFixed(1)}億`
  if (man >= 1000) return `${(man / 1000).toFixed(1)}千万`
  return `${man.toLocaleString('ja-JP')}万`
}

function pieOption(title: string, rows: PartnerTotal[]) {
  const pieData = buildPieData(rows)
  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 13 } },
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const param = p as { name: string; value: number; percent: number }
        return `${param.name}<br/>${fmtMan(param.value)}円 (${param.percent}%)`
      },
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'middle',
      type: 'scroll',
      textStyle: { fontSize: 11, width: 130, overflow: 'truncate' },
    },
    series: [
      {
        type: 'pie',
        radius: ['25%', '55%'],
        center: ['35%', '50%'],
        data: pieData,
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' },
        },
        label: { show: false },
        labelLine: { show: false },
      },
    ],
  }
}

const customerOption = computed(() => pieOption('得意先別 売上構成', data.value?.customers ?? []))
const subcontractorOption = computed(() =>
  pieOption('傭車先別 傭車金額構成', data.value?.subcontractors ?? []),
)

const hasCustomerData = computed(() =>
  (data.value?.customers ?? []).some((r) => pickKingaku(r) > 0),
)
const hasSubcontractorData = computed(() =>
  (data.value?.subcontractors ?? []).some((r) => pickKingaku(r) > 0),
)
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4 print-section">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-semibold">
        {{ personName }} の得意先・傭車先 内訳
        <span v-if="excludeYokoyoko" class="ml-1 text-xs text-purple-700">[横横除外]</span>
      </h3>
      <label class="flex items-center gap-1 text-xs cursor-pointer select-none no-print">
        <input v-model="excludeYokoyoko" type="checkbox" class="rounded" />
        横横除外
      </label>
    </div>

    <div v-if="loading" class="text-center py-10 text-gray-500 text-sm">読み込み中...</div>
    <div v-else-if="error" class="text-center py-10">
      <p class="text-red-600 text-sm">{{ error }}</p>
      <button class="mt-2 bg-blue-600 text-white px-3 py-1 rounded text-xs" @click="load">
        再試行
      </button>
    </div>
    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <ClientOnly v-if="hasCustomerData">
          <VChart :option="customerOption" style="height: 360px" autoresize />
        </ClientOnly>
        <p v-else class="text-gray-500 text-sm text-center py-16">
          (得意先データなし — /admin/recalc で再計算してください)
        </p>
      </div>
      <div>
        <ClientOnly v-if="hasSubcontractorData">
          <VChart :option="subcontractorOption" style="height: 360px" autoresize />
        </ClientOnly>
        <p v-else class="text-gray-500 text-sm text-center py-16">傭車先データなし (自車運行のみ)</p>
      </div>
    </div>
  </div>
</template>
