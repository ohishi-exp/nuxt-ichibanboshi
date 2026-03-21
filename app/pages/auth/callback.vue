<script setup lang="ts">
const { setTokens } = useAuth()

onMounted(() => {
  // rust-alc-api は #token=...&refresh_token=...&expires_in=... で返す
  const hash = window.location.hash.substring(1)
  const params = new URLSearchParams(hash)
  const token = params.get('token')
  const refreshToken = params.get('refresh_token')

  if (token) {
    setTokens(token, refreshToken || undefined)
    navigateTo('/')
  } else {
    // access_token 形式も確認（フォールバック）
    const altToken = params.get('access_token')
    if (altToken) {
      setTokens(altToken, refreshToken || undefined)
      navigateTo('/')
    } else {
      console.error('No token found in callback', { hash: window.location.hash, search: window.location.search })
      navigateTo('/login')
    }
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <p class="text-gray-500">認証処理中...</p>
  </div>
</template>
