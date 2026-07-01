<script setup lang="ts">
/**
 * PHP vs Rust 担当者別売上 検証ページ (Phase 1)。
 *
 * UI ロジック本体は `UriageVerifyPanel.vue` に集約 (/admin/recalc から
 * 同 component を埋め込んでいるため、共通化、Refs ohishi-exp/rust-ichibanboshi#41)。
 */
import UriageVerifyPanel from '~/components/UriageVerifyPanel.vue'
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <AppHeader title="PHP vs Rust 検証" />

    <main class="max-w-7xl mx-auto px-4 py-6">
      <UriageVerifyPanel />
    </main>
  </div>
</template>
