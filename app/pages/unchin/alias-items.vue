<script setup lang="ts">
/**
 * 品名コードの手動エイリアスグループ管理ページ (Refs ohishi-exp/rust-ichibanboshi#57)。
 * 「この品名Cとこの品名Cは同一」をユーザーが手動で登録する。表示名一致による
 * 自動マージは行わない (#57 確定事項)。
 */
import { AuthToolbar } from '~/composables/useAuth'

interface UnchinAliasGroup {
  group_id: string
  label: string
  item_codes: string[]
  kind: 'merge' | 'exception'
  note: string
  registered_by: string
  registered_at: string
}
interface AliasGroupsResponse {
  groups: UnchinAliasGroup[]
}
interface CandidateGroup {
  item_code: string
  item_name: string
}
interface CandidatesResponse {
  groups: CandidateGroup[]
}
interface ItemOption {
  item_code: string
  item_name: string
}

const loading = ref(true)
const error = ref('')
const groups = ref<UnchinAliasGroup[]>([])
const itemOptions = ref<ItemOption[]>([])
const search = ref('')

const newLabel = ref('')
const newKind = ref<'merge' | 'exception'>('merge')
const newNote = ref('')
const selectedCodes = ref<string[]>([])
const saving = ref(false)
const saveMsg = ref('')

const filteredOptions = computed(() => {
  const q = search.value.trim()
  if (!q) return itemOptions.value
  return itemOptions.value.filter(o => o.item_code.includes(q) || o.item_name.includes(q))
})

// チェックを入れたのに毎回手入力させないよう、表示名が未入力なら最初に選んだ
// 品名コードの品目名をデフォルトで入れる (#57 follow-up)。全解除したらクリアする。
watch(selectedCodes, (codes) => {
  if (codes.length === 0) {
    newLabel.value = ''
  } else if (!newLabel.value.trim()) {
    const first = itemOptions.value.find(o => o.item_code === codes[0])
    newLabel.value = first?.item_name || first?.item_code || ''
  }
})

async function loadGroups() {
  const res = await $fetch<AliasGroupsResponse>('/api/unchin/alias/items')
  groups.value = res.groups
}

/** 直近1年分の候補から distinct 品名コード一覧を集める (選択肢提示用、診断用)。 */
async function loadItemOptions() {
  const currentYear = new Date().getFullYear()
  const params = new URLSearchParams({
    from: `${currentYear - 1}-01-01`,
    to: `${currentYear + 1}-01-01`,
    partner_type: 'customer',
    kind: 'with_non_billing',
  })
  const res = await $fetch<CandidatesResponse>(`/api/unchin/candidates?${params.toString()}`)
  const map = new Map<string, string>()
  for (const g of res.groups) {
    if (!map.has(g.item_code)) map.set(g.item_code, g.item_name)
  }
  itemOptions.value = Array.from(map.entries())
    .map(([item_code, item_name]) => ({ item_code, item_name }))
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([loadGroups(), loadItemOptions()])
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    error.value = `読み込みに失敗しました: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createGroup() {
  saving.value = true
  saveMsg.value = ''
  try {
    if (!newLabel.value.trim()) {
      saveMsg.value = '⚠ 表示名を入力してください'
      return
    }
    if (selectedCodes.value.length < 2) {
      saveMsg.value = '⚠ 品名コードを2件以上選択してください'
      return
    }
    await $fetch('/api/unchin/alias/items', {
      method: 'POST',
      body: {
        label: newLabel.value.trim(),
        item_codes: selectedCodes.value,
        kind: newKind.value,
        note: newNote.value.trim(),
      },
    })
    saveMsg.value = '✅ 登録しました'
    newLabel.value = ''
    newNote.value = ''
    newKind.value = 'merge'
    selectedCodes.value = []
    await loadGroups()
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string }
    saveMsg.value = `❌ エラー: ${err.statusCode ?? '?'} ${err.statusMessage ?? String(e)}`
  } finally {
    saving.value = false
  }
}

async function deleteGroup(groupId: string) {
  if (!confirm('このグルーピングを削除しますか？')) return
  await $fetch(`/api/unchin/alias/items/${groupId}`, { method: 'DELETE' })
  await loadGroups()
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold">品名グルーピング管理</h1>
          <NuxtLink to="/unchin" class="text-sm text-gray-700 border border-gray-400 rounded px-3 py-1 bg-white hover:bg-gray-100">
            ← 運賃リストへ戻る
          </NuxtLink>
        </div>
        <AuthToolbar :show-copy-url="false" :show-qr="false" />
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-6">
      <p class="text-sm text-gray-500 mb-4">
        運転日報明細上の品名コードは、表示名が同じでもコードが異なる場合があります
        （自動マージはしません）。ここで「この品名コードとこの品名コードは同一」を
        手動で登録すると、運賃リスト上でまとめて表示されます。
      </p>

      <div v-if="loading" class="text-center py-20 text-gray-500">読み込み中...</div>
      <div v-else-if="error" class="text-center py-20 text-red-600">{{ error }}</div>
      <template v-else>
        <div class="bg-white rounded-lg shadow p-4 mb-6">
          <h2 class="font-semibold text-base mb-3">新規グルーピング登録</h2>
          <div class="mb-3 flex gap-4 text-sm">
            <label class="flex items-center gap-1 cursor-pointer">
              <input v-model="newKind" type="radio" value="merge">
              同一としてまとめる
            </label>
            <label class="flex items-center gap-1 cursor-pointer">
              <input v-model="newKind" type="radio" value="exception">
              別物として記録する（例外・誤統合防止の備忘）
            </label>
          </div>
          <div class="mb-3">
            <label class="block text-xs text-gray-500">
              {{ newKind === 'exception' ? '表示名（記録用のラベル）' : '表示名（まとめた後の品目名）' }}
            </label>
            <input v-model="newLabel" type="text" class="border rounded px-2 py-1 text-sm w-full max-w-sm" placeholder="例: 一般貨物運賃">
          </div>
          <div class="mb-3">
            <label class="block text-xs text-gray-500">備考（例外の理由等、任意）</label>
            <input v-model="newNote" type="text" class="border rounded px-2 py-1 text-sm w-full max-w-sm" placeholder="例: 似ているが積地が違うため別物">
          </div>
          <div class="mb-3">
            <label class="block text-xs text-gray-500">品名コード検索</label>
            <input v-model="search" type="text" class="border rounded px-2 py-1 text-sm w-full max-w-sm" placeholder="コードまたは品目名で絞り込み">
          </div>
          <div class="border rounded max-h-64 overflow-auto text-sm mb-3">
            <label
              v-for="o in filteredOptions"
              :key="o.item_code"
              class="flex items-center gap-2 px-2 py-1 border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
            >
              <input v-model="selectedCodes" type="checkbox" :value="o.item_code">
              <span class="text-gray-400 w-20 shrink-0">{{ o.item_code }}</span>
              <span>{{ o.item_name || '(品目未設定)' }}</span>
            </label>
            <p v-if="filteredOptions.length === 0" class="px-2 py-4 text-center text-gray-400">該当する品名コードがありません</p>
          </div>
          <p class="text-xs text-gray-500 mb-2">選択中: {{ selectedCodes.length }} 件</p>
          <button
            :disabled="saving || !newLabel.trim() || selectedCodes.length < 2"
            class="bg-orange-600 text-white px-4 py-1 rounded text-sm hover:bg-orange-700 disabled:bg-gray-400"
            @click="createGroup"
          >
            {{ saving ? '登録中…' : newKind === 'exception' ? '例外として記録' : 'グルーピングを登録' }}
          </button>
          <div v-if="saveMsg" class="mt-2 text-sm whitespace-pre-wrap">{{ saveMsg }}</div>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <h2 class="font-semibold text-base mb-3">登録済みグルーピング</h2>
          <table class="w-full text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="text-left py-1">種別</th>
                <th class="text-left py-1">表示名</th>
                <th class="text-left py-1">品名コード</th>
                <th class="text-left py-1">備考</th>
                <th class="text-left py-1">登録者・日時</th>
                <th class="text-left py-1" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in groups" :key="g.group_id" class="border-b border-gray-100">
                <td class="py-1">
                  <span
                    class="px-2 py-0.5 rounded text-xs"
                    :class="g.kind === 'exception' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'"
                  >
                    {{ g.kind === 'exception' ? '例外(別物)' : 'まとめる' }}
                  </span>
                </td>
                <td class="py-1">{{ g.label }}</td>
                <td class="py-1">
                  <span
                    v-for="c in g.item_codes"
                    :key="c"
                    class="inline-block mr-1 mb-1 px-2 py-0.5 bg-gray-100 rounded text-xs"
                  >{{ c }}</span>
                </td>
                <td class="py-1 text-xs text-gray-500">{{ g.note }}</td>
                <td class="py-1 text-xs text-gray-400">{{ g.registered_by }} / {{ g.registered_at.slice(0, 10) }}</td>
                <td class="py-1 text-right">
                  <button class="text-red-600 text-xs hover:underline" @click="deleteGroup(g.group_id)">削除</button>
                </td>
              </tr>
              <tr v-if="groups.length === 0">
                <td colspan="6" class="py-6 text-center text-gray-400">登録済みグルーピングはありません</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </main>
  </div>
</template>
