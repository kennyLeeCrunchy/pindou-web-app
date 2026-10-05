import Taro from '@tarojs/taro'

export type CellChange = { row: number; column: number; before: string | null; after: string | null }
export type EditorHistory = { undo: CellChange[]; redo: CellChange[] }

const keyFor = (id: string) => `pindou.editor-history.v1.${id}`
const cache = new Map<string, EditorHistory>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const isChange = (item: unknown): item is CellChange => {
  if (!item || typeof item !== 'object') return false
  const value = item as CellChange
  return Number.isInteger(value.row) && Number.isInteger(value.column) &&
    (value.before === null || typeof value.before === 'string') &&
    (value.after === null || typeof value.after === 'string')
}

export function getEditorHistory(id: string): EditorHistory {
  const cached = cache.get(id)
  if (cached) return cached
  try {
    const value = Taro.getStorageSync<Partial<EditorHistory>>(keyFor(id))
    const history = {
      undo: Array.isArray(value?.undo) ? value.undo.filter(isChange).slice(-50) : [],
      redo: Array.isArray(value?.redo) ? value.redo.filter(isChange).slice(-50) : [],
    }
    cache.set(id, history)
    return history
  } catch { return { undo: [], redo: [] } }
}

/* Each tap used to round-trip the bridge to persist two small arrays. The cache
   answers reads immediately (so reopening a draft still finds its undo stack)
   and storage follows once editing pauses. */
export function saveEditorHistory(id: string, history: EditorHistory): void {
  const next = { undo: history.undo.slice(-50), redo: history.redo.slice(-50) }
  cache.set(id, next)
  const pending = timers.get(id)
  if (pending) clearTimeout(pending)
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    try { Taro.setStorageSync(keyFor(id), next) }
    catch { void Taro.showToast({ title: '编辑记录保存失败，请释放存储空间', icon: 'none' }) }
  }, 400))
}

export function flushEditorHistory(id?: string): void {
  const ids = id ? [id] : [...timers.keys()]
  for (const key of ids) {
    const pending = timers.get(key)
    const value = cache.get(key)
    if (pending) { clearTimeout(pending); timers.delete(key) }
    if (value) Taro.setStorageSync(keyFor(key), value)
  }
}

export function clearEditorHistory(id: string): void {
  const pending = timers.get(id)
  if (pending) { clearTimeout(pending); timers.delete(id) }
  cache.delete(id)
  Taro.removeStorageSync(keyFor(id))
}

export function clearAllEditorHistory(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  cache.clear()
}
