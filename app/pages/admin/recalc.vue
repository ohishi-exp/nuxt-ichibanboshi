<script setup lang="ts">
/**
 * 担当者別売上 再計算管理ページ (Refs ohishi-exp/rust-ichibanboshi#37, #38)。
 *
 * 「再計算 → R2 同期」を 1 クリックで chain 実行。各行に日次 drill-down と
 * 削除ボタン、page 底に SQLite 全リセットボタン。
 *
 * 月次集計は rust 側で日次の VIEW に降格済 (#38)、UI も日次が SoT として表示する。
 */
import { AuthToolbar } from '~/composables/useAuth'
import UriagePersonRankingChart from '~/components/UriagePersonRankingChart.vue'
import UriageVerifyPanel from '~/components/UriageVerifyPanel.vue'

interface RecalcJob {
  month: string
  eigyosho_id: number
  status: string
  row_count: number
  daily_count_cal: number
  daily_count_nocal: number
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

interface DailyRow {
  unko_date: string
  month: string
  person_name: string
  eigyosho_id: number
  cal: boolean
  kingaku: number
  yosha_kingaku: number
  kensuu: number
  calculated_at: string
}

interface DailyResponse {
  month: string
  eigyosho_id: number
  cal: boolean
  rows: DailyRow[]
}

type Phase = 'idle' | 'recalc' | 'sync' | 'done' | 'error'

/**
 * ofetch が投げる error の data を文字列化する。
 * rust 側は plain text を body に返すが、Nitro proxy / ofetch を通る過程で
 * `{ statusMessage, data: {...} }` の object 形に wrap されることがあり、
 * `${err.data}` で `[object Object]` になっていた (Refs ohishi-exp/rust-ichibanboshi#39)。
 */
function fmtErrData(d: unknown): string {
  if (d == null) return ''
  if (typeof d === 'string') return d
  try {
    return JSON.stringify(d)
  } catch {
    return String(d)
  }
}

const month = ref('')
const eigyoshoId = ref('')

const phase = ref<Phase>('idle')
const error = ref('')
const result = ref<RecalcResponse | null>(null)
const syncResult = ref<SyncResult | null>(null)

const syncOnlyLoading = ref(false)
const syncOnlyError = ref('')

// 日次 drill-down 用 state — bucket key = `${month}/${eigyosho_id}/${cal}`
const dailyOpen = ref<Record<string, boolean>>({})
const dailyLoading = ref<Record<string, boolean>>({})
const dailyError = ref<Record<string, string>>({})
const dailyData = ref<Record<string, DailyRow[]>>({})

// 削除中 / リセット中
const deleting = ref<Record<string, boolean>>({})
const rebuildLoading = ref(false)
const rebuildMsg = ref('')

// ── 担当者ランキング chart 用 (recalc 後に全 computed bucket の daily を集約) ──
const rankingData = ref<Record<string, number>>({})
const rankingLoading = ref(false)
const rankingMonthLabel = computed(() => result.value?.months.join(', ') ?? '')

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
  dailyOpen.value = {}
  dailyData.value = {}
  rankingData.value = {}
  phase.value = 'recalc'
  try {
    const params = new URLSearchParams()
    if (month.value) params.set('month', month.value)
    if (eigyoshoId.value) params.set('eigyosho_id', eigyoshoId.value)
    const qs = params.toString()
    const url = `/api/uriage/recalc${qs ? '?' + qs : ''}`
    const r = await $fetch<RecalcResponse>(url, { method: 'POST' })
    result.value = r

    const anyComputed = r.jobs.some((j) => j.status === 'computed')
    if (!anyComputed) {
      phase.value = 'done'
      return
    }

    phase.value = 'sync'
    const s = await $fetch<SyncResult>('/api/uriage/r2-sync', { method: 'POST' })
    syncResult.value = s
    phase.value = 'done'
    // 完了後、担当者ランキング chart 用に全 computed bucket の daily を非同期 fetch
    // (失敗しても recalc 全体は成功扱い、グラフは部分集計でも表示)
    void loadRanking()
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    error.value = `エラー (${phase.value}): ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${fmtErrData(err.data)}`
    phase.value = 'error'
  }
}

/**
 * 全 computed bucket から daily を一括 fetch し、担当者名 → SUM(kingaku) に集約する。
 * cal=true をベースに使う (= 別営業所合算、通常の月計と一致する値)。
 * 失敗した bucket は無視 (best effort、グラフは部分集計でも表示する)。
 */
async function loadRanking() {
  if (!result.value) return
  rankingLoading.value = true
  rankingData.value = {}
  try {
    const computedJobs = result.value.jobs.filter((j) => j.status === 'computed')
    const responses = await Promise.all(
      computedJobs.map((j) => {
        const params = new URLSearchParams({
          month: j.month,
          eigyosho_id: String(j.eigyosho_id),
          cal: 'true',
        })
        return $fetch<DailyResponse>(`/api/uriage/daily?${params.toString()}`).catch(() => null)
      }),
    )
    const totals: Record<string, number> = {}
    for (const res of responses) {
      if (!res) continue
      for (const r of res.rows) {
        totals[r.person_name] = (totals[r.person_name] ?? 0) + r.kingaku
      }
    }
    rankingData.value = totals
  } finally {
    rankingLoading.value = false
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
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    syncOnlyError.value = `エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${fmtErrData(err.data)}`
  } finally {
    syncOnlyLoading.value = false
  }
}

function bucketKey(m: string, eid: number, cal: boolean): string {
  return `${m}/${eid}/${cal ? 'true' : 'false'}`
}

async function toggleDaily(j: RecalcJob, cal: boolean) {
  const key = bucketKey(j.month, j.eigyosho_id, cal)
  if (dailyOpen.value[key]) {
    dailyOpen.value[key] = false
    return
  }
  dailyOpen.value[key] = true
  // 取得済みなら再 fetch しない
  if (dailyData.value[key]) return
  dailyLoading.value[key] = true
  dailyError.value[key] = ''
  try {
    const params = new URLSearchParams({
      month: j.month,
      eigyosho_id: String(j.eigyosho_id),
      cal: cal ? 'true' : 'false',
    })
    const res = await $fetch<DailyResponse>(`/api/uriage/daily?${params.toString()}`)
    dailyData.value[key] = res.rows
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    dailyError.value[key] = `${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${fmtErrData(err.data)}`
  } finally {
    dailyLoading.value[key] = false
  }
}

async function deleteBucket(j: RecalcJob) {
  if (!window.confirm(`削除しますか?\n  month=${j.month}\n  eigyosho_id=${j.eigyosho_id}\n\nSQLite から daily / recalc_jobs を消します (raw NDJSON.gz は残ります)。`)) {
    return
  }
  const key = `${j.month}/${j.eigyosho_id}`
  deleting.value[key] = true
  try {
    const params = new URLSearchParams({
      month: j.month,
      eigyosho_id: String(j.eigyosho_id),
    })
    await $fetch(`/api/uriage/admin/delete?${params.toString()}`, { method: 'POST' })
    // result から該当 row を消す (UI 反映)
    if (result.value) {
      result.value.jobs = result.value.jobs.filter(
        (jj) => !(jj.month === j.month && jj.eigyosho_id === j.eigyosho_id),
      )
    }
    // drill-down キャッシュも消す
    delete dailyData.value[bucketKey(j.month, j.eigyosho_id, true)]
    delete dailyData.value[bucketKey(j.month, j.eigyosho_id, false)]
    delete dailyOpen.value[bucketKey(j.month, j.eigyosho_id, true)]
    delete dailyOpen.value[bucketKey(j.month, j.eigyosho_id, false)]
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    window.alert(`削除に失敗: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${fmtErrData(err.data)}`)
  } finally {
    deleting.value[key] = false
  }
}

async function rebuildAll() {
  if (!window.confirm('SQLite の全 uriage table/view を DROP → 再 migrate します。\n集計データは全て消えます。\n\n本当に実行しますか？')) {
    return
  }
  rebuildLoading.value = true
  rebuildMsg.value = ''
  try {
    const res = await $fetch<{ rebuilt_at: string }>('/api/uriage/admin/rebuild', { method: 'POST' })
    rebuildMsg.value = `✅ 再作成完了: ${res.rebuilt_at} — recalc を叩き直してください`
    // UI 反映: 表とキャッシュをクリア
    result.value = null
    syncResult.value = null
    dailyOpen.value = {}
    dailyData.value = {}
    rankingData.value = {}
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    rebuildMsg.value = `❌ エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${fmtErrData(err.data)}`
  } finally {
    rebuildLoading.value = false
  }
}

function statusClass(status: string): string {
  if (status === 'computed') return 'text-green-700 bg-green-100'
  if (status === 'skipped') return 'text-gray-700 bg-gray-100'
  if (status === 'failed') return 'text-red-700 bg-red-100'
  return ''
}

function fmtYen(n: number): string {
  return n.toLocaleString('ja-JP') + ' 円'
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

      <div v-if="result && result.jobs.some((j) => j.status === 'computed')" class="mb-4">
        <div v-if="rankingLoading" class="bg-white rounded-lg shadow p-4 text-sm text-gray-500 text-center">
          担当者ランキング集計中…
        </div>
        <UriagePersonRankingChart
          v-else
          :data="rankingData"
          :month-label="rankingMonthLabel"
        />
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
              <th class="px-3 py-2 text-right">日次 row 数 (cal/nocal)</th>
              <th class="px-3 py-2 text-left">fingerprint</th>
              <th class="px-3 py-2 text-left">操作</th>
              <th class="px-3 py-2 text-left">error</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(j, i) in result.jobs" :key="i">
              <tr class="border-b">
                <td class="px-3 py-2">{{ j.month }}</td>
                <td class="px-3 py-2">{{ j.eigyosho_id }}</td>
                <td class="px-3 py-2">
                  <span :class="['px-2 py-0.5 rounded text-xs', statusClass(j.status)]">{{ j.status }}</span>
                </td>
                <td class="px-3 py-2 text-right">{{ j.row_count }}</td>
                <td class="px-3 py-2 text-right">{{ j.daily_count_cal }} / {{ j.daily_count_nocal }}</td>
                <td class="px-3 py-2 font-mono text-xs">{{ j.fingerprint ? j.fingerprint.slice(0, 12) + '…' : '—' }}</td>
                <td class="px-3 py-2 space-x-1 whitespace-nowrap">
                  <button
                    v-if="j.status === 'computed'"
                    class="px-2 py-0.5 rounded text-xs bg-gray-200 hover:bg-gray-300"
                    @click="toggleDaily(j, true)"
                  >
                    {{ dailyOpen[bucketKey(j.month, j.eigyosho_id, true)] ? '▼' : '▶' }} 日次(cal)
                  </button>
                  <button
                    v-if="j.status === 'computed'"
                    class="px-2 py-0.5 rounded text-xs bg-gray-200 hover:bg-gray-300"
                    @click="toggleDaily(j, false)"
                  >
                    {{ dailyOpen[bucketKey(j.month, j.eigyosho_id, false)] ? '▼' : '▶' }} 日次(nocal)
                  </button>
                  <button
                    :disabled="deleting[`${j.month}/${j.eigyosho_id}`]"
                    class="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                    @click="deleteBucket(j)"
                  >
                    {{ deleting[`${j.month}/${j.eigyosho_id}`] ? '削除中…' : '削除' }}
                  </button>
                </td>
                <td class="px-3 py-2 text-red-600 text-xs">{{ j.error ?? '' }}</td>
              </tr>
              <tr
                v-for="cal in [true, false]"
                v-show="dailyOpen[bucketKey(j.month, j.eigyosho_id, cal)]"
                :key="`${i}-daily-${cal}`"
                class="bg-gray-50 border-b"
              >
                <td colspan="8" class="px-3 py-2">
                  <div class="text-xs font-semibold text-gray-600 mb-1">
                    日次集計 (cal={{ cal }}) — month={{ j.month }} / eigyosho_id={{ j.eigyosho_id }}
                  </div>
                  <div v-if="dailyLoading[bucketKey(j.month, j.eigyosho_id, cal)]" class="text-gray-500 text-xs">
                    読み込み中…
                  </div>
                  <div v-else-if="dailyError[bucketKey(j.month, j.eigyosho_id, cal)]" class="text-red-700 text-xs">
                    {{ dailyError[bucketKey(j.month, j.eigyosho_id, cal)] }}
                  </div>
                  <table
                    v-else-if="dailyData[bucketKey(j.month, j.eigyosho_id, cal)]?.length"
                    class="min-w-full text-xs border"
                  >
                    <thead class="bg-gray-100 border-b">
                      <tr>
                        <th class="px-2 py-1 text-left">日付</th>
                        <th class="px-2 py-1 text-left">担当者</th>
                        <th class="px-2 py-1 text-right">金額</th>
                        <th class="px-2 py-1 text-right">傭車金額</th>
                        <th class="px-2 py-1 text-right">件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(d, di) in dailyData[bucketKey(j.month, j.eigyosho_id, cal)]"
                        :key="di"
                        class="border-b"
                      >
                        <td class="px-2 py-1">{{ d.unko_date }}</td>
                        <td class="px-2 py-1">{{ d.person_name }}</td>
                        <td class="px-2 py-1 text-right">{{ fmtYen(d.kingaku) }}</td>
                        <td class="px-2 py-1 text-right">{{ fmtYen(d.yosha_kingaku) }}</td>
                        <td class="px-2 py-1 text-right">{{ d.kensuu }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-gray-500 text-xs">
                    (日次データなし)
                  </div>
                </td>
              </tr>
            </template>
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

      <div class="mt-6">
        <div class="bg-white rounded-lg shadow p-4 mb-3">
          <div class="font-semibold text-base">🔍 PHP vs Rust 検証</div>
          <div class="text-xs text-gray-500 mt-1">
            recalc が信頼できる前提として、PHP <code>/print-json</code> と Rust の
            <code>compute_person_sum</code> が 1 円単位で一致しているか確認します
            (専用ページ: <NuxtLink to="/admin/verify" class="text-blue-600 hover:underline">/admin/verify</NuxtLink>)。
          </div>
        </div>
        <UriageVerifyPanel />
      </div>

      <div class="bg-white rounded-lg shadow p-4 mt-6 space-y-3 border-2 border-red-200">
        <div class="text-sm text-gray-700">
          <strong class="text-red-700">⚠️ 危険: SQLite 全リセット</strong> —
          全 uriage table/view を DROP → 再 migrate します。集計データは全て消えます。
          schema 不整合や fingerprint の全更新が必要な時の最終手段。raw NDJSON.gz は
          残るので R2 同期は次回 recalc で復活します。
        </div>
        <button
          :disabled="rebuildLoading"
          class="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:bg-gray-400"
          @click="rebuildAll"
        >
          {{ rebuildLoading ? '再作成中…' : 'SQLite 全リセット (rebuild)' }}
        </button>
        <div v-if="rebuildMsg" class="text-sm whitespace-pre-wrap" :class="rebuildMsg.startsWith('❌') ? 'text-red-700' : 'text-green-700'">
          {{ rebuildMsg }}
        </div>
      </div>
    </main>
  </div>
</template>
