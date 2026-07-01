<script setup lang="ts">
/**
 * 担当者ドリルダウンページ (得意先別・傭車先別 内訳)。
 *
 * `UriagePersonShareRanking` の行クリックから `/person/<name>?from=&to=` で遷移する
 * (`customer/[code].vue` と同じ別ページ遷移パターン、user 2026-07-01
 * 「ドリルダウンはほかのとおなじようにページ変えて」)。
 * 実データ取得・描画は `UriagePersonPartnerBreakdown` に委譲する。
 *
 * 期間 (from/to) はこのページ単独でも変更できる (index.vue と同じ月ピッカー UI、
 * user 2026-07-01 「月のui」)。「更新」を押すまでは反映しない (index.vue の
 * loadData ボタン規約に合わせる) + URL query にも書き戻し、リロード/共有時に
 * 同じ期間で開けるようにする。
 */
import { AuthToolbar } from '~/composables/useAuth'

const route = useRoute()
const router = useRouter()
const personName = route.params.name as string

const currentYear = new Date().getFullYear()
const defaultFrom = `${currentYear - 1}-04`
const defaultTo = `${currentYear}-03`

/** 月ピッカーの編集値 */
const from = ref((route.query.from as string) || defaultFrom)
const to = ref((route.query.to as string) || defaultTo)
/** UriagePersonPartnerBreakdown に渡す確定値 (「更新」を押すまで変わらない) */
const appliedFrom = ref(from.value)
const appliedTo = ref(to.value)

const excludeYokoyoko = ref(false)

function reload() {
  appliedFrom.value = from.value
  appliedTo.value = to.value
  router.replace({ query: { ...route.query, from: from.value, to: to.value } })
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <button class="text-sm text-blue-600 hover:underline" @click="navigateTo('/')">
            &larr; ダッシュボード
          </button>
          <h1 class="text-xl font-bold">{{ personName }}</h1>
          <span class="text-sm text-gray-400">{{ appliedFrom }} 〜 {{ appliedTo }}</span>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4 no-print">
        <label class="text-sm font-medium">期間:</label>
        <input v-model="from" type="month" class="border rounded px-2 py-1 text-sm" />
        <span>〜</span>
        <input v-model="to" type="month" class="border rounded px-2 py-1 text-sm" />
        <button
          class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700"
          @click="reload"
        >
          更新
        </button>
      </div>

      <UriagePersonPartnerBreakdown
        :person-name="personName"
        :from="appliedFrom"
        :to="appliedTo"
        v-model:exclude-yokoyoko="excludeYokoyoko"
      />
    </main>
  </div>
</template>
