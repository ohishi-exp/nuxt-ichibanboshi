<script setup lang="ts">
/**
 * PHP vs Rust 担当者別売上 検証パネル (Phase 1、Refs ohishi-exp/rust-ichibanboshi#41)。
 *
 * shell の `scripts/verify_uriage_diff_php_vs_rust.sh` を nuxt UI 化したもの。
 * 単日 × 営業所 × cal の組み合わせを並列 fetch し、進捗バーと NG 行の diff
 * 詳細を表示する。`/admin/verify` と `/admin/recalc` の両方から埋め込む。
 */

interface PersonAccum {
  金額: number
  傭車金額: number
  件数: number
}

interface VerifyDiff {
  php_only: Record<string, PersonAccum>
  rust_only: Record<string, PersonAccum>
}

interface VerifyResponse {
  office_id: number
  date: string
  cal: boolean
  php_sum: Record<string, PersonAccum>
  rust_sum: Record<string, PersonAccum>
  diff: VerifyDiff | null
  ok: boolean
  row_count: number
  elapsed_ms: number
}

type JobStatus = 'pending' | 'running' | 'ok' | 'ng' | 'err' | 'skipped'

interface VerifyJob {
  key: string
  date: string
  officeId: number
  cal: boolean
  status: JobStatus
  response?: VerifyResponse
  error?: string
}

// ── 入力 state ──
const from = ref('')
const to = ref('')
const officesInput = ref('1,2,3,4,5,6,7,8,9,10,11,12,13,14,15')
const calMode = ref<'both' | 'true' | 'false'>('both')
const concurrency = ref(4)

// ── 実行 state ──
const jobs = ref<VerifyJob[]>([])
const running = ref(false)
const expandedKey = ref<string | null>(null)
const dryMsg = ref('')

const counts = computed(() => {
  const c = {
    total: jobs.value.length,
    done: 0,
    ok: 0,
    ng: 0,
    err: 0,
    skipped: 0,
    pending: 0,
    running: 0,
  }
  for (const j of jobs.value) {
    if (j.status === 'ok') {
      c.ok++
      c.done++
    } else if (j.status === 'ng') {
      c.ng++
      c.done++
    } else if (j.status === 'err') {
      c.err++
      c.done++
    } else if (j.status === 'skipped') {
      c.skipped++
      c.done++
    } else if (j.status === 'pending') {
      c.pending++
    } else if (j.status === 'running') {
      c.running++
    }
  }
  return c
})

const progress = computed(() => {
  if (counts.value.total === 0) return 0
  return Math.round((counts.value.done / counts.value.total) * 100)
})

const ngJobs = computed(() => jobs.value.filter((j) => j.status === 'ng'))
const errJobs = computed(() => jobs.value.filter((j) => j.status === 'err'))

function parseOffices(input: string): number[] {
  return input
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0)
}

function expandDates(fromStr: string, toStr: string): string[] {
  const result: string[] = []
  const start = new Date(fromStr + 'T00:00:00Z')
  const end = new Date(toStr + 'T00:00:00Z')
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return result
  const cur = new Date(start)
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return result
}

function expandJobs(): VerifyJob[] {
  const dates = expandDates(from.value, to.value)
  const offices = parseOffices(officesInput.value)
  const cals: boolean[] =
    calMode.value === 'both' ? [true, false] : calMode.value === 'true' ? [true] : [false]
  const result: VerifyJob[] = []
  for (const date of dates) {
    for (const officeId of offices) {
      for (const cal of cals) {
        result.push({
          key: `${date}/${officeId}/${cal}`,
          date,
          officeId,
          cal,
          status: 'pending',
        })
      }
    }
  }
  return result
}

async function runOne(job: VerifyJob): Promise<void> {
  job.status = 'running'
  try {
    const res = await $fetch<VerifyResponse>(
      `/api/uriage/verify?id=${job.officeId}&date=${job.date}&cal=${job.cal}`,
    )
    job.response = res
    job.status = res.ok ? 'ok' : 'ng'
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    if (err.statusCode === 404) {
      job.status = 'skipped'
      job.error = `(office_id=${job.officeId} は masters に居ない)`
    } else {
      job.status = 'err'
      const dataMsg =
        typeof err.data === 'string' ? err.data : err.data ? JSON.stringify(err.data) : ''
      job.error = `${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${dataMsg}`
    }
  }
}

async function runAll() {
  dryMsg.value = ''
  const expanded = expandJobs()
  if (expanded.length === 0) {
    dryMsg.value = '対象が空です (日付範囲 / 営業所を確認してください)'
    jobs.value = []
    return
  }
  jobs.value = expanded
  running.value = true
  expandedKey.value = null

  const queue = [...jobs.value]
  async function worker() {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) break
      await runOne(job)
    }
  }
  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency.value; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  running.value = false
}

function stop() {
  for (const j of jobs.value) {
    if (j.status === 'pending') j.status = 'skipped'
  }
  running.value = false
}

function toggleDetail(key: string) {
  expandedKey.value = expandedKey.value === key ? null : key
}

function fmtYen(n: number): string {
  return n.toLocaleString('ja-JP') + ' 円'
}

function setDefaultRange() {
  const today = new Date()
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  const mStr = String(m).padStart(2, '0')
  const d = today.getUTCDate()
  const dStr = String(d).padStart(2, '0')
  from.value = `${y}-${mStr}-01`
  to.value = `${y}-${mStr}-${dStr}`
}

if (!from.value || !to.value) setDefaultRange()
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white rounded-lg shadow p-4 space-y-3">
      <div class="text-sm text-gray-600">
        rust-ichiban (<code>/api/uriage/verify</code>) を単日 × 営業所 × cal の組み合わせで
        並列 fetch し、PHP <code>/print-json</code> と Rust <code>compute_person_sum</code>
        を 1 円単位 diff します。NG 行はクリックで詳細を展開できます。
        office_id が masters に居ない場合 (404) は skipped 扱い。
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="block text-xs text-gray-500">from (YYYY-MM-DD)</label>
          <input v-model="from" type="date" :disabled="running" class="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-gray-500">to (YYYY-MM-DD、両端 inclusive)</label>
          <input v-model="to" type="date" :disabled="running" class="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-gray-500">office_id (カンマ区切り、404 は skip)</label>
          <input
            v-model="officesInput"
            type="text"
            :disabled="running"
            class="border rounded px-2 py-1 text-sm w-64 font-mono"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500">cal</label>
          <select v-model="calMode" :disabled="running" class="border rounded px-2 py-1 text-sm">
            <option value="both">両方 (true + false)</option>
            <option value="true">true のみ</option>
            <option value="false">false のみ</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500">並列度</label>
          <input
            v-model.number="concurrency"
            type="number"
            min="1"
            max="16"
            :disabled="running"
            class="border rounded px-2 py-1 text-sm w-16"
          />
        </div>
        <button
          :disabled="running"
          class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
          @click="runAll"
        >
          {{ running ? '実行中...' : '検証開始' }}
        </button>
        <button
          v-if="running"
          class="bg-gray-500 text-white px-3 py-2 rounded text-sm hover:bg-gray-600"
          @click="stop"
        >
          停止 (残 pending を skip)
        </button>
      </div>

      <div v-if="dryMsg" class="text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2 text-sm">
        {{ dryMsg }}
      </div>
    </div>

    <div v-if="counts.total > 0" class="bg-white rounded-lg shadow p-4 space-y-3">
      <div class="text-sm">
        <span class="text-gray-500">進捗:</span>
        <strong class="ml-2">{{ counts.done }} / {{ counts.total }}</strong>
        ({{ progress }} %)
        —
        <span class="ml-2 text-green-700">OK={{ counts.ok }}</span>
        <span class="ml-2 text-red-700">NG={{ counts.ng }}</span>
        <span class="ml-2 text-orange-700">ERR={{ counts.err }}</span>
        <span class="ml-2 text-gray-500">skipped={{ counts.skipped }}</span>
      </div>
      <div class="w-full bg-gray-200 rounded h-2 overflow-hidden">
        <div class="bg-blue-500 h-2 transition-all" :style="{ width: progress + '%' }"></div>
      </div>
    </div>

    <div v-if="ngJobs.length > 0" class="bg-white rounded-lg shadow p-4">
      <div class="font-semibold text-base mb-2 text-red-700">❌ NG ({{ ngJobs.length }})</div>
      <table class="min-w-full text-sm">
        <thead class="bg-red-50 border-b">
          <tr>
            <th class="px-3 py-2 text-left">date</th>
            <th class="px-3 py-2 text-left">office</th>
            <th class="px-3 py-2 text-left">cal</th>
            <th class="px-3 py-2 text-right">rows</th>
            <th class="px-3 py-2 text-right">elapsed</th>
            <th class="px-3 py-2 text-left">detail</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="j in ngJobs" :key="j.key">
            <tr class="border-b">
              <td class="px-3 py-2 font-mono">{{ j.date }}</td>
              <td class="px-3 py-2">{{ j.officeId }}</td>
              <td class="px-3 py-2">{{ j.cal }}</td>
              <td class="px-3 py-2 text-right">{{ j.response?.row_count ?? '-' }}</td>
              <td class="px-3 py-2 text-right text-gray-500">{{ j.response?.elapsed_ms ?? '-' }} ms</td>
              <td class="px-3 py-2">
                <button
                  class="text-blue-600 hover:underline text-xs"
                  @click="toggleDetail(j.key)"
                >
                  {{ expandedKey === j.key ? '▼ 閉じる' : '▶ diff 表示' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedKey === j.key && j.response" class="bg-gray-50 border-b">
              <td colspan="6" class="px-3 py-3">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <div class="text-xs font-semibold text-red-700 mb-1">php_only</div>
                    <table class="min-w-full text-xs border">
                      <thead class="bg-red-50">
                        <tr>
                          <th class="px-2 py-1 text-left">担当</th>
                          <th class="px-2 py-1 text-right">金額</th>
                          <th class="px-2 py-1 text-right">傭車金額</th>
                          <th class="px-2 py-1 text-right">件数</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(v, k) in j.response.diff?.php_only ?? {}"
                          :key="k"
                          class="border-t"
                        >
                          <td class="px-2 py-1">{{ k }}</td>
                          <td class="px-2 py-1 text-right">{{ fmtYen(v.金額) }}</td>
                          <td class="px-2 py-1 text-right">{{ fmtYen(v.傭車金額) }}</td>
                          <td class="px-2 py-1 text-right">{{ v.件数 }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <div class="text-xs font-semibold text-red-700 mb-1">rust_only</div>
                    <table class="min-w-full text-xs border">
                      <thead class="bg-red-50">
                        <tr>
                          <th class="px-2 py-1 text-left">担当</th>
                          <th class="px-2 py-1 text-right">金額</th>
                          <th class="px-2 py-1 text-right">傭車金額</th>
                          <th class="px-2 py-1 text-right">件数</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(v, k) in j.response.diff?.rust_only ?? {}"
                          :key="k"
                          class="border-t"
                        >
                          <td class="px-2 py-1">{{ k }}</td>
                          <td class="px-2 py-1 text-right">{{ fmtYen(v.金額) }}</td>
                          <td class="px-2 py-1 text-right">{{ fmtYen(v.傭車金額) }}</td>
                          <td class="px-2 py-1 text-right">{{ v.件数 }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="errJobs.length > 0" class="bg-white rounded-lg shadow p-4">
      <div class="font-semibold text-base mb-2 text-orange-700">⚠ ERR ({{ errJobs.length }})</div>
      <ul class="text-xs text-orange-700 list-disc pl-5">
        <li v-for="j in errJobs" :key="j.key">
          {{ j.date }} / office={{ j.officeId }} / cal={{ j.cal }}: {{ j.error }}
        </li>
      </ul>
    </div>

    <div v-if="counts.total > 0 && counts.done === counts.total" class="bg-white rounded-lg shadow p-4">
      <div
        :class="counts.ng === 0 && counts.err === 0 ? 'text-green-700' : 'text-red-700'"
        class="font-semibold"
      >
        {{
          counts.ng === 0 && counts.err === 0
            ? '✅ 全件一致 (OK=' + counts.ok + ', skipped=' + counts.skipped + ')'
            : '❌ NG=' + counts.ng + ' / ERR=' + counts.err
        }}
      </div>
    </div>
  </div>
</template>
