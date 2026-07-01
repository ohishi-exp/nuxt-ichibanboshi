<script setup lang="ts">
/**
 * 全ページ共通ヘッダー (user 2026-07-01「header のボタン共通化して、どこからでも
 * どこでも移動できるようにして」)。
 *
 * 従来は各ページが個別にヘッダーを実装しており、ページ間の相互リンクが
 * 「トップへ戻る」等の一方向 (子→親) にしか無かった。主要ページ (ダッシュボード /
 * 運賃リスト / 得意先前年比 / 再計算 / 検証 / 得意先ネット / 品名グルーピング管理)
 * への横断リンクを常時表示し、どのページからでも他の主要ページへ 1 クリックで
 * 移動できるようにする (得意先ネット・品名グルーピング管理は当初 `/unchin` ページ
 * 固有の extra slot リンクだったが、user 2026-07-01「得意先ネットもいれて」
 * 「品名グルーピングもいれて」で共通ナビに昇格した)。
 *
 * それ以外のページ固有の追加リンクは `#extra` slot で個別ページ側から差し込む。
 */
import { AuthToolbar } from '~/composables/useAuth'

withDefaults(defineProps<{
  title: string
  maxWidthClass?: string
}>(), {
  maxWidthClass: 'max-w-7xl',
})

interface NavLink {
  to: string
  label: string
  icon: string
}

const NAV_LINKS: NavLink[] = [
  { to: '/', label: 'ダッシュボード', icon: '📊' },
  { to: '/unchin', label: '運賃リスト', icon: '🚚' },
  { to: '/unchin/customer-net', label: '得意先ネット', icon: '💰' },
  { to: '/unchin/alias-items', label: '品名グルーピング', icon: '🏷️' },
  { to: '/customers', label: '得意先前年比', icon: '📈' },
  { to: '/admin/recalc', label: '再計算', icon: '🔧' },
  { to: '/admin/verify', label: '検証', icon: '🔍' },
]

const route = useRoute()

/**
 * 現在ページに最も近い (最長 prefix match の) リンクだけをハイライトする。
 * `/unchin` はより具体的な `/unchin/customer-net` 等のサブページからも prefix
 * match してしまうため、単純な「該当したら全部ハイライト」だと `/unchin/customer-net`
 * 表示中に「運賃リスト」と「得意先ネット」が両方ハイライトされてしまう。
 */
const activeTo = computed<string | null>(() => {
  const path = route.path
  let best: string | null = null
  for (const l of NAV_LINKS) {
    const matches = l.to === '/' ? path === '/' : (path === l.to || path.startsWith(`${l.to}/`))
    if (matches && (!best || l.to.length > best.length)) best = l.to
  }
  return best
})
function isActive(to: string): boolean {
  return activeTo.value === to
}
</script>

<template>
  <header class="bg-white shadow no-print">
    <div class="mx-auto px-4 py-4 flex justify-between items-center flex-wrap gap-y-2" :class="maxWidthClass">
      <div class="flex items-center gap-3 flex-wrap">
        <h1 class="text-xl font-bold whitespace-nowrap">{{ title }}</h1>
        <nav class="flex items-center gap-2 flex-wrap">
          <NuxtLink
            v-for="l in NAV_LINKS"
            :key="l.to"
            :to="l.to"
            class="text-sm border rounded px-3 py-1"
            :class="isActive(l.to)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'text-gray-700 border-gray-400 bg-white hover:bg-gray-100'"
          >
            {{ l.icon }} {{ l.label }}
          </NuxtLink>
        </nav>
        <div class="flex items-center gap-2 flex-wrap">
          <slot name="extra" />
        </div>
      </div>
      <AuthToolbar :show-copy-url="false" :show-qr="false" />
    </div>
  </header>
</template>
