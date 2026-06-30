<script setup lang="ts">
/**
 * 運賃リスト 明細ページ (Refs ohishi-exp/rust-ichibanboshi#57)。
 * バージョン切替・運賃順表示・一括印刷・値上げ登録 (audit 付き) を提供する。
 */
import { AuthToolbar } from '~/composables/useAuth'

interface RoutePair { origin: string, dest: string }
interface UnchinGroup {
  partner_code: string
  partner_name: string
  item_code: string
  item_name: string
  fare: number
  routes: RoutePair[]
  count: number
  min_date?: string
  max_date?: string
}
interface CandidatesResponse {
  source_table: string
  groups: UnchinGroup[]
}
interface VersionEntry {
  version_id: string
  effective_from: string
  registered_by: string
  registered_at: string
  item_count: number
}
interface VersionsResponse {
  versions: VersionEntry[]
}
interface VersionDetailResponse {
  items: UnchinGroup[]
}

type Kind = 'with_billing_only' | 'with_non_billing'
const KIND_OPTIONS: { value: Kind, label: string }[] = [
  { value: 'with_non_billing', label: '請求＋非請求 (請求K IN (0,2)、default)' },
  { value: 'with_billing_only', label: '請求＋請求のみ (請求K IN (0,1))' },
]
/** バージョン未登録時・最新の候補を確認したい時に選ぶ擬似バージョン値。 */
const LIVE_VERSION = '__live__'

const route = useRoute()
const partnerType = computed(() => (route.params.partnerType === 'subcontractor' ? 'subcontractor' : 'customer'))
const partnerCode = computed(() => decodeURIComponent(String(route.params.partnerCode ?? '')))
/**
 * 一覧ページで「得意先コードでまとめる」opt-in がかかっていた場合、`partnerCode` は
 * 得意先C (得意先H 無視) を表す。その場合は完全一致ではなく `partnerBaseCode` 一致で
 * 候補を絞り込む (#57 確定事項、自動マージはしない・opt-in 時のみ)。
 */
const groupByCode = computed(() => route.query.groupByCode === '1')

function partnerBaseCode(code: string): string {
  const idx = code.indexOf('-')
  return idx === -1 ? code : code.slice(0, idx)
}
function matchesPartner(code: string): boolean {
  return groupByCode.value ? partnerBaseCode(code) === partnerCode.value : code === partnerCode.value
}

const loading = ref(true)
const error = ref('')
const versions = ref<VersionEntry[]>([])
const selectedVersionId = ref(LIVE_VERSION)
const items = ref<UnchinGroup[]>([])
const partnerName = ref('')
const liveSource = ref('')

const currentYear = new Date().getFullYear()
const candidateFrom = ref(`${currentYear}-01-01`)
const candidateTo = ref(`${currentYear + 1}-01-01`)
const kind = ref<Kind>('with_non_billing')
const registering = ref(false)
const effectiveFrom = ref(new Date().toISOString().slice(0, 10))
const registerMsg = ref('')

/**
 * 品名グルーピングをこの画面から直接登録する (inline)。`/unchin/alias-items` に
 * 移動して品名コードを再検索する手間を省く — このページは既に品名コードと品目名を
 * 一覧表示しているため、行を選んでそのまま登録できた方が早い (#57 follow-up)。
 * 既に alias でまとまっている行 (`item_code` が `alias:` prefix) は選択不可。
 *
 * 選択状態は**行インデックス**で持つ (品名コードでは持たない)。このページの行は
 * 品名コード+運賃の組で分かれているため、同じ品名コードの行が複数存在する
 * (例: 「工場間輸送」が運賃違いで複数行)。品名コードをキーにすると、1行を
 * チェックしただけで同じ品名コードの他の行まで一括チェック扱いになってしまう
 * バグがあったため、行単位で選択し、登録時に品名コードへ変換する。
 */
const selectedForGroup = ref<Set<number>>(new Set())
const groupLabel = ref('')
/** 'merge' = 同一としてまとめる / 'exception' = 別物として記録 (#57 follow-up)。 */
const groupKind = ref<'merge' | 'exception'>('merge')
const groupNote = ref('')
const grouping = ref(false)
const groupMsg = ref('')

function toggleGroupSelection(index: number) {
  const next = new Set(selectedForGroup.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  selectedForGroup.value = next
}

const selectedDistinctItemCodes = computed(() => {
  const codes = Array.from(selectedForGroup.value)
    .map(i => items.value[i]?.item_code)
    .filter((c): c is string => !!c)
  return new Set(codes)
})

async function createGroupFromSelection() {
  grouping.value = true
  groupMsg.value = ''
  try {
    const itemCodes = Array.from(selectedDistinctItemCodes.value)
    if (!groupLabel.value.trim() || itemCodes.length < 2) {
      groupMsg.value = '表示名と、異なる品名コードを2件以上選択してください（同じ品名コードの行を複数選んでも1件として扱われます）'
      return
    }
    await $fetch('/api/unchin/alias/items', {
      method: 'POST',
      body: {
        label: groupLabel.value.trim(),
        item_codes: itemCodes,
        kind: groupKind.value,
        note: groupNote.value.trim(),
      },
    })
    groupMsg.value = groupKind.value === 'exception' ? '✅ 例外として記録しました' : '✅ グルーピングを登録しました'
    selectedForGroup.value = new Set()
    groupLabel.value = ''
    groupNote.value = ''
    groupKind.value = 'merge'
    // alias 反映後の表示に更新
    if (selectedVersionId.value === LIVE_VERSION) {
      await loadLiveCandidates()
    } else {
      await loadVersionDetail(selectedVersionId.value)
    }
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    groupMsg.value = `❌ エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    grouping.value = false
  }
}

/**
 * ライブ候補 (rust から都度抽出してグルーピングしたもの) を取得し、このページの
 * partner_code に絞り込む。バージョン未登録の取引先でもページに何か表示される
 * ようにするための fallback (Refs ohishi-exp/rust-ichibanboshi#57)。
 */
async function loadLiveCandidates() {
  const params = new URLSearchParams({
    from: candidateFrom.value,
    to: candidateTo.value,
    partner_type: partnerType.value,
    kind: kind.value,
  })
  const res = await $fetch<CandidatesResponse>(`/api/unchin/candidates?${params.toString()}`)
  liveSource.value = res.source_table
  const mine = res.groups.filter(g => matchesPartner(g.partner_code))
  items.value = mine
  if (mine.length > 0) partnerName.value = mine[0].partner_name
}

async function loadVersions() {
  const res = await $fetch<VersionsResponse>(
    `/api/unchin/versions?partner_type=${partnerType.value}&partner_code=${encodeURIComponent(partnerCode.value)}`,
  )
  versions.value = res.versions
}

async function loadVersionDetail(versionId: string) {
  if (!versionId) return
  const res = await $fetch<VersionDetailResponse>(
    `/api/unchin/versions/${versionId}?partner_type=${partnerType.value}&partner_code=${encodeURIComponent(partnerCode.value)}`,
  )
  items.value = res.items
  if (items.value.length > 0) partnerName.value = items.value[0].partner_name
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    await loadVersions()
    // 登録済みバージョンがあれば最新を初期表示、無ければライブ候補を表示する
    selectedVersionId.value = versions.value.length > 0 ? versions.value[0].version_id : LIVE_VERSION
    if (selectedVersionId.value === LIVE_VERSION) {
      await loadLiveCandidates()
    } else {
      await loadVersionDetail(selectedVersionId.value)
    }
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    error.value = `読み込みに失敗しました: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(selectedVersionId, async (v) => {
  if (!v) return
  if (v === LIVE_VERSION) {
    await loadLiveCandidates()
  } else {
    await loadVersionDetail(v)
  }
})

async function fetchCandidatesAndRegister() {
  registering.value = true
  registerMsg.value = ''
  try {
    const params = new URLSearchParams({
      from: candidateFrom.value,
      to: candidateTo.value,
      partner_type: partnerType.value,
      kind: kind.value,
    })
    const res = await $fetch<CandidatesResponse>(`/api/unchin/candidates?${params.toString()}`)
    const mine = res.groups.filter(g => matchesPartner(g.partner_code))
    if (mine.length === 0) {
      registerMsg.value = '該当期間に候補データがありません'
      return
    }
    const saved = await $fetch<{ version_id: string, registered_by: string }>('/api/unchin/versions', {
      method: 'POST',
      body: {
        partner_type: partnerType.value,
        partner_code: partnerCode.value,
        effective_from: effectiveFrom.value,
        items: mine,
      },
    })
    registerMsg.value = `✅ ${saved.version_id} として登録しました（登録者: ${saved.registered_by}）`
    await loadVersions()
    selectedVersionId.value = saved.version_id
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    registerMsg.value = `❌ エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    registering.value = false
  }
}

function fmtYen(n: number): string {
  return `${n.toLocaleString('ja-JP')} 円`
}
function printList() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow no-print">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold">
            運賃リスト — {{ partnerName || partnerCode }}
            <span class="text-sm text-gray-400">({{ partnerType === 'subcontractor' ? '傭車先' : '得意先' }})</span>
          </h1>
          <NuxtLink to="/unchin" class="text-sm text-gray-700 border rounded px-3 py-1 hover:bg-gray-100">
            ← 一覧へ戻る
          </NuxtLink>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" />
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-6" :class="{ 'pb-24': selectedForGroup.size > 0 }">
      <div v-if="loading" class="text-center py-20 text-gray-500">読み込み中...</div>
      <div v-else-if="error" class="text-center py-20 text-red-600">{{ error }}</div>
      <template v-else>
        <div class="bg-white rounded-lg shadow p-4 mb-4 flex items-end gap-3 flex-wrap no-print">
          <div>
            <label class="block text-xs text-gray-500">バージョン</label>
            <select v-model="selectedVersionId" class="border rounded px-2 py-1 text-sm">
              <option :value="LIVE_VERSION">
                🔴 ライブ候補（未登録・最新の運転日報明細から都度抽出）
              </option>
              <option v-for="v in versions" :key="v.version_id" :value="v.version_id">
                {{ v.effective_from }} 〜（{{ v.registered_by }} 登録、{{ v.item_count }}件）
              </option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500">請求区分</label>
            <select v-model="kind" class="border rounded px-2 py-1 text-sm" @change="selectedVersionId === LIVE_VERSION && loadLiveCandidates()">
              <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </div>
          <span v-if="versions.length === 0" class="text-sm text-gray-400">登録済みバージョンはまだありません</span>
          <button class="ml-auto bg-gray-700 text-white px-4 py-1 rounded text-sm hover:bg-gray-800" @click="printList">
            🖨 一括印刷 (PDF)
          </button>
        </div>

        <div class="bg-white rounded-lg shadow p-4 mb-4 print-section">
          <h2 class="font-bold text-base mb-3">
            {{ partnerName || partnerCode }} 運賃リスト
          </h2>
          <p v-if="selectedVersionId === LIVE_VERSION" class="text-xs text-gray-400 mb-2">
            {{ liveSource || 'ライブ候補（未登録）' }} — 期間: {{ candidateFrom }} 〜 {{ candidateTo }}
          </p>
          <p v-if="groupByCode" class="text-xs text-orange-600 mb-2 no-print">
            ⚠ 得意先コードでまとめ表示中（支店違いを合算、opt-in）。同一品目・同一運賃でも
            得意先H違いで品名コードが分かれている場合があります。
          </p>
          <p class="text-xs text-gray-400 mb-2 no-print">
            チェックボックスで品名コードを選んで「グルーピング」すると、同一品目として
            まとめて表示できます（表示名一致による自動マージはしません。手動登録のみ）。
          </p>
          <table class="w-full text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="text-left py-1 no-print" />
                <th class="text-left py-1">品目</th>
                <th class="text-left py-1 no-print">品名C</th>
                <th class="text-right py-1">運賃</th>
                <th class="text-right py-1 no-print">件数</th>
                <th class="text-left py-1 no-print">期間</th>
                <th class="text-left py-1">積地・卸地</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in items" :key="i" class="border-b border-gray-100">
                <td class="py-1 no-print">
                  <input
                    v-if="!it.item_code.startsWith('alias:')"
                    type="checkbox"
                    :checked="selectedForGroup.has(i)"
                    @change="toggleGroupSelection(i)"
                  >
                </td>
                <td class="py-1">{{ it.item_name || it.item_code || '(品目未設定)' }}</td>
                <td class="py-1 text-xs text-gray-400 no-print">{{ it.item_code || '?' }}</td>
                <td class="py-1 text-right font-semibold">{{ fmtYen(it.fare) }}</td>
                <td class="py-1 text-right no-print">{{ it.count ?? '?' }}</td>
                <td class="py-1 text-xs text-gray-400 no-print">
                  <template v-if="it.min_date || it.max_date">
                    {{ it.min_date }} 〜 {{ it.max_date }}
                  </template>
                </td>
                <td class="py-1">
                  <span
                    v-for="(r, ri) in it.routes"
                    :key="ri"
                    class="block w-fit mb-1 px-2 py-0.5 bg-gray-100 rounded text-xs whitespace-nowrap"
                  >
                    {{ r.origin || '?' }} → {{ r.dest || '?' }}
                  </span>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="7" class="py-6 text-center text-gray-400">
                  該当期間に運賃データがありません（期間・請求区分を変更してみてください）
                </td>
              </tr>
            </tbody>
          </table>

          <div v-if="groupMsg" class="mt-2 text-sm whitespace-pre-wrap no-print">{{ groupMsg }}</div>
        </div>

        <!-- 選択中は画面下部に固定表示 (スクロールしても操作できるように、#57 follow-up) -->
        <div
          v-if="selectedForGroup.size > 0"
          class="fixed inset-x-0 bottom-0 z-40 bg-white border-t shadow-[0_-2px_8px_rgba(0,0,0,0.1)] no-print"
        >
          <div class="max-w-5xl mx-auto px-4 py-3 flex items-end gap-3 flex-wrap">
            <div class="flex gap-3 text-sm">
              <label class="flex items-center gap-1 cursor-pointer">
                <input v-model="groupKind" type="radio" value="merge">
                同一としてまとめる
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input v-model="groupKind" type="radio" value="exception">
                別物として記録（例外）
              </label>
            </div>
            <div>
              <label class="block text-xs text-gray-500">表示名</label>
              <input v-model="groupLabel" type="text" class="border rounded px-2 py-1 text-sm" placeholder="例: 精製原料輸送">
            </div>
            <div>
              <label class="block text-xs text-gray-500">備考（任意）</label>
              <input v-model="groupNote" type="text" class="border rounded px-2 py-1 text-sm" placeholder="例: 積地が違うため別物">
            </div>
            <span class="text-xs text-gray-500">
              選択中: {{ selectedForGroup.size }} 行 (異なる品名コード {{ selectedDistinctItemCodes.size }} 種)
            </span>
            <button
              :disabled="grouping"
              class="bg-orange-600 text-white px-4 py-1 rounded text-sm hover:bg-orange-700 disabled:bg-gray-400"
              @click="createGroupFromSelection"
            >
              {{ grouping ? '登録中…' : groupKind === 'exception' ? '例外として記録' : 'グルーピングを登録' }}
            </button>
            <button class="text-xs text-gray-500 hover:underline" @click="selectedForGroup = new Set()">
              選択解除
            </button>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow p-4 no-print">
          <h2 class="font-semibold text-base mb-2">値上げとして登録</h2>
          <div class="flex items-end gap-3 flex-wrap text-sm">
            <div>
              <label class="block text-xs text-gray-500">候補抽出期間 from</label>
              <input v-model="candidateFrom" type="date" class="border rounded px-2 py-1">
            </div>
            <div>
              <label class="block text-xs text-gray-500">to (含まない)</label>
              <input v-model="candidateTo" type="date" class="border rounded px-2 py-1">
            </div>
            <div>
              <label class="block text-xs text-gray-500">有効開始日 (値上げ日)</label>
              <input v-model="effectiveFrom" type="date" class="border rounded px-2 py-1">
            </div>
            <button
              :disabled="registering"
              class="bg-orange-600 text-white px-4 py-1 rounded hover:bg-orange-700 disabled:bg-gray-400"
              @click="fetchCandidatesAndRegister"
            >
              {{ registering ? '登録中…' : 'このタイミングで確定 (値上げ登録)' }}
            </button>
          </div>
          <div v-if="registerMsg" class="mt-2 text-sm whitespace-pre-wrap">{{ registerMsg }}</div>
        </div>
      </template>
    </main>
  </div>
</template>
