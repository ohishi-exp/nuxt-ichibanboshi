import { computed, ref, type Ref } from 'vue'

/**
 * チェックボックス式 Y軸 max スナップショット固定 composable
 *
 * - locked=false: localStorage 削除、yMax は undefined (ECharts auto)
 * - locked=true:  チェック ON した瞬間の "現在の auto max" を localStorage に保存し、それを返す
 *
 * 単位は円 (ECharts の内部値と一致)。表示用に lockedLabelMan で「万」表記を返す。
 */
const STORAGE_PREFIX = 'ichibanboshi:y-max-lock:'

export function useChartYMaxLock(key: string, currentAutoMax: Ref<number | undefined>) {
  const storageKey = STORAGE_PREFIX + key

  const locked = ref(false)
  const lockedValue = ref<number | undefined>(undefined)

  if (import.meta.client) {
    const saved = window.localStorage.getItem(storageKey)
    if (saved !== null && saved !== '') {
      const n = Number(saved)
      if (Number.isFinite(n) && n > 0) {
        locked.value = true
        lockedValue.value = n
      }
    }
  }

  // checkbox v-model: ON で現在の auto max をスナップショット、OFF でクリア
  const isLocked = computed({
    get: () => locked.value,
    set: (v: boolean) => {
      locked.value = v
      if (v) {
        const snap = currentAutoMax.value ?? 0
        lockedValue.value = snap > 0 ? snap : undefined
        if (import.meta.client && lockedValue.value !== undefined) {
          window.localStorage.setItem(storageKey, String(lockedValue.value))
        }
      } else {
        lockedValue.value = undefined
        if (import.meta.client) window.localStorage.removeItem(storageKey)
      }
    },
  })

  // ECharts yAxis.max に渡す値 (undefined = auto)
  const yMax = computed<number | undefined>(() => (locked.value ? lockedValue.value : undefined))

  // 表示用ラベル: 「(12,345)万」のように現在固定値を出す
  const lockedLabelMan = computed(() =>
    locked.value && lockedValue.value
      ? Math.round(lockedValue.value / 10000).toLocaleString('ja-JP')
      : '',
  )

  return { isLocked, yMax, lockedLabelMan }
}
