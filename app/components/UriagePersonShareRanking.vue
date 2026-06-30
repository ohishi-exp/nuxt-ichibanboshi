<script setup lang="ts">
/**
 * 担当者 売上構成順位 (期間合計 1 回分の表)。
 *
 * 顧客の TopRanking と同じパターン: 順位 / 担当者名 / 売上 / 構成比 (%) を
 * 期間合計でテーブル表示する (`/api/uriage/person-monthly-totals` を集約)。
 *
 * `excludeYokoyoko=true` で横横=1 行を除外した y0 値を使用する
 * (user 2026-06-30: 「担当者 売上順位推移と売上構成推移に 横横 除外フィルタつけて」)。
 */
interface MonthlyTotal {
  month: string
  person_name: string
  eigyosho_id: number
  cal: boolean
  kingaku: number
  yosha_kingaku: number
  kensuu: number
  kingaku_y0?: number
  yosha_kingaku_y0?: number
  kensuu_y0?: number
}

const props = withDefaults(
  defineProps<{
    rows: MonthlyTotal[]
    /** 表示行数 (default 20) */
    limit?: number
    /** 表のタイトルに含める期間ラベル (例: "2026-01〜2026-06") */
    periodLabel?: string
  }>(),
  { limit: 20, periodLabel: '' },
)

/** 横横除外フィルタ (v-model:exclude-yokoyoko で親と双方向 binding) */
const excludeYokoyoko = defineModel<boolean>('excludeYokoyoko', { default: false })

function pickKingaku(r: MonthlyTotal): number {
  return excludeYokoyoko.value ? (r.kingaku_y0 ?? 0) : r.kingaku
}
function pickKensuu(r: MonthlyTotal): number {
  return excludeYokoyoko.value ? (r.kensuu_y0 ?? 0) : r.kensuu
}

interface RankingRow {
  rank: number
  person_name: string
  total: number
  kensuu: number
  share: number
}

const ranking = computed<RankingRow[]>(() => {
  if (props.rows.length === 0) return []

  // 担当者ごとに期間合計
  const totals = new Map<string, { kingaku: number; kensuu: number }>()
  for (const r of props.rows) {
    const cur = totals.get(r.person_name) ?? { kingaku: 0, kensuu: 0 }
    cur.kingaku += pickKingaku(r)
    cur.kensuu += pickKensuu(r)
    totals.set(r.person_name, cur)
  }

  const sumAll = Array.from(totals.values()).reduce((s, v) => s + v.kingaku, 0)

  return Array.from(totals.entries())
    .filter(([_, v]) => v.kingaku > 0)
    .sort((a, b) => b[1].kingaku - a[1].kingaku)
    .slice(0, props.limit)
    .map(([name, v], idx) => ({
      rank: idx + 1,
      person_name: name,
      total: v.kingaku,
      kensuu: v.kensuu,
      share: sumAll > 0 ? (v.kingaku / sumAll) * 100 : 0,
    }))
})

const grandTotal = computed(() => ranking.value.reduce((s, r) => s + r.total, 0))

function fmtYen(yen: number): string {
  return yen.toLocaleString('ja-JP')
}
function fmtMan(yen: number): string {
  const man = yen / 10000
  if (man >= 10000) return `${(man / 10000).toFixed(1)} 億`
  if (man >= 1000) return `${(man / 1000).toFixed(1)} 千万`
  return `${Math.round(man).toLocaleString('ja-JP')} 万`
}
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4 print-section print-table">
    <div class="flex items-center mb-2">
      <div class="text-sm font-semibold">
        担当者 売上構成順位 (期間合計 上位 {{ ranking.length }} 名)
        <span v-if="excludeYokoyoko" class="ml-1 text-xs text-purple-700">[横横除外]</span>
        <span v-if="periodLabel" class="ml-1 text-xs text-gray-500">({{ periodLabel }})</span>
      </div>
      <!-- component 内 toggle (親と v-model:exclude-yokoyoko で同期) -->
      <label class="ml-auto flex items-center gap-1 text-xs cursor-pointer select-none no-print">
        <input v-model="excludeYokoyoko" type="checkbox" class="rounded" />
        横横除外
      </label>
    </div>
    <div v-if="ranking.length === 0" class="text-center py-8 text-gray-500 text-sm">
      (データなし — 期間を変えるか、<NuxtLink to="/admin/recalc" class="text-blue-600 hover:underline">/admin/recalc</NuxtLink> で再計算してください)
    </div>
    <div v-else class="overflow-x-auto">
      <table class="text-sm border-collapse w-full">
        <thead class="bg-gray-100">
          <tr>
            <th class="text-right px-3 py-2 w-16">順位</th>
            <th class="text-left px-3 py-2">担当者</th>
            <th class="text-right px-3 py-2 w-32">売上</th>
            <th class="text-right px-3 py-2 w-24">件数</th>
            <th class="text-right px-3 py-2 w-24">構成比 %</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in ranking"
            :key="row.person_name"
            class="border-t hover:bg-gray-50"
          >
            <td class="px-3 py-1 text-right font-mono">{{ row.rank }}</td>
            <td class="px-3 py-1">{{ row.person_name }}</td>
            <td class="px-3 py-1 text-right font-mono" :title="`${fmtYen(row.total)} 円`">
              {{ fmtMan(row.total) }}
            </td>
            <td class="px-3 py-1 text-right font-mono">{{ row.kensuu.toLocaleString('ja-JP') }}</td>
            <td class="px-3 py-1 text-right font-mono">{{ row.share.toFixed(1) }}</td>
          </tr>
        </tbody>
        <tfoot class="border-t-2 border-gray-300 bg-gray-50">
          <tr>
            <td class="px-3 py-2 text-right font-semibold" colspan="2">上位 {{ ranking.length }} 名 合計</td>
            <td class="px-3 py-2 text-right font-mono font-semibold" :title="`${fmtYen(grandTotal)} 円`">
              {{ fmtMan(grandTotal) }}
            </td>
            <td class="px-3 py-2"></td>
            <td class="px-3 py-2 text-right font-mono font-semibold">100.0</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
