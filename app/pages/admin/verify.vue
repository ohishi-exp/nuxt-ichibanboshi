<script setup lang="ts">
/**
 * PHP vs Rust 担当者別売上 検証ページ (Phase 1)。
 *
 * UI ロジック本体は `UriageVerifyPanel.vue` に集約 (/admin/recalc から
 * 同 component を埋め込んでいるため、共通化、Refs ohishi-exp/rust-ichibanboshi#41)。
 */
import { AuthToolbar } from '~/composables/useAuth'
import UriageVerifyPanel from '~/components/UriageVerifyPanel.vue'
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 class="text-xl font-bold">PHP vs Rust 検証</h1>
        <AuthToolbar :show-copy-url="false" :show-qr="false" />
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <UriageVerifyPanel />
    </main>
  </div>
</template>
