<script setup lang="ts">
/**
 * 得意先ネット (売上-支払差額) 一覧ページ (rust-ichibanboshi#68)。
 *
 * 元は `/unchin` (運賃リスト) ページ末尾に埋め込みだったが、user 2026-07-01
 * 「得意先ネット (売上-支払差額) は別タブに」との指示で独立ページに切り出した。
 * `/unchin` の期間ピッカーとは独立して、このページ単独で期間を指定できる。
 */
import { AuthToolbar } from '~/composables/useAuth'

type Kind = 'with_billing_only' | 'with_non_billing'
const KIND_OPTIONS: { value: Kind, label: string }[] = [
  { value: 'with_non_billing', label: '請求＋非請求 (請求K IN (0,2)、default)' },
  { value: 'with_billing_only', label: '請求＋請求のみ (請求K IN (0,1))' },
]

const currentYear = new Date().getFullYear()
const from = ref(`${currentYear}-01-01`)
const to = ref(`${currentYear + 1}-01-01`)
const kind = ref<Kind>('with_non_billing')

/** `UnchinCustomerNetPanel` に渡す確定値 (「更新」を押すまで変わらない)。 */
const appliedFrom = ref(from.value)
const appliedTo = ref(to.value)
const appliedKind = ref<Kind>(kind.value)

function reload() {
  appliedFrom.value = from.value
  appliedTo.value = to.value
  appliedKind.value = kind.value
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold">得意先ネット (売上-支払差額)</h1>
          <NuxtLink
            to="/unchin"
            class="text-sm text-gray-700 border border-gray-400 rounded px-3 py-1 bg-white hover:bg-gray-100 no-print"
          >
            ← 運賃リストへ戻る
          </NuxtLink>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-6 flex items-end gap-3 flex-wrap no-print">
        <div>
          <label class="block text-xs text-gray-500">期間 (売上年月日) from</label>
          <input v-model="from" type="date" class="border rounded px-2 py-1 text-sm">
        </div>
        <div>
          <label class="block text-xs text-gray-500">to (含まない)</label>
          <input v-model="to" type="date" class="border rounded px-2 py-1 text-sm">
        </div>
        <div>
          <label class="block text-xs text-gray-500">請求区分</label>
          <select v-model="kind" class="border rounded px-2 py-1 text-sm">
            <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </div>
        <button class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700" @click="reload">
          更新
        </button>
      </div>

      <UnchinCustomerNetPanel :from="appliedFrom" :to="appliedTo" :kind="appliedKind" />
    </main>
  </div>
</template>
