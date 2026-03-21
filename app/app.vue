<template>
  <div>
    <Head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>一番星 売上ビューア</title>
    </Head>
    <NuxtPage />
  </div>
</template>

<style>
/* ECharts canvas がホイールスクロールを奪うのを防止 */
canvas[data-zr-dom-id] {
  touch-action: auto !important;
}
</style>
