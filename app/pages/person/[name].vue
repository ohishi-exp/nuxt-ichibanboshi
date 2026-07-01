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
 *
 * 担当者もこのページから切り替えられる (user 2026-07-01 「人も選べるようにして」)。
 * 選択肢は現在の期間の `/api/uriage/person-monthly-totals` から担当者名一覧を
 * 抽出して作る (ダッシュボードの構成順位表と同じデータソース)。選択すると
 * 同じ期間のまま `/person/<新担当者>` へ遷移する。
 */
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
  loadPersonOptions()
}

interface PersonMonthlyTotalRow {
  person_name: string
}
interface PersonMonthlyTotalsResponse {
  rows: PersonMonthlyTotalRow[]
}

/** 担当者セレクタの選択肢 (現在の期間に売上がある担当者、五十音順)。 */
const personOptions = ref<string[]>([personName])

async function loadPersonOptions() {
  try {
    const res = await $fetch<PersonMonthlyTotalsResponse>(
      `/api/uriage/person-monthly-totals?from=${appliedFrom.value}&to=${appliedTo.value}&cal=true`,
    )
    const names = new Set(res.rows.map((r) => r.person_name))
    // 現在表示中の担当者がこの期間に売上0でも選択肢から消えないようにする
    names.add(personName)
    personOptions.value = Array.from(names).sort((a, b) => a.localeCompare(b, 'ja'))
  } catch {
    personOptions.value = [personName]
  }
}
onMounted(loadPersonOptions)

function onPersonChange(newName: string) {
  if (!newName || newName === personName) return
  const query = new URLSearchParams({ from: appliedFrom.value, to: appliedTo.value })
  navigateTo(`/person/${encodeURIComponent(newName)}?${query.toString()}`)
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <AppHeader :title="personName">
      <template #extra>
        <span class="text-sm text-gray-400">{{ appliedFrom }} 〜 {{ appliedTo }}</span>
      </template>
    </AppHeader>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4 no-print">
        <label class="text-sm font-medium">担当者:</label>
        <select
          :value="personName"
          class="border rounded px-2 py-1 text-sm"
          @change="onPersonChange(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="name in personOptions" :key="name" :value="name">{{ name }}</option>
        </select>
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
