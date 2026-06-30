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
  /** rust 側で skip (例: bumon 空) になった理由。値が入っていれば検証実施せず skipped 扱い。 */
  skipped_reason?: string
}

type JobStatus = 'pending' | 'running' | 'ok' | 'ng' | 'err' | 'skipped'

interface VerifyJob {
  key: string
  /** 同一 (date, office, cal) を別 run で再検証した時に区別するための単調増加 id */
  runId: number
  date: string
  officeId: number
  cal: boolean
  status: JobStatus
  response?: VerifyResponse
  error?: string
}

// ── 入力 state ──
const monthInput = ref('') // YYYY-MM、変更で from/to を月初〜月末に自動セット
const from = ref('')
const to = ref('')
// 実在 office_id (CakePHP masters の eigyosho id、bumon empty の 13 は除外)。
// 旧 default の `1..15` だと不在 id (2,3,4,14,15) が 404 → skipped に倒れ、
// `13` も bumon empty で no_bumon → skipped となり、4 月で 360/900 件 (40%) が
// skipped になる問題があった (user 報告 2026-06-30)。verify 不要なものを
// expand しないことで skipped を 0 に近づける。新 office 増減時は要更新。
const officesInput = ref('1,5,6,7,8,9,10,11,12')
const calMode = ref<'both' | 'true' | 'false'>('both')
const concurrency = ref(4)

// ── 実行 state ──
const jobs = ref<VerifyJob[]>([])
const running = ref(false)
const expandedKey = ref<string | null>(null)
const dryMsg = ref('')
/** runAll が呼ばれるたびに ++、最新 run の job を絞るのに使う */
const currentRunId = ref(0)

// ── DB 履歴ロード state ──
const historyLoading = ref(false)
const historyMsg = ref('')

// ── R2 同期 (verify-first) state ──
const r2SyncLoading = ref(false)
const r2SyncMsg = ref('')
const r2SyncResult = ref<R2SyncResult | null>(null)
/** R2 同期 orchestrator の現在 phase (UI 進捗バー用) */
const r2SyncPhase = ref<'idle' | 'fetch-pending' | 'verify' | 'sync' | 'done'>('idle')

// ── 状態サマリ state ──
const summaryLoading = ref(false)
const summaryMsg = ref('')
const summaryJobs = ref<RecalcJobRow[]>([])

interface RecalcJobRow {
  month: string
  eigyosho_id: number
  status: 'computed' | 'r2_synced' | 'failed' | string
  fingerprint_before: string | null
  fingerprint_after: string | null
  raw_path: string | null
  created_at: string
  /** 最後に recalc が走った時刻 (fingerprint が変わったかどうかに関わらず更新) */
  computed_at: string | null
  /** fingerprint が実際に変化した時刻 (= data が変わった時刻、rust-ichibanboshi#51 で追加)。
   * `computed_at` だけ進んで `fingerprint_changed_at` が古いままなら
   * 「最近 recalc 試したが data 不変」と読める。 */
  fingerprint_changed_at?: string | null
  r2_synced_at: string | null
  last_error: string | null
  /** verify_jobs に存在する (date, cal) 行数 (LEFT JOIN COALESCE 0、rust-ichibanboshi#49) */
  verified_count?: number
  verified_ok?: number
  verified_ng?: number
}

interface RecalcJobsResponse {
  from: string
  to: string
  count: number
  jobs: RecalcJobRow[]
}

interface R2PendingItem {
  month: string
  eigyosho_id: number
  raw_path: string
  fingerprint_after: string
  computed_at: string
  verified_count: number
  verified_ok: number
  verified_ng: number
  expected_count: number
  ready: boolean
  blocker: 'ng_present' | 'unverified' | null
}

interface R2SyncResult {
  attempted: number
  uploaded: number
  acked: number
  failures: Array<{ month: string; eigyosho_id: number; stage: string; error: string }>
  skipped: Array<{
    month: string
    eigyosho_id: number
    reason: 'unverified' | 'ng_present'
    verified_count: number
    verified_ng: number
    expected_count: number
  }>
}

interface VerifyHistoryRow {
  unko_date: string
  eigyosho_id: number
  cal: number
  month: string
  ok: number
  skipped_reason: string | null
  diff_json: string | null
  row_count: number
  elapsed_ms: number
  ran_at: string
}

interface VerifyHistoryResponse {
  from: string
  to: string
  eigyosho_id: number | null
  count: number
  rows: VerifyHistoryRow[]
}

/** 進捗バー / 完了サマリは現在 run のみカウント (履歴に積んだ過去 run は含めない) */
const currentRunJobs = computed(() =>
  jobs.value.filter((j) => j.runId === currentRunId.value),
)

const counts = computed(() => {
  const c = {
    total: currentRunJobs.value.length,
    done: 0,
    ok: 0,
    ng: 0,
    err: 0,
    skipped: 0,
    pending: 0,
    running: 0,
  }
  for (const j of currentRunJobs.value) {
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

/** NG / ERR は全 run 横断で見られる方が運用上便利なので jobs 全体から拾う */
const ngJobs = computed(() => jobs.value.filter((j) => j.status === 'ng'))
const errJobs = computed(() => jobs.value.filter((j) => j.status === 'err'))

/** 現在 run で最近 ERR になった 1 件 (進捗バー直下に出して即原因把握できるように) */
const latestRunErr = computed(() => {
  const errs = currentRunJobs.value.filter((j) => j.status === 'err')
  return errs.length > 0 ? errs[errs.length - 1] : null
})

interface RunSummary {
  runId: number
  range: string // "from 〜 to" (run の最小日〜最大日)
  total: number
  ok: number
  ng: number
  err: number
  skipped: number
  running: number
}

/** run ごとの集計を新しい順に並べる (履歴一覧表示用)。 */
const runSummaries = computed<RunSummary[]>(() => {
  const byRun = new Map<number, VerifyJob[]>()
  for (const j of jobs.value) {
    if (!byRun.has(j.runId)) byRun.set(j.runId, [])
    byRun.get(j.runId)!.push(j)
  }
  const result: RunSummary[] = []
  for (const [runId, list] of byRun.entries()) {
    let ok = 0
    let ng = 0
    let err = 0
    let skipped = 0
    let running = 0
    let minDate = ''
    let maxDate = ''
    for (const j of list) {
      if (j.status === 'ok') ok++
      else if (j.status === 'ng') ng++
      else if (j.status === 'err') err++
      else if (j.status === 'skipped') skipped++
      else if (j.status === 'running' || j.status === 'pending') running++
      if (!minDate || j.date < minDate) minDate = j.date
      if (!maxDate || j.date > maxDate) maxDate = j.date
    }
    const range = minDate === maxDate ? minDate : `${minDate} 〜 ${maxDate}`
    result.push({ runId, range, total: list.length, ok, ng, err, skipped, running })
  }
  return result.sort((a, b) => b.runId - a.runId)
})

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

function expandJobs(runId: number): VerifyJob[] {
  const dates = expandDates(from.value, to.value)
  const offices = parseOffices(officesInput.value)
  const cals: boolean[] =
    calMode.value === 'both' ? [true, false] : calMode.value === 'true' ? [true] : [false]
  const result: VerifyJob[] = []
  for (const date of dates) {
    for (const officeId of offices) {
      for (const cal of cals) {
        result.push({
          key: `${date}/${officeId}/${cal}#run${runId}`,
          runId,
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

/** 1 fetch あたりのタイムアウト (ms)。長すぎると stuck 検出が遅れ、短すぎると
 * CakePHP 経由の遅い日付で空振りする。30 秒に。 */
const FETCH_TIMEOUT_MS = 30_000

async function runOne(job: VerifyJob): Promise<void> {
  job.status = 'running'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await $fetch<VerifyResponse>(
      `/api/uriage/verify?id=${job.officeId}&date=${job.date}&cal=${job.cal}`,
      { signal: controller.signal },
    )
    job.response = res
    if (res.skipped_reason) {
      // rust 側で skip された (例: bumon 空) → skipped 扱い、error 文言は info
      job.status = 'skipped'
      job.error = `(${res.skipped_reason}: office_id=${job.officeId} は検証対象外)`
    } else {
      job.status = res.ok ? 'ok' : 'ng'
    }
  } catch (e: unknown) {
    const err = e as {
      statusCode?: number
      statusMessage?: string
      data?: unknown
      name?: string
    }
    if (err.statusCode === 404) {
      job.status = 'skipped'
      job.error = `(office_id=${job.officeId} は masters に居ない)`
    } else if (err.name === 'AbortError') {
      job.status = 'err'
      job.error = `timeout ${FETCH_TIMEOUT_MS / 1000}s (rust 側が応答しない可能性)`
    } else {
      job.status = 'err'
      const dataMsg =
        typeof err.data === 'string' ? err.data : err.data ? JSON.stringify(err.data) : ''
      job.error = `${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${dataMsg}`
    }
  } finally {
    clearTimeout(timer)
  }
}

async function runAll() {
  dryMsg.value = ''
  const nextRunId = currentRunId.value + 1
  const expanded = expandJobs(nextRunId)
  if (expanded.length === 0) {
    dryMsg.value = '対象が空です (日付範囲 / 営業所を確認してください)'
    return
  }
  currentRunId.value = nextRunId
  // 過去 run は履歴として残し、新しい run を末尾に append
  const startIdx = jobs.value.length
  jobs.value = [...jobs.value, ...expanded]
  running.value = true
  expandedKey.value = null

  // ★ workers が mutate する対象は **jobs.value[idx] 経由の proxied item** に
  //   する必要がある。plain object (expanded[i]) を直接 mutate すると Vue 3
  //   の reactive proxy を通らないため、`job.status = 'ok'` をしても画面の
  //   進捗カウントが更新されず「0/930 のまま動かない」状態になる
  //   (Vue 3 reactivity の罠、user 報告 2026-06-30)。
  const indices: number[] = []
  for (let i = 0; i < expanded.length; i++) indices.push(startIdx + i)

  async function worker() {
    while (indices.length > 0) {
      const idx = indices.shift()
      if (idx === undefined) break
      const job = jobs.value[idx]
      if (!job) break
      await runOne(job)
    }
  }
  // concurrency が NaN / 0 / 負だと worker が 1 つも起動せず progress が
  // 永遠に動かないので最低 1 にフロアする。上限は 16 (Workers 同時接続 6 を
  // 大きく上回ると無駄)。
  const conc = Math.min(16, Math.max(1, Math.floor(concurrency.value) || 1))
  const workers: Promise<void>[] = []
  for (let i = 0; i < conc; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  running.value = false
}

function stop() {
  // 現在 run の pending のみ skip (過去 run はもう触らない)。proxied item を
  // mutate するため jobs.value 経由でアクセスする (currentRunJobs computed の
  // フィルタ結果も proxied のはずだが、念のため明示的に jobs.value から)。
  for (let i = 0; i < jobs.value.length; i++) {
    const j = jobs.value[i]
    if (j && j.runId === currentRunId.value && j.status === 'pending') {
      j.status = 'skipped'
    }
  }
  running.value = false
}

function clearHistory() {
  if (running.value) return
  jobs.value = []
  currentRunId.value = 0
  expandedKey.value = null
}

/**
 * DB (verify_jobs) から履歴を取り出して jobs.value に流し込む。
 * 同じ key の job があれば上書き (= 最新の DB 値を採用)。
 */
async function loadDbHistory() {
  if (running.value) return
  historyMsg.value = ''
  historyLoading.value = true
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value })
    const offices = parseOffices(officesInput.value)
    // eigyosho_id 単指定はサーバ側仕様 → 全 office 取得するなら指定しない
    // 入力欄が 1 つだけなら絞る (UI 利便性)、それ以外は範囲取得
    if (offices.length === 1) params.set('eigyosho_id', String(offices[0]))
    const res = await $fetch<VerifyHistoryResponse>(
      `/api/uriage/verify-history?${params.toString()}`,
    )
    // 既存 jobs と merge: 同じ key があれば上書き
    const existing = new Map<string, VerifyJob>()
    for (const j of jobs.value) existing.set(j.key, j)
    let runId = currentRunId.value
    runId++ // DB ロード分は別 runId に振る
    currentRunId.value = runId
    for (const r of res.rows) {
      const calBool = r.cal === 1
      const key = `${r.unko_date}/${r.eigyosho_id}/${calBool}#db-run${runId}`
      const ok = r.ok === 1
      let status: JobStatus = 'ok'
      if (r.skipped_reason) status = 'skipped'
      else if (!ok) status = 'ng'
      // 簡易 response (diff_json を parse)
      let diff: VerifyDiff | null = null
      if (r.diff_json) {
        try {
          diff = JSON.parse(r.diff_json) as VerifyDiff
        } catch {
          diff = null
        }
      }
      const job: VerifyJob = {
        key,
        runId,
        date: r.unko_date,
        officeId: r.eigyosho_id,
        cal: calBool,
        status,
        response: {
          office_id: r.eigyosho_id,
          date: r.unko_date,
          cal: calBool,
          php_sum: {},
          rust_sum: {},
          diff,
          ok,
          row_count: r.row_count,
          elapsed_ms: r.elapsed_ms,
          skipped_reason: r.skipped_reason ?? undefined,
        },
        error: r.skipped_reason ? `(${r.skipped_reason}: ${r.ran_at})` : undefined,
      }
      existing.set(key, job)
    }
    jobs.value = Array.from(existing.values())
    historyMsg.value = `✅ DB から ${res.count} 件の履歴をロードしました (run #${runId})`
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string }
    historyMsg.value = `❌ 履歴ロード失敗: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    historyLoading.value = false
  }
}

/**
 * R2 同期 (verify-first):
 * 1. /api/uriage/r2/pending を取得
 * 2. ready=true の bucket は即 sync 対象、blocker=unverified は browser-side で
 *    iterate /verify、blocker=ng_present は skip
 * 3. verify 完了後 /api/uriage/r2-sync を 1 回叩いて ready bucket をまとめて sync
 *
 * CF Workers の subrequest 上限 (1 invocation = 50 限) を避けるため、verify は
 * **browser-side で 1 call = 1 worker invocation** に分散する。
 */
async function runR2SyncVerifyFirst() {
  if (running.value || r2SyncLoading.value) return
  r2SyncLoading.value = true
  r2SyncMsg.value = ''
  r2SyncResult.value = null
  r2SyncPhase.value = 'fetch-pending'
  try {
    // 1. pending list (user 2026-06-30: 「R2 同期も recalc も期間に従う」)
    // UI の from/to から YYYY-MM を抽出して rust の r2_pending を期間 filter する。
    // 状態サマリは全期間だが、R2 同期 / verify は UI 期間に従う設計。
    const fromMonth = from.value.slice(0, 7)
    const toMonth = to.value.slice(0, 7)
    const pendingUrl =
      fromMonth && toMonth
        ? `/api/uriage/r2-pending?from=${fromMonth}&to=${toMonth}`
        : '/api/uriage/r2-pending'
    r2SyncMsg.value = `[1/3] pending list 取得中… (${fromMonth} 〜 ${toMonth})`
    const pendingRes = await $fetch<{ count: number; items: R2PendingItem[] }>(pendingUrl)
    const unverified = pendingRes.items.filter((i) => i.blocker === 'unverified')
    const ngPresent = pendingRes.items.filter((i) => i.blocker === 'ng_present')
    const readyCount = pendingRes.items.filter((i) => i.ready).length
    if (pendingRes.count === 0) {
      r2SyncMsg.value =
        '[完了] R2 同期対象なし (recalc 未実行 or 既に同期済み)。先に下のサマリで状態を確認、未実行なら /admin/recalc の「再計算 → R2 同期」を実行してください。'
      r2SyncPhase.value = 'done'
      // 状態サマリも自動 reload (どのバケットが既同期かが見える)
      void loadStatusSummary()
      return
    }
    r2SyncMsg.value =
      `[1/3] pending: ${pendingRes.count} bucket (ready=${readyCount}, unverified=${unverified.length}, ng_present=${ngPresent.length})`

    // 2. unverified bucket を verify (browser-side iterate)
    if (unverified.length > 0) {
      r2SyncPhase.value = 'verify'
      r2SyncMsg.value += `\n[2/3] unverified ${unverified.length} bucket を verify 中…`
      const nextRunId = currentRunId.value + 1
      currentRunId.value = nextRunId
      const verifyJobs: VerifyJob[] = []
      for (const item of unverified) {
        const days = expandDates(`${item.month}-01`, lastDayOf(item.month))
        for (const day of days) {
          for (const cal of [true, false]) {
            verifyJobs.push({
              key: `${day}/${item.eigyosho_id}/${cal}#sync-run${nextRunId}`,
              runId: nextRunId,
              date: day,
              officeId: item.eigyosho_id,
              cal,
              status: 'pending',
            })
          }
        }
      }
      jobs.value = [...jobs.value, ...verifyJobs]
      // 既存 jobs.value 経由で worker が proxied item を mutate するように
      const startIdx = jobs.value.length - verifyJobs.length
      const indices: number[] = []
      for (let i = 0; i < verifyJobs.length; i++) indices.push(startIdx + i)
      const conc = Math.min(16, Math.max(1, Math.floor(concurrency.value) || 1))
      async function worker() {
        while (indices.length > 0) {
          const idx = indices.shift()
          if (idx === undefined) break
          const job = jobs.value[idx]
          if (!job) break
          await runOne(job)
        }
      }
      const workers: Promise<void>[] = []
      for (let i = 0; i < conc; i++) workers.push(worker())
      await Promise.all(workers)
      r2SyncMsg.value += ` → verify 完了 (${verifyJobs.length} cells、進捗バー参照)`
    }

    // 3. ng_present は skip 警告だけ
    if (ngPresent.length > 0) {
      r2SyncMsg.value += `\n[2/3] NG bucket は skip (${ngPresent.length}、要 fix)`
    }

    // 4. ready bucket をまとめて sync
    r2SyncPhase.value = 'sync'
    r2SyncMsg.value += `\n[3/3] R2 sync 実行中…`
    const syncRes = await $fetch<R2SyncResult>('/api/uriage/r2-sync', { method: 'POST' })
    r2SyncResult.value = syncRes
    r2SyncPhase.value = 'done'
    r2SyncMsg.value += `\n[完了] uploaded=${syncRes.uploaded}/${syncRes.attempted}, acked=${syncRes.acked}, failures=${syncRes.failures.length}, skipped=${syncRes.skipped.length}`
    // 状態サマリも reload (sync 後の状態を反映)
    void loadStatusSummary()
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    const dataMsg =
      typeof err.data === 'string' ? err.data : err.data ? JSON.stringify(err.data) : ''
    r2SyncMsg.value = `❌ R2 同期失敗 (phase=${r2SyncPhase.value}): ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${dataMsg}`
    r2SyncPhase.value = 'idle'
  } finally {
    r2SyncLoading.value = false
  }
}

/**
 * recalc_jobs を読んで状態サマリを表示する (user 要望: 状態サマリは全期間表示・降順)。
 *
 * 引数なしで叩くと **全期間 (from/to なし)** を取得し、rust 側で
 * `ORDER BY month DESC, eigyosho_id ASC` で返ってくる。
 * `applyFilter=true` を渡すと UI の from/to を query に乗せて期間 filter する。
 *
 * - 行が無い → recalc 未実行 (orange バナー)
 * - status=computed → 🟡 計算済、R2 同期待ち (r2_synced_at の有無は表示に使わない)
 * - status=r2_synced → ✅ R2 同期済
 * - status=failed → ❌ recalc 失敗 (last_error 付き)
 */
async function loadStatusSummary(applyFilter: boolean = false) {
  summaryMsg.value = ''
  summaryLoading.value = true
  try {
    let url = '/api/uriage/recalc-jobs'
    let label = '全期間'
    if (applyFilter) {
      const fromMonth = from.value.slice(0, 7)
      const toMonth = to.value.slice(0, 7)
      if (fromMonth && toMonth) {
        const params = new URLSearchParams({ from: fromMonth, to: toMonth })
        url = `/api/uriage/recalc-jobs?${params.toString()}`
        label = `${fromMonth} 〜 ${toMonth}`
      }
    }
    const res = await $fetch<RecalcJobsResponse>(url)
    summaryJobs.value = res.jobs
    summaryMsg.value = `${label}: recalc_jobs ${res.count} 件`
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string }
    summaryMsg.value = `❌ サマリ取得失敗: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
    summaryJobs.value = []
  } finally {
    summaryLoading.value = false
  }
}

/**
 * recalc_job status → 表示用ラベル + 色。
 *
 * `r2_synced_at` の有無で UI を分けない (user 2026-06-30: status='computed' で
 * r2_synced_at が非 null になる古い data が混じって "computed" だけ表示される
 * バグがあった。本質的に status='computed' = R2 未同期、で統一する)。
 */
function jobStatusLabel(j: RecalcJobRow): { text: string; cls: string } {
  if (j.status === 'r2_synced')
    return { text: '✅ R2 同期済', cls: 'text-green-700' }
  if (j.status === 'computed')
    return { text: '🟡 計算済、R2 同期待ち', cls: 'text-yellow-700' }
  if (j.status === 'failed')
    return { text: `❌ 失敗: ${j.last_error ?? '?'}`, cls: 'text-red-700' }
  return { text: j.status, cls: 'text-gray-600' }
}

/** YYYY-MM の日数 (UTC で月末日を取る) */
function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return 0
  return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10), 0)).getUTCDate()
}

/**
 * verify_jobs 集計 (verified_count / ok / ng) → 表示用ラベル + 色。
 *
 * expected_count = 月の日数 × 2 cal (cal=false, cal=true)。
 * - verified_ng > 0          → ❌ NG あり (要 fix)
 * - verified_count = 0       → — 未検証 (verify 走らせる必要)
 * - verified_count >= expect → ✅ 全件検証済
 * - 0 < count < expect       → ⚠ 部分のみ (途中まで verify)
 */
function verifyLabel(j: RecalcJobRow): { text: string; cls: string } {
  const count = j.verified_count ?? 0
  const ng = j.verified_ng ?? 0
  const expected = daysInMonth(j.month) * 2
  if (ng > 0) return { text: `❌ NG ${ng} 件`, cls: 'text-red-700' }
  if (count === 0) return { text: '— 未検証', cls: 'text-gray-500' }
  if (expected > 0 && count >= expected)
    return { text: `✅ 全件検証済 (${count})`, cls: 'text-green-700' }
  return {
    text: `⚠ 部分のみ (${count}${expected > 0 ? `/${expected}` : ''})`,
    cls: 'text-orange-700',
  }
}

/** YYYY-MM → "YYYY-MM-DD" (月末日) */
function lastDayOf(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return `${month}-01`
  const y = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  const last = new Date(Date.UTC(y, mm, 0))
  return `${y}-${String(mm).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
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
  // user 要望 (2026-06-30): 「2026/1 から実行できるように」
  // 検証 / R2 同期の起点を 2026-01-01 にして、to を今日まで。
  // 月選択 input は当月をデフォルト (個別月だけ動かしたい時にすぐ切り替えられる)。
  from.value = '2026-01-01'
  to.value = `${y}-${mStr}-${dStr}`
  monthInput.value = `${y}-${mStr}`
}

/**
 * 月セレクタ (`<input type="month">`) の値が変わったら from/to を月初〜月末
 * に自動セット。当月は「今日まで」で打ち止め (未到来の日は無意味)。
 */
function applyMonth(ym: string) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return
  const [yStr, mStr] = ym.split('-')
  const y = parseInt(yStr, 10)
  const m = parseInt(mStr, 10)
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return
  // 月末 = 翌月 0 日
  const last = new Date(Date.UTC(y, m, 0))
  const lastDay = last.getUTCDate()
  const lastStr = `${y}-${mStr}-${String(lastDay).padStart(2, '0')}`
  // 当月なら今日で打ち止め
  const today = new Date()
  const ty = today.getUTCFullYear()
  const tm = today.getUTCMonth() + 1
  const td = today.getUTCDate()
  const isCurrentMonth = y === ty && m === tm
  from.value = `${y}-${mStr}-01`
  to.value = isCurrentMonth
    ? `${y}-${mStr}-${String(td).padStart(2, '0')}`
    : lastStr
}

watch(monthInput, (v) => {
  if (v) applyMonth(v)
})

if (!from.value || !to.value) setDefaultRange()

/**
 * 「未検証 bucket だけ verify」ボタン用 orchestrator。
 *
 * R2 同期 (verify-first) と違い、**R2 sync 段階は実行しない**。
 * UI 期間 (from/to) の r2_pending で blocker='unverified' な bucket を集めて
 * (date, office, cal) に展開し、browser worker pool で並列 verify する。
 *
 * (user 2026-06-30: 「未実施分を検証とかできるようにuiいれて 2026/1 から実行できるように」)
 */
async function runVerifyUnverifiedOnly() {
  if (running.value || r2SyncLoading.value) return
  r2SyncLoading.value = true
  r2SyncMsg.value = ''
  r2SyncResult.value = null
  r2SyncPhase.value = 'fetch-pending'
  try {
    const fromMonth = from.value.slice(0, 7)
    const toMonth = to.value.slice(0, 7)
    const pendingUrl =
      fromMonth && toMonth
        ? `/api/uriage/r2-pending?from=${fromMonth}&to=${toMonth}`
        : '/api/uriage/r2-pending'
    r2SyncMsg.value = `[1/2] pending list 取得中… (${fromMonth} 〜 ${toMonth})`
    const pendingRes = await $fetch<{ count: number; items: R2PendingItem[] }>(pendingUrl)
    const unverified = pendingRes.items.filter((i) => i.blocker === 'unverified')
    if (unverified.length === 0) {
      r2SyncMsg.value = `[完了] 未検証 bucket なし (期間 ${fromMonth} 〜 ${toMonth})。状態サマリ再 load します…`
      r2SyncPhase.value = 'done'
      void loadStatusSummary()
      return
    }
    r2SyncMsg.value = `[1/2] 未検証 ${unverified.length} bucket 検出 → verify 開始`

    r2SyncPhase.value = 'verify'
    const nextRunId = currentRunId.value + 1
    currentRunId.value = nextRunId
    const verifyJobs: VerifyJob[] = []
    for (const item of unverified) {
      const days = expandDates(`${item.month}-01`, lastDayOf(item.month))
      for (const day of days) {
        for (const cal of [true, false]) {
          verifyJobs.push({
            key: `${day}/${item.eigyosho_id}/${cal}#verify-only-run${nextRunId}`,
            runId: nextRunId,
            date: day,
            officeId: item.eigyosho_id,
            cal,
            status: 'pending',
          })
        }
      }
    }
    jobs.value = [...jobs.value, ...verifyJobs]
    const startIdx = jobs.value.length - verifyJobs.length
    const indices: number[] = []
    for (let i = 0; i < verifyJobs.length; i++) indices.push(startIdx + i)
    const conc = Math.min(16, Math.max(1, Math.floor(concurrency.value) || 1))
    async function worker() {
      while (indices.length > 0) {
        const idx = indices.shift()
        if (idx === undefined) break
        const job = jobs.value[idx]
        if (!job) break
        await runOne(job)
      }
    }
    const workers: Promise<void>[] = []
    for (let i = 0; i < conc; i++) workers.push(worker())
    await Promise.all(workers)
    r2SyncPhase.value = 'done'
    r2SyncMsg.value += `\n[2/2] verify 完了 (${verifyJobs.length} cells)。状態サマリ再 load します…`
    void loadStatusSummary()
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; data?: unknown }
    const dataMsg =
      typeof err.data === 'string' ? err.data : err.data ? JSON.stringify(err.data) : ''
    r2SyncMsg.value = `❌ verify 失敗: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)} ${dataMsg}`
    r2SyncPhase.value = 'idle'
  } finally {
    r2SyncLoading.value = false
  }
}

// mount 時に状態サマリ全期間 を auto-load (user 2026-06-30: 「毎回選択するの面倒」)
onMounted(() => {
  void loadStatusSummary()
})

// ──────────────────────────────────────────────────────────────────
// 行単位アクション (= 状態サマリ表の per-row ボタン、user 2026-06-30:
// 「このへんどうしらいいの? → 各行にインラインアクション」)
// ──────────────────────────────────────────────────────────────────

/**
 * verify ボタンを出して良い行か。
 * - failed (= bumon empty 等) はそもそも verify 対象 0 なので出さない
 * - 既に ✅ 全件検証済 (verified_count >= expected) も追加 verify 不要なので出さない
 */
function canVerifyRow(j: RecalcJobRow): boolean {
  if (j.status === 'failed') return false
  const count = j.verified_count ?? 0
  const expected = daysInMonth(j.month) * 2
  if (expected > 0 && count >= expected && (j.verified_ng ?? 0) === 0) return false
  return true
}

/**
 * R2 同期ボタンを出して良い行か。
 * - r2_synced_at が立っている (= ✅ R2 同期済) なら不要
 * - failed は対象外
 * - NG ありは r2_pending view で gate されて sync skip されるが、UI ボタンは
 *   出して動かしても問題ない (rust 側で skip 扱い)
 */
function canSyncRow(j: RecalcJobRow): boolean {
  if (j.status === 'failed') return false
  if (j.status === 'r2_synced') return false
  return true
}

/**
 * 1 行分 verify を実行 (= (j.month, j.eigyosho_id) の全 (date, cal) を verify)。
 * 完了後に状態サマリを reload。
 */
async function runVerifyForRow(j: RecalcJobRow) {
  if (running.value || r2SyncLoading.value) return
  r2SyncLoading.value = true
  r2SyncMsg.value = `🔍 ${j.month} / office=${j.eigyosho_id} verify 中…`
  r2SyncResult.value = null
  r2SyncPhase.value = 'verify'
  try {
    const days = expandDates(`${j.month}-01`, lastDayOf(j.month))
    const nextRunId = currentRunId.value + 1
    currentRunId.value = nextRunId
    const verifyJobs: VerifyJob[] = []
    for (const day of days) {
      for (const cal of [true, false]) {
        verifyJobs.push({
          key: `${day}/${j.eigyosho_id}/${cal}#row-verify-run${nextRunId}`,
          runId: nextRunId,
          date: day,
          officeId: j.eigyosho_id,
          cal,
          status: 'pending',
        })
      }
    }
    jobs.value = [...jobs.value, ...verifyJobs]
    const startIdx = jobs.value.length - verifyJobs.length
    const indices: number[] = []
    for (let i = 0; i < verifyJobs.length; i++) indices.push(startIdx + i)
    const conc = Math.min(16, Math.max(1, Math.floor(concurrency.value) || 1))
    async function worker() {
      while (indices.length > 0) {
        const idx = indices.shift()
        if (idx === undefined) break
        const job = jobs.value[idx]
        if (!job) break
        await runOne(job)
      }
    }
    const workers: Promise<void>[] = []
    for (let i = 0; i < conc; i++) workers.push(worker())
    await Promise.all(workers)
    r2SyncPhase.value = 'done'
    r2SyncMsg.value = `✅ ${j.month} / office=${j.eigyosho_id} verify 完了 (${verifyJobs.length} cells)。サマリ再 load…`
    void loadStatusSummary()
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string }
    r2SyncMsg.value = `❌ row verify 失敗: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
    r2SyncPhase.value = 'idle'
  } finally {
    r2SyncLoading.value = false
  }
}

/**
 * 1 行分 R2 同期を実行。UI from/to を当該 month に一時切り替え、既存 R2 同期
 * orchestrator (verify-first) を再利用する。
 *
 * NOTE: rust の `/api/uriage/r2-sync` は (month, eigyosho_id) 単位の filter を
 * 受けない (= ready 全件 sync する) ので、from/to を当該 month に切ると **同月の
 * 他 office も pending なら一緒に sync される**。これは多くの場合むしろ望ましい
 * 挙動 (= 月単位で揃って R2 へ上がる) なので明示的に許容する。
 */
async function runR2SyncForRow(j: RecalcJobRow) {
  if (running.value || r2SyncLoading.value) return
  const savedFrom = from.value
  const savedTo = to.value
  from.value = `${j.month}-01`
  to.value = lastDayOf(j.month)
  try {
    await runR2SyncVerifyFirst()
  } finally {
    from.value = savedFrom
    to.value = savedTo
  }
}

/**
 * 「🚀 2026-01〜今日 R2 一括同期」ボタン用。
 *
 * user 要望 (2026-06-30): 「2026-01 から同期できるように inline つくってね」
 *
 * UI 期間 (from/to) を一時的に `2026-01-01 〜 今日` に切り替えて
 * `runR2SyncVerifyFirst` を呼ぶ。完了後 from/to を復元する。
 *
 * 状態サマリ panel に常駐させているので、from/to を手で動かさなくても 1 クリックで
 * 「2026 年に入って以降の全 pending」を verify-first で R2 同期できる。
 */
async function runR2SyncFromYear2026() {
  if (running.value || r2SyncLoading.value) return
  const today = new Date()
  const y = today.getUTCFullYear()
  const mStr = String(today.getUTCMonth() + 1).padStart(2, '0')
  const dStr = String(today.getUTCDate()).padStart(2, '0')
  const savedFrom = from.value
  const savedTo = to.value
  from.value = '2026-01-01'
  to.value = `${y}-${mStr}-${dStr}`
  try {
    await runR2SyncVerifyFirst()
  } finally {
    from.value = savedFrom
    to.value = savedTo
  }
}
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
          <label class="block text-xs text-gray-500">月で選ぶ (YYYY-MM)</label>
          <input
            v-model="monthInput"
            type="month"
            :disabled="running"
            class="border rounded px-2 py-1 text-sm"
            title="変更で from/to を月初〜月末に自動セット (当月は今日まで)"
          />
        </div>
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
        <button
          :disabled="running || historyLoading"
          class="bg-amber-600 text-white px-3 py-2 rounded text-sm hover:bg-amber-700 disabled:bg-gray-400"
          @click="loadDbHistory"
          title="verify_jobs (rust SQLite) から検証履歴を取得して表に反映"
        >
          {{ historyLoading ? 'ロード中…' : '📜 DB 履歴をロード' }}
        </button>
        <button
          :disabled="running || r2SyncLoading"
          class="bg-purple-600 text-white px-3 py-2 rounded text-sm hover:bg-purple-700 disabled:bg-gray-400"
          @click="runR2SyncVerifyFirst"
          title="未検証 bucket を verify してから R2 sync (verify-first orchestrator)"
        >
          {{ r2SyncLoading ? `R2 同期中… (${r2SyncPhase})` : '🚀 R2 同期 (verify-first)' }}
        </button>
        <button
          :disabled="summaryLoading"
          class="bg-teal-600 text-white px-3 py-2 rounded text-sm hover:bg-teal-700 disabled:bg-gray-400"
          @click="loadStatusSummary(true)"
          title="UI 期間 (from/to) で recalc_jobs を絞って表示 (default は全期間)"
        >
          {{ summaryLoading ? 'ロード中…' : '📊 期間でサマリを絞る' }}
        </button>
      </div>

      <div v-if="dryMsg" class="text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2 text-sm">
        {{ dryMsg }}
      </div>
      <div v-if="historyMsg" class="text-sm whitespace-pre-wrap" :class="historyMsg.startsWith('❌') ? 'text-red-700' : 'text-green-700'">
        {{ historyMsg }}
      </div>
      <div v-if="r2SyncMsg" class="text-sm whitespace-pre-wrap text-purple-800 bg-purple-50 border border-purple-200 rounded px-3 py-2 space-y-2">
        <div>🚀 {{ r2SyncMsg }}</div>
        <!-- 行単位 verify / 一括 verify 時の inline 進捗 (user 2026-06-30 「進捗わからない」)。
             下部の進捗 panel が summary table の下にあって視認できないため、message
             エリアにも mini progress bar を出して即座に分かるように。 -->
        <div v-if="r2SyncLoading && counts.total > 0" class="text-xs text-purple-900">
          <div class="mb-1">
            進捗: <strong>{{ counts.done }} / {{ counts.total }}</strong>
            ({{ progress }} %) —
            <span class="text-green-700">OK={{ counts.ok }}</span>
            <span class="ml-1 text-red-700">NG={{ counts.ng }}</span>
            <span class="ml-1 text-orange-700">ERR={{ counts.err }}</span>
            <span class="ml-1 text-gray-600">skipped={{ counts.skipped }}</span>
          </div>
          <div class="w-full bg-purple-200 rounded h-1.5 overflow-hidden">
            <div class="bg-purple-600 h-1.5 transition-all" :style="{ width: progress + '%' }"></div>
          </div>
        </div>
      </div>
      <div v-if="r2SyncResult" class="text-xs text-gray-700">
        attempted={{ r2SyncResult.attempted }} uploaded={{ r2SyncResult.uploaded }}
        acked={{ r2SyncResult.acked }} failures={{ r2SyncResult.failures.length }}
        skipped={{ r2SyncResult.skipped.length }}
        <ul v-if="r2SyncResult.skipped.length > 0" class="list-disc pl-5 mt-1 text-gray-600">
          <li v-for="(s, i) in r2SyncResult.skipped" :key="i">
            {{ s.month }} / office={{ s.eigyosho_id }} → {{ s.reason }}
            (verified={{ s.verified_count }}/{{ s.expected_count }}, ng={{ s.verified_ng }})
          </li>
        </ul>
      </div>
    </div>

    <div v-if="summaryMsg || summaryJobs.length > 0" class="bg-white rounded-lg shadow p-4">
      <div class="text-sm font-semibold mb-2 flex items-center justify-between gap-2 flex-wrap">
        <span>📊 recalc / R2 同期 状態サマリ (全期間・降順)</span>
        <div class="flex items-center gap-3">
          <button
            :disabled="running || r2SyncLoading"
            class="text-xs text-purple-700 border border-purple-300 hover:bg-purple-50 px-2 py-1 rounded font-normal disabled:opacity-50"
            title="from を 2026-01-01 / to を今日に切り替えて、R2 同期 (verify-first) を実行"
            @click="runR2SyncFromYear2026"
          >
            {{ r2SyncLoading ? '実行中…' : '🚀 2026-01〜今日 R2 一括同期' }}
          </button>
          <button
            :disabled="running || r2SyncLoading"
            class="text-xs text-orange-700 border border-orange-300 hover:bg-orange-50 px-2 py-1 rounded font-normal disabled:opacity-50"
            title="UI 期間 (from/to) で blocker='unverified' な bucket を verify (R2 同期はしない)"
            @click="runVerifyUnverifiedOnly"
          >
            {{ r2SyncLoading ? '実行中…' : '🔍 未検証 bucket だけ verify' }}
          </button>
          <button
            :disabled="summaryLoading"
            class="text-xs text-teal-700 border border-teal-300 hover:bg-teal-50 px-2 py-1 rounded font-normal disabled:opacity-50"
            title="サマリを再 load (= 最新の recalc_jobs を取得)"
            @click="loadStatusSummary(false)"
          >
            {{ summaryLoading ? 'ロード中…' : '🔄 reload' }}
          </button>
          <NuxtLink
            to="/admin/recalc"
            class="text-xs text-blue-600 hover:underline font-normal"
            title="recalc / R2 同期を実行 (= 状態サマリの状態を更新)"
          >
            /admin/recalc を開く →
          </NuxtLink>
        </div>
      </div>
      <div class="text-xs text-gray-600 mb-2">{{ summaryMsg }}</div>
      <div v-if="summaryJobs.length === 0 && !summaryLoading && summaryMsg" class="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2">
        対象期間に recalc_jobs が 1 件もありません → recalc が未実行です。
        <NuxtLink to="/admin/recalc" class="text-blue-600 hover:underline">/admin/recalc</NuxtLink>
        の「再計算 → R2 同期」ボタンを実行してください (month 指定を空にすれば editable_months 全部 × 全営業所が処理されます)。
      </div>
      <table v-if="summaryJobs.length > 0" class="min-w-full text-xs">
        <thead class="bg-gray-50 border-b">
          <tr>
            <th class="px-2 py-1 text-left">month</th>
            <th class="px-2 py-1 text-left">office</th>
            <th class="px-2 py-1 text-left">検証 (PHP vs Rust)</th>
            <th class="px-2 py-1 text-left" title="fingerprint が実際に変化した時刻 (= data 最終更新)。computed_at だけ進んでここが古ければ「最近 recalc 試したが data 不変」を意味する">fingerprint_at</th>
            <th class="px-2 py-1 text-left">r2_synced_at</th>
            <th class="px-2 py-1 text-left">状態</th>
            <th class="px-2 py-1 text-left">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="j in summaryJobs" :key="`${j.month}/${j.eigyosho_id}`" class="border-b">
            <td class="px-2 py-1 font-mono">{{ j.month }}</td>
            <td class="px-2 py-1">{{ j.eigyosho_id }}</td>
            <td class="px-2 py-1" :class="verifyLabel(j).cls">{{ verifyLabel(j).text }}</td>
            <td class="px-2 py-1 text-gray-500 text-xs" :title="`computed_at (= 最終 recalc 試行): ${j.computed_at ?? '-'}`">{{ j.fingerprint_changed_at ?? j.computed_at ?? '-' }}</td>
            <td class="px-2 py-1 text-gray-500 text-xs">{{ j.r2_synced_at ?? '-' }}</td>
            <td class="px-2 py-1" :class="jobStatusLabel(j).cls">{{ jobStatusLabel(j).text }}</td>
            <td class="px-2 py-1 whitespace-nowrap">
              <button
                v-if="canVerifyRow(j)"
                :disabled="running || r2SyncLoading"
                class="text-xs text-orange-700 border border-orange-300 hover:bg-orange-50 px-1.5 py-0.5 rounded mr-1 disabled:opacity-50"
                :title="`${j.month} / office=${j.eigyosho_id} だけ verify (PHP vs Rust 突合)`"
                @click="runVerifyForRow(j)"
              >
                🔍 verify
              </button>
              <button
                v-if="canSyncRow(j)"
                :disabled="running || r2SyncLoading"
                class="text-xs text-purple-700 border border-purple-300 hover:bg-purple-50 px-1.5 py-0.5 rounded disabled:opacity-50"
                :title="`${j.month} を R2 同期 (verify-first orchestrator)`"
                @click="runR2SyncForRow(j)"
              >
                🚀 R2 同期
              </button>
              <span v-if="!canVerifyRow(j) && !canSyncRow(j)" class="text-gray-400">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="counts.total > 0" class="bg-white rounded-lg shadow p-4 space-y-3">
      <div class="text-sm flex items-center justify-between flex-wrap gap-2">
        <div>
          <span class="text-gray-500">進捗 (run #{{ currentRunId }}):</span>
          <strong class="ml-2">{{ counts.done }} / {{ counts.total }}</strong>
          ({{ progress }} %)
          —
          <span class="ml-2 text-green-700">OK={{ counts.ok }}</span>
          <span class="ml-2 text-red-700">NG={{ counts.ng }}</span>
          <span class="ml-2 text-orange-700">ERR={{ counts.err }}</span>
          <span class="ml-2 text-gray-500">skipped={{ counts.skipped }}</span>
        </div>
        <button
          :disabled="running"
          class="text-xs text-gray-600 hover:text-gray-900 underline disabled:opacity-50"
          @click="clearHistory"
        >
          履歴クリア (累計 {{ jobs.length }} 件)
        </button>
      </div>
      <div class="w-full bg-gray-200 rounded h-2 overflow-hidden">
        <div class="bg-blue-500 h-2 transition-all" :style="{ width: progress + '%' }"></div>
      </div>
      <div v-if="latestRunErr" class="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
        最新 ERR: #{{ latestRunErr.runId }} {{ latestRunErr.date }} /
        office={{ latestRunErr.officeId }} / cal={{ latestRunErr.cal }}:
        <strong>{{ latestRunErr.error }}</strong>
      </div>
    </div>

    <div v-if="ngJobs.length > 0" class="bg-white rounded-lg shadow p-4">
      <div class="font-semibold text-base mb-2 text-red-700">❌ NG ({{ ngJobs.length }}、履歴含む)</div>
      <table class="min-w-full text-sm">
        <thead class="bg-red-50 border-b">
          <tr>
            <th class="px-3 py-2 text-left">run</th>
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
              <td class="px-3 py-2 text-gray-500">#{{ j.runId }}</td>
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
              <td colspan="7" class="px-3 py-3">
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
      <div class="font-semibold text-base mb-2 text-orange-700">⚠ ERR ({{ errJobs.length }}、履歴含む)</div>
      <ul class="text-xs text-orange-700 list-disc pl-5">
        <li v-for="j in errJobs" :key="j.key">
          #{{ j.runId }} {{ j.date }} / office={{ j.officeId }} / cal={{ j.cal }}: {{ j.error }}
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

    <div v-if="runSummaries.length > 0" class="bg-white rounded-lg shadow p-4">
      <div class="font-semibold text-sm mb-2 text-gray-700">📜 検証履歴 ({{ runSummaries.length }} run)</div>
      <table class="min-w-full text-xs">
        <thead class="bg-gray-50 border-b">
          <tr>
            <th class="px-2 py-1 text-left">run</th>
            <th class="px-2 py-1 text-left">範囲</th>
            <th class="px-2 py-1 text-right">total</th>
            <th class="px-2 py-1 text-right">OK</th>
            <th class="px-2 py-1 text-right">NG</th>
            <th class="px-2 py-1 text-right">ERR</th>
            <th class="px-2 py-1 text-right">skipped</th>
            <th class="px-2 py-1 text-right">running</th>
            <th class="px-2 py-1 text-left">結果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runSummaries" :key="r.runId" class="border-b">
            <td class="px-2 py-1 text-gray-500">#{{ r.runId }}</td>
            <td class="px-2 py-1 font-mono">{{ r.range }}</td>
            <td class="px-2 py-1 text-right">{{ r.total }}</td>
            <td class="px-2 py-1 text-right text-green-700">{{ r.ok }}</td>
            <td class="px-2 py-1 text-right text-red-700">{{ r.ng }}</td>
            <td class="px-2 py-1 text-right text-orange-700">{{ r.err }}</td>
            <td class="px-2 py-1 text-right text-gray-500">{{ r.skipped }}</td>
            <td class="px-2 py-1 text-right text-blue-700">{{ r.running }}</td>
            <td class="px-2 py-1">
              <span v-if="r.running > 0" class="text-blue-700">実行中</span>
              <span v-else-if="r.ng === 0 && r.err === 0" class="text-green-700">✅ 一致</span>
              <span v-else class="text-red-700">❌ 差分あり</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
