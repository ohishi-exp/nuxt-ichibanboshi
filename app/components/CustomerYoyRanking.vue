<script setup lang="ts">
import type { CustomerYoy, CustomerYoyResponse, DepartmentOption } from '~/types'

// 営業所フィルタが有効な時は department_code/name が付く
interface CustomerYoyItem extends CustomerYoy {
  department_code?: string
  department_name?: string
}

const props = defineProps<{
  data: CustomerYoyResponse
  sourceTable?: string
  departments?: DepartmentOption[]
  selectedDept?: string
}>()

const emit = defineEmits<{
  'update:selectedDept': [value: string]
}>()

function onDeptChange(e: Event) {
  emit('update:selectedDept', (e.target as HTMLSelectElement).value)
}

type SortKey = 'customer_name' | 'current_total' | 'prev_total' | 'yoy_percent'
type SortOrder = 'asc' | 'desc'

interface SortState {
  key: SortKey
  order: SortOrder
}

// プラス側: 従来は前年売上降順 / マイナス側: 従来は YoY% 昇順
const positiveSort = ref<SortState>({ key: 'prev_total', order: 'desc' })
const negativeSort = ref<SortState>({ key: 'yoy_percent', order: 'asc' })

function compare(a: CustomerYoyItem, b: CustomerYoyItem, key: SortKey, order: SortOrder): number {
  const mul = order === 'asc' ? 1 : -1
  if (key === 'customer_name') {
    return a.customer_name.localeCompare(b.customer_name, 'ja') * mul
  }
  const av = (a[key] as number) ?? 0
  const bv = (b[key] as number) ?? 0
  return (av - bv) * mul
}

const sortedPositive = computed(() => {
  const { key, order } = positiveSort.value
  return [...props.data.positive].sort((a, b) => compare(a, b, key, order))
})

const sortedNegative = computed(() => {
  const { key, order } = negativeSort.value
  return [...props.data.negative].sort((a, b) => compare(a, b, key, order))
})

function toggleSort(which: 'positive' | 'negative', key: SortKey) {
  const stateRef = which === 'positive' ? positiveSort : negativeSort
  if (stateRef.value.key === key) {
    stateRef.value = { key, order: stateRef.value.order === 'asc' ? 'desc' : 'asc' }
  } else {
    // 新しいキー: 文字列は asc、数値は desc を既定にして直感的に
    stateRef.value = { key, order: key === 'customer_name' ? 'asc' : 'desc' }
  }
}

function sortIcon(state: SortState, key: SortKey): string {
  if (state.key !== key) return '⇅'
  return state.order === 'asc' ? '▲' : '▼'
}

function formatMan(val: number) {
  return Math.round(val / 10000).toLocaleString('ja-JP')
}

function formatPct(val: number) {
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}%`
}
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <div class="flex justify-between items-center mb-4">
      <div class="flex items-center gap-3 flex-wrap">
        <h2 class="text-lg font-bold">得意先 前年同期比ランキング</h2>
        <NuxtLink to="/customers" class="inline-flex items-center gap-1 text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded">
          詳細・比較ページ &rarr;
        </NuxtLink>
        <template v-if="departments && departments.length">
          <label class="text-sm font-medium ml-2">営業所:</label>
          <select :value="selectedDept ?? ''" class="border rounded px-2 py-1 text-sm" @change="onDeptChange">
            <option value="">全社</option>
            <option v-for="d in departments" :key="d.department_code" :value="d.department_code">
              {{ d.department_name || d.department_code }}
            </option>
          </select>
        </template>
      </div>
      <div class="text-right">
        <span class="text-xs text-gray-400 block">前年{{ data.months }}ヶ月合計 {{ formatMan(data.min_prev) }}万円以上</span>
        <span v-if="sourceTable" class="text-xs text-gray-400">{{ sourceTable }}</span>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 増加 TOP -->
      <div class="overflow-auto max-h-[600px]">
        <h3 class="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1 sticky top-0 bg-white">
          <span class="inline-block w-2 h-2 rounded-full bg-green-500" />
          増加 TOP
        </h3>
        <table class="w-full text-sm">
          <thead class="sticky top-6 bg-white">
            <tr class="border-b text-gray-500 text-xs">
              <th class="text-left py-1 w-8">#</th>
              <th v-if="selectedDept" class="text-left py-1">営業所</th>
              <th class="text-left py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'customer_name')">
                  得意先<span class="text-[10px]">{{ sortIcon(positiveSort, 'customer_name') }}</span>
                </button>
              </th>
              <th class="text-right py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'prev_total')">
                  前年(万)<span class="text-[10px]">{{ sortIcon(positiveSort, 'prev_total') }}</span>
                </button>
              </th>
              <th class="text-right py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'current_total')">
                  今期(万)<span class="text-[10px]">{{ sortIcon(positiveSort, 'current_total') }}</span>
                </button>
              </th>
              <th class="text-right py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('positive', 'yoy_percent')">
                  YoY%<span class="text-[10px]">{{ sortIcon(positiveSort, 'yoy_percent') }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in sortedPositive" :key="`${(item as CustomerYoyItem).department_code ?? ''}-${item.customer_code}`" class="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" @click="navigateTo(`/customer/${item.customer_code}`)">
              <td class="py-1.5 text-gray-400">{{ i + 1 }}</td>
              <td v-if="selectedDept" class="py-1.5 truncate max-w-[100px] text-gray-600" :title="(item as CustomerYoyItem).department_name || (item as CustomerYoyItem).department_code">{{ (item as CustomerYoyItem).department_name || (item as CustomerYoyItem).department_code }}</td>
              <td class="py-1.5 truncate max-w-[160px] text-blue-600 hover:underline" :title="item.customer_name">{{ item.customer_name }}</td>
              <td class="py-1.5 text-right text-gray-500">{{ formatMan(item.prev_total) }}</td>
              <td class="py-1.5 text-right">{{ formatMan(item.current_total) }}</td>
              <td class="py-1.5 text-right font-semibold text-green-600">{{ formatPct(item.yoy_percent) }}</td>
            </tr>
            <tr v-if="!sortedPositive.length">
              <td :colspan="selectedDept ? 6 : 5" class="py-4 text-center text-gray-400">データなし</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 減少 TOP -->
      <div class="overflow-auto max-h-[600px] print-page-break">
        <h3 class="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1 sticky top-0 bg-white">
          <span class="inline-block w-2 h-2 rounded-full bg-red-500" />
          減少 TOP
        </h3>
        <table class="w-full text-sm">
          <thead class="sticky top-6 bg-white">
            <tr class="border-b text-gray-500 text-xs">
              <th class="text-left py-1 w-8">#</th>
              <th v-if="selectedDept" class="text-left py-1">営業所</th>
              <th class="text-left py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'customer_name')">
                  得意先<span class="text-[10px]">{{ sortIcon(negativeSort, 'customer_name') }}</span>
                </button>
              </th>
              <th class="text-right py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'prev_total')">
                  前年(万)<span class="text-[10px]">{{ sortIcon(negativeSort, 'prev_total') }}</span>
                </button>
              </th>
              <th class="text-right py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'current_total')">
                  今期(万)<span class="text-[10px]">{{ sortIcon(negativeSort, 'current_total') }}</span>
                </button>
              </th>
              <th class="text-right py-1">
                <button type="button" class="inline-flex items-center gap-1 hover:text-gray-700" @click="toggleSort('negative', 'yoy_percent')">
                  YoY%<span class="text-[10px]">{{ sortIcon(negativeSort, 'yoy_percent') }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in sortedNegative" :key="`${(item as CustomerYoyItem).department_code ?? ''}-${item.customer_code}`" class="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" @click="navigateTo(`/customer/${item.customer_code}`)">
              <td class="py-1.5 text-gray-400">{{ i + 1 }}</td>
              <td v-if="selectedDept" class="py-1.5 truncate max-w-[100px] text-gray-600" :title="(item as CustomerYoyItem).department_name || (item as CustomerYoyItem).department_code">{{ (item as CustomerYoyItem).department_name || (item as CustomerYoyItem).department_code }}</td>
              <td class="py-1.5 truncate max-w-[160px] text-blue-600 hover:underline" :title="item.customer_name">{{ item.customer_name }}</td>
              <td class="py-1.5 text-right text-gray-500">{{ formatMan(item.prev_total) }}</td>
              <td class="py-1.5 text-right">{{ formatMan(item.current_total) }}</td>
              <td class="py-1.5 text-right font-semibold text-red-600">{{ formatPct(item.yoy_percent) }}</td>
            </tr>
            <tr v-if="!sortedNegative.length">
              <td :colspan="selectedDept ? 6 : 5" class="py-4 text-center text-gray-400">データなし</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
