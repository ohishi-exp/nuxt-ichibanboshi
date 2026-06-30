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
}
interface CandidatesResponse {
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

const route = useRoute()
const partnerType = computed(() => (route.params.partnerType === 'subcontractor' ? 'subcontractor' : 'customer'))
const partnerCode = computed(() => decodeURIComponent(String(route.params.partnerCode ?? '')))

const loading = ref(true)
const error = ref('')
const versions = ref<VersionEntry[]>([])
const selectedVersionId = ref('')
const items = ref<UnchinGroup[]>([])
const partnerName = ref('')

const currentYear = new Date().getFullYear()
const candidateFrom = ref(`${currentYear}-01-01`)
const candidateTo = ref(`${currentYear + 1}-01-01`)
const registering = ref(false)
const effectiveFrom = ref(new Date().toISOString().slice(0, 10))
const registerMsg = ref('')

async function loadVersions() {
  const res = await $fetch<VersionsResponse>(
    `/api/unchin/versions?partner_type=${partnerType.value}&partner_code=${encodeURIComponent(partnerCode.value)}`,
  )
  versions.value = res.versions
  if (versions.value.length > 0) {
    selectedVersionId.value = versions.value[0].version_id
    await loadVersionDetail(selectedVersionId.value)
  } else {
    items.value = []
  }
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
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    error.value = `読み込みに失敗しました: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(selectedVersionId, (v) => {
  if (v) void loadVersionDetail(v)
})

async function fetchCandidatesAndRegister() {
  registering.value = true
  registerMsg.value = ''
  try {
    const params = new URLSearchParams({
      from: candidateFrom.value,
      to: candidateTo.value,
      partner_type: partnerType.value,
    })
    const res = await $fetch<CandidatesResponse>(`/api/unchin/candidates?${params.toString()}`)
    const mine = res.groups.filter(g => g.partner_code === partnerCode.value)
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
          <NuxtLink to="/unchin" class="text-sm text-blue-600 hover:underline">
            ← 一覧へ戻る
          </NuxtLink>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" />
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-6">
      <div v-if="loading" class="text-center py-20 text-gray-500">読み込み中...</div>
      <div v-else-if="error" class="text-center py-20 text-red-600">{{ error }}</div>
      <template v-else>
        <div class="bg-white rounded-lg shadow p-4 mb-4 flex items-center gap-3 flex-wrap no-print">
          <label class="text-sm font-medium">バージョン:</label>
          <select v-model="selectedVersionId" class="border rounded px-2 py-1 text-sm">
            <option v-for="v in versions" :key="v.version_id" :value="v.version_id">
              {{ v.effective_from }} 〜（{{ v.registered_by }} 登録、{{ v.item_count }}件）
            </option>
          </select>
          <span v-if="versions.length === 0" class="text-sm text-gray-400">登録済みバージョンがありません</span>
          <button class="ml-auto bg-gray-700 text-white px-4 py-1 rounded text-sm hover:bg-gray-800" @click="printList">
            🖨 一括印刷 (PDF)
          </button>
        </div>

        <div class="bg-white rounded-lg shadow p-4 mb-4 print-section">
          <h2 class="font-bold text-base mb-3">
            {{ partnerName || partnerCode }} 運賃リスト
          </h2>
          <table class="w-full text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="text-left py-1">品目</th>
                <th class="text-right py-1">運賃</th>
                <th class="text-left py-1">積地・卸地</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in items" :key="i" class="border-b border-gray-100">
                <td class="py-1">{{ it.item_name || it.item_code || '(品目未設定)' }}</td>
                <td class="py-1 text-right font-semibold">{{ fmtYen(it.fare) }}</td>
                <td class="py-1">
                  <span
                    v-for="(r, ri) in it.routes"
                    :key="ri"
                    class="inline-block mr-2 mb-1 px-2 py-0.5 bg-gray-100 rounded text-xs"
                  >
                    {{ r.origin || '?' }} → {{ r.dest || '?' }}
                  </span>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="3" class="py-6 text-center text-gray-400">バージョンを選択してください</td>
              </tr>
            </tbody>
          </table>
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
