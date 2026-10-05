import Taro from '@tarojs/taro'
import type { Work } from '../shared/types'
import { clearEditorHistory } from './editorHistory'

const STORAGE_KEY = 'pindou.works.v1'
let worksCache: Work[] | undefined
let flushTimer: ReturnType<typeof setTimeout> | undefined

const isWork = (value: unknown): value is Work => {
  if (!value || typeof value !== 'object') return false
  const work = value as Work
  return typeof work.id === 'string' && typeof work.name === 'string' &&
    Number.isInteger(work.width) && Number.isInteger(work.height) && Array.isArray(work.cells)
}

/* progress is recomputed live by getWorkProgress() wherever it is displayed, so
   storing it only cost a full grid scan on every single save. */
const normalize = (work: Work): Work => ({
  ...work,
  cells: work.cells.map(row => row.map(cell => typeof cell === 'string' ? cell : null)),
  palette: Array.isArray(work.palette) ? work.palette : [],
  completedCells: Array.isArray(work.completedCells) ? work.completedCells : [],
  progress: typeof work.progress === 'number' ? work.progress : 0,
})

/* Painting a grid calls saveWork per tap. Writing the whole library to storage
   synchronously each time is what made the editor stutter, so the in-memory
   cache is authoritative at once and storage catches up once painting pauses.
   ponytail: 400ms trailing debounce; a hard kill inside that window loses the
   last tap, which onAppHide covers for the ordinary backgrounding case. */
function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined }
  if (!worksCache) return
  try { Taro.setStorageSync(STORAGE_KEY, worksCache) }
  catch { throw new Error('作品保存失败，请释放本机存储空间后重试') }
}

export function flushWorks() { flush() }

export function clearWorksCache() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = undefined
  worksCache = []
}

export function getWorks(): Work[] {
  if (worksCache) return worksCache.slice()
  try {
    const data = Taro.getStorageSync<unknown>(STORAGE_KEY)
    worksCache = (Array.isArray(data) ? data.filter(isWork).map(normalize) : [])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return worksCache.slice()
  } catch {
    return []
  }
}

export function getWork(id: string): Work | undefined {
  return getWorks().find(work => work.id === id)
}

export function saveWork(work: Work): Work {
  const next = normalize({ ...work, updatedAt: new Date().toISOString() })
  const works = getWorks()
  const index = works.findIndex(item => item.id === next.id)
  const isNew = index < 0
  if (index >= 0) works[index] = next
  else works.unshift(next)
  worksCache = works
  /* A brand-new draft must hit storage immediately: devtools hot reload and
     real-device debug kills can re-run this module inside the debounce window
     and the draft would never have existed. Updates (paint taps) stay debounced. */
  if (isNew) flush()
  else {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      try { flush() } catch { void Taro.showToast({ title: '作品保存失败，请释放存储空间', icon: 'none' }) }
    }, 400)
  }
  return next
}

export function createWork(input: Omit<Work, 'id' | 'createdAt' | 'updatedAt' | 'progress'>): Work {
  const now = new Date().toISOString()
  return saveWork({
    ...input,
    id: `work_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    progress: 0,
  })
}

export function renameWork(id: string, name: string): Work | undefined {
  const work = getWork(id)
  const trimmed = name.trim().slice(0, 30)
  return work && trimmed ? saveWork({ ...work, name: trimmed }) : undefined
}

export function deleteWork(id: string): void {
  const previous = getWorks()
  worksCache = previous.filter(work => work.id !== id)
  try { flush() } catch (reason) { worksCache = previous; throw reason }
  clearEditorHistory(id)
}

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`
}

export function getWorkProgress(work: Pick<Work, 'cells' | 'completedCells'>): number {
  const required = work.cells.flatMap((row, rowIndex) => row
    .map((cell, columnIndex) => cell ? cellKey(rowIndex, columnIndex) : '')
    .filter(Boolean))
  if (!required.length) return 0
  const completed = new Set(work.completedCells || [])
  return Math.round(required.filter(key => completed.has(key)).length / required.length * 100)
}
