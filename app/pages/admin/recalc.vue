<script setup lang="ts">
/**
 * 担当者別売上 再計算管理ページ (Refs ohishi-exp/rust-ichibanboshi#37 = Phase 2 PR-C2/D)。
 *
 * 「再計算」ボタンで POST /api/uriage/recalc を叩き、rust-ichiban が CakePHP から
 * editable_months / masters を pull → 全営業所で集計 + raw NDJSON.gz 出力 + fingerprint
 * 記録までを 1 リクエストで実行する。結果の jobs[] を表で表示する。
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

const month = ref('')
const eigyoshoId = ref('')
const loading = ref(false)
const error = ref('')
const result = ref<RecalcResponse | null>(null)

const syncLoading = ref(false)
const syncError = ref('')
const syncResult = ref<SyncResult | null>(null)

async function runRecalc() {
  loading.value = true
  error.value = ''
  result.value = null
  try {
    const params = new URLSearchParams()
    if (month.value) params.set('month', month.value)
    if (eigyoshoId.value) params.set('eigyosho_id', eigyoshoId.value)
    const qs = params.toString()
    const url = `/api/uriage/recalc${qs ? '?' + qs : ''}`
    const res = await $fetch<RecalcResponse>(url, { method: 'POST' })
    result.value = res
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: string }
    error.value = `エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${err.data ?? ''}`
  } finally {
    loading.value = false
  }
}

function statusClass(status: string): string {
  if (status === 'computed') return 'text-green-700 bg-green-100'
  if (status === 'skipped') return 'text-gray-700 bg-gray-100'
  if (status === 'failed') return 'text-red-700 bg-red-100'
  return ''
}

async function runR2Sync() {
  syncLoading.value = true
  syncError.value = ''
  syncResult.value = null
  try {
    const res = await $fetch<SyncResult>('/api/uriage/r2-sync', { method: 'POST' })
    syncResult.value = res
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: string }
    syncError.value = `エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${err.data ?? ''}`
  } finally {
    syncLoading.value = false
  }
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
          SQLite に再集計し、raw NDJSON.gz を生成します。
          <strong>month/eigyosho_id 未指定</strong> なら CakePHP の
          <code>editable_months</code> 全部 × 全営業所を処理します。
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-xs text-gray-500">month (YYYY-MM、空 = editable_months 全部)</label>
            <input v-model="month" type="month" class="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label class="block text-xs text-gray-500">eigyosho_id (空 = 全営業所)</label>
            <input
              v-model="eigyoshoId"
              type="number"
              min="1"
              placeholder="例: 1"
              class="border rounded px-2 py-1 text-sm w-24"
            />
          </div>
          <button
            :disabled="loading"
            class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
            @click="runRecalc"
          >
            {{ loading ? '実行中...' : '再計算' }}
          </button>
        </div>

        <div v-if="error" class="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm whitespace-pre-wrap">
          {{ error }}
        </div>
      </div>

      <div v-if="result" class="bg-white rounded-lg shadow p-4">
        <div class="text-sm mb-3 text-gray-700">
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

      <div class="bg-white rounded-lg shadow p-4 mt-6 space-y-3">
        <div class="text-sm text-gray-600">
          <strong>R2 同期</strong> — rust-ichiban の <code>/api/uriage/r2/pending</code> を
          polling し、fingerprint 変化があった raw NDJSON.gz を R2 (<code>URIAGE_R2</code>)
          に upload + ack します。通常は cron (15 分おき) が自動実行しますが、再計算直後に
          手動で叩くこともできます。
        </div>
        <button
          :disabled="syncLoading"
          class="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:bg-gray-400"
          @click="runR2Sync"
        >
          {{ syncLoading ? '同期中...' : 'R2 同期' }}
        </button>
        <div v-if="syncError" class="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm whitespace-pre-wrap">
          {{ syncError }}
        </div>
        <div v-if="syncResult" class="text-sm">
          <div>
            attempted: <strong>{{ syncResult.attempted }}</strong> /
            uploaded: <strong>{{ syncResult.uploaded }}</strong> /
            acked: <strong>{{ syncResult.acked }}</strong>
          </div>
          <div v-if="syncResult.failures.length" class="mt-2">
            <div class="font-semibold text-red-700">失敗:</div>
            <ul class="list-disc pl-5 text-red-700 text-xs">
              <li v-for="(f, i) in syncResult.failures" :key="i">
                {{ f.month }} / eigyosho={{ f.eigyosho_id }} / stage={{ f.stage }}: {{ f.error }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
