import { ref, watch } from 'vue'
import type { YoyDisplayMode } from '~/utils/format'

const STORAGE_KEY = 'ichibanboshi:yoy-display-mode'
const mode = ref<YoyDisplayMode>('ratio')
let initialized = false

function ensureInit() {
  if (initialized || !import.meta.client) return
  initialized = true
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'ratio' || saved === 'diff') mode.value = saved
  watch(mode, (v) => window.localStorage.setItem(STORAGE_KEY, v))
}

export function useYoyDisplayMode() {
  ensureInit()

  function toggle() {
    mode.value = mode.value === 'ratio' ? 'diff' : 'ratio'
  }

  return { mode, toggle }
}
