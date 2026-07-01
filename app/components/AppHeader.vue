<script setup lang="ts">
/**
 * 全ページ共通ヘッダー (user 2026-07-01「header のボタン共通化して、どこからでも
 * どこでも移動できるようにして」)。
 *
 * 従来は各ページが個別にヘッダーを実装しており、ページ間の相互リンクが
 * 「トップへ戻る」等の一方向 (子→親) にしか無かった。主要ページ (ダッシュボード /
 * 運賃リスト / 得意先前年比 / 再計算 / 検証) への横断リンクを常時表示し、
 * どのページからでも他の主要ページへ 1 クリックで移動できるようにする。
 *
 * ページ固有の追加リンク (品名グルーピング管理・得意先ネット等) は
 * `#extra` slot で個別ページ側から差し込む。
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
  { to: '/customers', label: '得意先前年比', icon: '📈' },
  { to: '/admin/recalc', label: '再計算', icon: '🔧' },
  { to: '/admin/verify', label: '検証', icon: '🔍' },
]

const route = useRoute()

/** 現在ページがそのリンクの配下 (自身またはサブページ) かどうか。 */
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
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
