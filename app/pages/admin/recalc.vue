<script setup lang="ts">
/**
 * 担当者別売上 再計算管理ページ (Refs ohishi-exp/rust-ichibanboshi#37 = Phase 2 PR-C2/D)。
 *
 * 「再計算」ボタンで POST /api/uriage/recalc を叩き、rust-ichiban が CakePHP から
 * editable_months / masters を pull → 全営業所で集計 + raw NDJSON.gz 出力 + fingerprint
 * 記録までを 1 リクエストで実行する。続けて自動で R2 同期も走らせ、両方の進捗を
 * 1 画面で見せる。
 *
 * cron (月-土 19:00 JST) は safety net。通常はこの画面の「再計算」ボタンで
 * recalc → R2 sync まで完結する。
 */
import { AuthToolbar } from '~/composables/useAuth'

interface RecalcJob {
  month: string
  eigyosho_id: number
  status: string
  row_count: number
  persisted_count_cal: number
  persisted_count_nocal: number
  fingerprint: string | null
  raw_path: string | null
  error: string | null
}

interface RecalcResponse {
  source_table: string
  months: string[]
  editable_months_count: number
  calculated_at: string
  jobs: RecalcJob[]
}

interface SyncResult {
  attempted: number
  uploaded: number
  acked: number
  failures: Array<{ month: string; eigyosho_id: number; stage: string; error: string }>
}

type Phase = 'idle' | 'recalc' | 'sync' | 'done' | 'error'

const month = ref('')
const eigyoshoId = ref('')

const phase = ref<Phase>('idle')
const error = ref('')
const result = ref<RecalcResponse | null>(null)
const syncResult = ref<SyncResult | null>(null)

// 単独で「R2 同期だけ」叩く時のための state
const syncOnlyLoading = ref(false)
const syncOnlyError = ref('')

const busy = computed(() => phase.value === 'recalc' || phase.value === 'sync')

function phaseLabel(p: Phase): string {
  switch (p) {
    case 'idle':
      return '待機中'
    case 'recalc':
      return '① 再計算中 (rust-ichiban → SQL Server → SQLite + raw NDJSON.gz)…'
    case 'sync':
      return '② R2 同期中 (pending → /raw → R2.put → ack)…'
    case 'done':
      return '✅ 完了'
    case 'error':
      return '❌ エラー'
  }
}

async function runRecalcAndSync() {
  error.value = ''
  result.value = null
  syncResult.value = null
  phase.value = 'recalc'
  try {
    // ① 再計算
    const params = new URLSearchParams()
    if (month.value) params.set('month', month.value)
    if (eigyoshoId.value) params.set('eigyosho_id', eigyoshoId.value)
    const qs = params.toString()
    const url = `/api/uriage/recalc${qs ? '?' + qs : ''}`
    const r = await $fetch<RecalcResponse>(url, { method: 'POST' })
    result.value = r

    // 「computed」が 1 件も無い場合は sync しても pending が空なので skip
    const anyComputed = r.jobs.some((j) => j.status === 'computed')
    if (!anyComputed) {
      phase.value = 'done'
      return
    }

    // ② R2 同期
    phase.value = 'sync'
    const s = await $fetch<SyncResult>('/api/uriage/r2-sync', { method: 'POST' })
    syncResult.value = s
    phase.value = 'done'
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: string }
    error.value = `エラー (${phase.value}): ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${err.data ?? ''}`
    phase.value = 'error'
  }
}

async function runR2SyncOnly() {
  syncOnlyLoading.value = true
  syncOnlyError.value = ''
  syncResult.value = null
  try {
    const res = await $fetch<SyncResult>('/api/uriage/r2-sync', { method: 'POST' })
    syncResult.value = res
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: string }
    syncOnlyError.value = `エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${err.data ?? ''}`
  } finally {
    syncOnlyLoading.value = false
  }
}

function statusClass(status: string): string {
  if (status === 'computed') return 'text-green-700 bg-green-100'
  if (status === 'skipped') return 'text-gray-700 bg-gray-100'
  if (status === 'failed') return 'text-red-700 bg-red-100'
  return ''
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 class="text-xl font-bold">担当者別売上 再計算</h1>
        <AuthToolbar :show-copy-url="false" :show-qr="false" />
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <div class="bg-white rounded-lg shadow p-4 mb-4 space-y-3">
        <div class="text-sm text-gray-600">
          rust-ichiban (<code>/api/uriage/recalc</code>) を叩いて担当者別売上を
          SQLite に再集計し、raw NDJSON.gz を生成 → 続けて R2 に同期します。
          <strong>month/eigyosho_id 未指定</strong> なら CakePHP の
          <code>editable_months</code> 全部 × 全営業所を処理します。
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-xs text-gray-500">month (YYYY-MM、空 = editable_months 全部)</label>
            <input v-model="month" type="month" :disabled="busy" class="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label class="block text-xs text-gray-500">eigyosho_id (空 = 全営業所)</label>
            <input
              v-model="eigyoshoId"
              type="number"
              min="1"
              placeholder="例: 1"
              :disabled="busy"
              class="border rounded px-2 py-1 text-sm w-24"
            />
          </div>
          <button
            :disabled="busy"
            class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
            @click="runRecalcAndSync"
          >
            {{ busy ? '実行中...' : '再計算 → R2 同期' }}
          </button>
        </div>

        <div class="text-sm">
          <span class="text-gray-500">進捗:</span>
          <span
            :class="[
              'ml-2 font-medium',
              phase === 'done' ? 'text-green-700' : '',
              phase === 'error' ? 'text-red-700' : '',
              busy ? 'text-blue-700' : '',
            ]"
          >
            {{ phaseLabel(phase) }}
          </span>
        </div>

        <div v-if="error" class="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm whitespace-pre-wrap">
          {{ error }}
        </div>
      </div>

      <div v-if="result" class="bg-white rounded-lg shadow p-4">
        <div class="text-sm mb-3 text-gray-700">
          <div class="font-semibold text-base mb-1">① 再計算結果</div>
          <div>処理月: <strong>{{ result.months.join(', ') }}</strong> ({{ result.editable_months_count }} 月 editable)</div>
          <div>実行時刻: {{ result.calculated_at }}</div>
        </div>
        <table class="min-w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="px-3 py-2 text-left">month</th>
              <th class="px-3 py-2 text-left">営業所</th>
              <th class="px-3 py-2 text-left">status</th>
              <th class="px-3 py-2 text-right">rows</th>
              <th class="px-3 py-2 text-right">担当者数 (cal/nocal)</th>
              <th class="px-3 py-2 text-left">fingerprint</th>
              <th class="px-3 py-2 text-left">error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(j, i) in result.jobs" :key="i" class="border-b">
              <td class="px-3 py-2">{{ j.month }}</td>
              <td class="px-3 py-2">{{ j.eigyosho_id }}</td>
              <td class="px-3 py-2">
                <span :class="['px-2 py-0.5 rounded text-xs', statusClass(j.status)]">{{ j.status }}</span>
              </td>
              <td class="px-3 py-2 text-right">{{ j.row_count }}</td>
              <td class="px-3 py-2 text-right">{{ j.persisted_count_cal }} / {{ j.persisted_count_nocal }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ j.fingerprint ? j.fingerprint.slice(0, 12) + '…' : '—' }}</td>
              <td class="px-3 py-2 text-red-600 text-xs">{{ j.error ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="syncResult" class="bg-white rounded-lg shadow p-4 mt-4">
        <div class="font-semibold text-base mb-2">② R2 同期結果</div>
        <div class="text-sm">
          <div>
            attempted: <strong>{{ syncResult.attempted }}</strong> /
            uploaded: <strong class="text-green-700">{{ syncResult.uploaded }}</strong> /
            acked: <strong class="text-green-700">{{ syncResult.acked }}</strong>
          </div>
          <div v-if="syncResult.failures.length" class="mt-2">
            <div class="font-semibold text-red-700">失敗:</div>
            <ul class="list-disc pl-5 text-red-700 text-xs">
              <li v-for="(f, i) in syncResult.failures" :key="i">
                {{ f.month }} / eigyosho={{ f.eigyosho_id }} / stage={{ f.stage }}: {{ f.error }}
              </li>
            </ul>
          </div>
          <div v-else class="text-gray-600 text-xs mt-1">
            (全件 OK)
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-4 mt-6 space-y-3">
        <div class="text-sm text-gray-600">
          <strong>R2 同期 (単独)</strong> — 再計算なしで R2 同期だけ叩く時に使う fallback。
          通常は上の「再計算 → R2 同期」ボタンで両方を一度に実行できる。cron は
          月〜土 19:00 JST に safety net として 1 日 1 回動く。
        </div>
        <button
          :disabled="syncOnlyLoading"
          class="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:bg-gray-400"
          @click="runR2SyncOnly"
        >
          {{ syncOnlyLoading ? '同期中...' : 'R2 同期のみ' }}
        </button>
        <div v-if="syncOnlyError" class="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm whitespace-pre-wrap">
          {{ syncOnlyError }}
        </div>
      </div>
    </main>
  </div>
</template>
