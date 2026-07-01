<script setup lang="ts">
/**
 * 担当者ドリルダウンページ (得意先別・傭車先別 内訳)。
 *
 * `UriagePersonShareRanking` の行クリックから `/person/<name>?from=&to=` で遷移する
 * (`customer/[code].vue` と同じ別ページ遷移パターン、user 2026-07-01
 * 「ドリルダウンはほかのとおなじようにページ変えて」)。
 * 実データ取得・描画は `UriagePersonPartnerBreakdown` に委譲する。
 */
import { AuthToolbar } from '~/composables/useAuth'

const route = useRoute()
const personName = route.params.name as string

const currentYear = new Date().getFullYear()
const from = (route.query.from as string) || `${currentYear - 1}-04`
const to = (route.query.to as string) || `${currentYear}-03`

const excludeYokoyoko = ref(false)
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
          <span class="text-sm text-gray-400">{{ from }} 〜 {{ to }}</span>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" class="no-print" />
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <UriagePersonPartnerBreakdown
        :person-name="personName"
        :from="from"
        :to="to"
        v-model:exclude-yokoyoko="excludeYokoyoko"
      />
    </main>
  </div>
</template>
