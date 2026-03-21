<script setup lang="ts">
const { loginWithGoogle, isAuthenticated, authError } = useAuth()

onMounted(() => {
  if (isAuthenticated.value) navigateTo('/')
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="bg-white p-8 rounded-lg shadow-md w-96">
      <h1 class="text-2xl font-bold text-center mb-6">一番星 売上ビューア</h1>
      <p v-if="authError" class="text-red-600 text-center mb-4 text-sm">{{ authError }}</p>
      <p v-else class="text-gray-600 text-center mb-6">ログインしてください</p>
      <button
        class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition"
        @click="loginWithGoogle"
      >
        Google でログイン
      </button>
    </div>
  </div>
</template>
