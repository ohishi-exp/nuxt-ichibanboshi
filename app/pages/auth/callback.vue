<script setup lang="ts">
const { setTokens } = useAuth()

onMounted(async () => {
  const hash = window.location.hash.substring(1)
  const params = new URLSearchParams(hash)
  const token = params.get('token') || params.get('access_token')
  const refreshToken = params.get('refresh_token')

  if (token) {
    const ok = await setTokens(token, refreshToken || undefined)
    navigateTo(ok ? '/' : '/login')
  } else {
    navigateTo('/login')
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <p class="text-gray-500">認証処理中...</p>
  </div>
</template>
