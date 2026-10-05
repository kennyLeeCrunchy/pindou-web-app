const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')

const storage = new Map()
const files = new Map()
const toasts = []
let uploaded
const uploadCalls = []
let payload
let failStorageWrites = false
let loginImpl = async () => ({ code: 'test-code' })
let requestImpl = async () => ({ statusCode: 200, data: { token: 'test-token' } })
let uploadImpl = async () => ({ statusCode: 200, data: JSON.stringify(payload) })
const taro = {
  env: { USER_DATA_PATH: '/user' },
  login: async (...args) => loginImpl(...args),
  request: async (...args) => requestImpl(...args),
  uploadFile: async options => { uploaded = options; uploadCalls.push(options); return uploadImpl(options) },
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => { if (failStorageWrites) throw new Error('storage full'); storage.set(key, value) },
  removeStorageSync: key => storage.delete(key),
  clearStorageSync: () => storage.clear(),
  showToast: async options => { toasts.push(options) },
  downloadFile: async ({ url }) => ({ statusCode: 200, tempFilePath: url }),
  getFileSystemManager: () => ({
    writeFileSync: (path, data, encoding) => files.set(path, { data, encoding }),
    saveFileSync: (source, path) => files.set(path, { data: source }),
    readdirSync: dir => [...files.keys()].filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1)),
    unlinkSync: path => { if (!files.delete(path)) throw new Error('file missing') },
  }),
}
const load = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@tarojs/taro') return { __esModule: true, default: taro }
  return load.call(this, request, parent, isMain)
}
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  module._compile(output, filename)
}
process.env.TARO_APP_API_BASE_URL = 'https://example.test'
const { convertPattern, preparePattern, completePreparedPattern, conversionForm, normalizeConversion } = require('../src/services/api.ts')
const { ensureSession, invalidateSession } = require('../src/services/auth.ts')
const { editCell } = require('../src/utils/edit.ts')
const { countCells, materializePrepared, materializePreviews } = require('../src/utils/pattern.ts')
const { drawCells } = require('../src/utils/canvas.ts')
const { getWork, saveWork, deleteWork } = require('../src/store/works.ts')
const { getEditorHistory, saveEditorHistory } = require('../src/store/editorHistory.ts')
const { clearLocalData } = require('../src/utils/localData.ts')
const { toUserMessage } = require('../src/utils/error.ts')
const { saveImageToAlbum } = require('../src/utils/album.ts')
const artkalColors = require('../src/data/artkal-m-colors.json')

test('album saving respects denied permission, cancellation, and settings approval', async () => {
  let allowed = false, confirm = false, grant = false, saves = 0, opened = 0
  taro.getSetting = async () => ({ authSetting: { 'scope.writePhotosAlbum': allowed } })
  taro.showModal = async () => ({ confirm })
  taro.openSetting = async () => { opened++; return { authSetting: { 'scope.writePhotosAlbum': grant } } }
  taro.saveImageToPhotosAlbum = async ({ filePath }) => { assert.equal(filePath, '/user/pattern.png'); saves++ }
  assert.equal(await saveImageToAlbum('/user/pattern.png'), false)
  assert.equal(saves, 0)
  assert.equal(opened, 0)
  confirm = true
  await assert.rejects(saveImageToAlbum('/user/pattern.png'), /权限未开启/)
  assert.equal(saves, 0)
  grant = true
  assert.equal(await saveImageToAlbum('/user/pattern.png'), true)
  allowed = true
  assert.equal(await saveImageToAlbum('/user/pattern.png'), true)
  allowed = undefined // Native save presents the first permission request.
  assert.equal(await saveImageToAlbum('/user/pattern.png'), true)
  assert.equal(saves, 3)
  assert.equal(opened, 2)
})

test('album and canvas failures keep their cause instead of becoming network errors', () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.match(toUserMessage({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }), /相册写入权限/)
    assert.match(toUserMessage({ errMsg: 'saveImageToPhotosAlbum:fail privacy permission is not authorized' }), /隐私授权/)
    assert.match(toUserMessage({ errMsg: 'saveImageToPhotosAlbum:fail invalid file type' }), /文件无效/)
    assert.match(toUserMessage({ errMsg: 'canvasToTempFilePath:fail canvas is empty' }), /图纸导出失败/)
    assert.match(toUserMessage({ errMsg: 'uploadFile:fail connection reset' }), /网络连接异常/)
    assert.equal(toUserMessage({ errMsg: 'saveImageToPhotosAlbum:fail cancel' }), '')
  } finally { console.warn = warn }
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('undo and redo remain available after reopening an autosaved work', () => {
  const original = {
    id: 'history-reopen', name: '进度测试', width: 1, height: 1, brand: 'Artkal', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', progress: 0,
    palette: [{ code: 'H7', name: 'H7', hex: '#000000', count: 0 }], cells: [[null]],
  }
  const change = { row: 0, column: 0, before: null, after: 'H7' }
  saveWork(editCell(original, 0, 0, change.after))
  saveEditorHistory(original.id, { undo: [change], redo: [] })
  let reopened = getWork(original.id)
  assert.equal(reopened.cells[0][0], 'H7')
  let history = getEditorHistory(original.id)
  saveWork(editCell(reopened, change.row, change.column, history.undo[0].before))
  saveEditorHistory(original.id, { undo: [], redo: [change] })
  reopened = getWork(original.id)
  history = getEditorHistory(original.id)
  assert.equal(reopened.cells[0][0], null)
  assert.deepEqual(history.redo, [change])
  saveWork(editCell(reopened, change.row, change.column, history.redo[0].after))
  assert.equal(getWork(original.id).cells[0][0], 'H7')
})

const counts = [{ code: 'R1', name: '红', hex: '#ff0000', count: 1 }, { code: 'B1', name: '蓝', hex: '#0000ff', count: 1 }]
function response(mode, framing) {
  return {
    task_id: 'mock-task', mode, framing_mode: framing, ai_passes: mode === 'subject_cartoon' ? 1 : 0,
    algorithm_version: 'test-v1', raw_image_url: '/original.png', clean_image_url: '/ai.png', transparent_image_url: '/subject.png',
    variants: [52, 78, 104].map(size => ({
      width: size, height: size, cells: Array.from({ length: size }, () => Array(size).fill('R1')),
      counts: [{ ...counts[0], count: size * size }], preview_data_url: `data:image/png;base64,aGVsbG8=`,
    })),
  }
}

test('three modes send only the new multipart contract with correct defaults and framing', async () => {
  uploadCalls.length = 0
  for (const [mode, expectedColors, framing] of [['cartoon_direct', '12'], ['scene_direct', '24'], ['subject_cartoon', '12', 'flat']]) {
    payload = response(mode, framing)
    const result = await convertPattern({ filePath: '/temp/photo.jpg', mode, subjectTarget: '中央人物' })
    assert.equal(uploaded.url, 'https://example.test/api/pattern/convert')
    assert.equal(uploaded.name, 'image')
    assert.equal(uploaded.formData.mode, mode)
    assert.equal(uploaded.formData.max_colors, expectedColors)
    assert.equal(uploaded.formData.color_selection, 'auto')
    assert.equal(uploaded.formData.framing_mode, framing)
    assert.equal(uploaded.formData.subject_target, mode === 'subject_cartoon' ? '中央人物' : undefined)
    assert.equal(uploaded.formData.similarity_threshold, undefined)
    assert.equal(result.variants[104].cells.length, 104)
    assert.equal(result.variants[78].previewUrl, 'data:image/png;base64,aGVsbG8=')
    const local = await materializePreviews(result)
    assert.equal(local.variants[78].previewUrl, '/user/perlabo-mock-task-78.png')
    assert.equal(files.get(local.variants[78].previewUrl).encoding, 'base64')
    assert.equal(result.aiPasses, mode === 'subject_cartoon' ? 1 : 0)
  }
  assert.equal(conversionForm({ filePath: 'x', mode: 'subject_cartoon', framingMode: 'pendant', maxColors: 37 }).max_colors, '37')
  assert.equal(conversionForm({ filePath: 'x', mode: 'subject_cartoon', maxColors: 37 }).color_selection, 'manual')
  assert.equal(conversionForm({ filePath: 'x', mode: 'subject_cartoon', framingMode: 'pendant' }).framing_mode, 'pendant')
  assert.throws(() => conversionForm({ filePath: 'x', mode: 'scene_direct', maxColors: 65 }))
})

test('two steps reuse the full local PNG and never send the AI route for color changes', async () => {
  const before = uploadImpl
  clearLocalData()
  uploadCalls.length = 0
  const png = 'data:image/png;base64,aGVsbG8='
  uploadImpl = async options => {
    if (options.url.endsWith('/prepare')) return { statusCode: 200, data: JSON.stringify({
      phase: 'prepared', task_id: 'prepared-task', mode: 'subject_cartoon', framing_mode: 'pendant',
      ai_passes: 1, algorithm_version: 'v14', prepared_image_url: png,
      raw_image_url: png, ai_image_url: png, transparent_image_url: png,
    }) }
    return { statusCode: 200, data: JSON.stringify({ ...response('cartoon_direct'), max_colors: 24,
      color_selection: options.formData.color_selection, color_advice: { recommended_max_colors: 24, recommendation_acceptable: true } }) }
  }
  try {
    const prepared = await materializePrepared(await preparePattern({ filePath: '/temp/photo.jpg', mode: 'subject_cartoon', framingMode: 'pendant' }))
    assert.equal(prepared.preparedImage, '/user/perlabo-prepared-task-prepared.png')
    assert.ok(files.has(prepared.preparedImage))
    const a = await completePreparedPattern(prepared, { brand: 'Mard', colorSelection: 'auto', maxColors: 12 })
    await completePreparedPattern(prepared, { brand: 'Artkal', colorSelection: 'manual', maxColors: 32 })
    assert.deepEqual(uploadCalls.map(c => c.formData.mode), ['subject_cartoon', 'cartoon_direct', 'cartoon_direct'])
    assert.equal(uploadCalls[1].filePath, prepared.preparedImage)
    assert.equal(uploadCalls[2].filePath, prepared.preparedImage)
    assert.equal(uploadCalls[1].formData.framing_mode, undefined)
    assert.equal(uploadCalls[1].formData.subject_target, undefined)
    assert.equal(a.mode, 'subject_cartoon')
    assert.equal(a.framingMode, 'pendant')
    assert.equal(a.aiPasses, 1)
    assert.deepEqual(a.images, prepared.images)
    assert.equal(a.maxColors, 24)
    assert.equal(a.colorAdvice.recommendedMaxColors, 24)
    clearLocalData()
    assert.equal(files.has(prepared.preparedImage), false)
  } finally { uploadImpl = before }
})

test('incomplete tiers cannot masquerade as a successful result', () => {
  const data = response('scene_direct')
  data.variants.pop()
  assert.throws(() => normalizeConversion(data), /104×104/)
})

test('size drafts stay separate and edited counts update; undo restores cells', () => {
  const make = size => ({
    id: `mock-task-${size}`, conversionId: 'mock-task', name: 'draft', width: size, height: size, brand: 'Artkal',
    status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', progress: 0,
    palette: counts, cells: Array.from({ length: size }, () => Array(size).fill('R1')),
  })
  const first = make(52)
  const second = make(78)
  saveWork(first); saveWork(second)
  const edited = editCell(getWork(first.id), 0, 0, 'B1')
  saveWork(edited)
  assert.equal(getWork(second.id).cells[0][0], 'R1')
  assert.equal(countCells(edited.cells, edited.palette).reduce((sum, item) => sum + item.count, 0), 52 * 52)
  assert.equal(countCells(edited.cells, edited.palette).find(item => item.code === 'B1').count, 1)
  assert.equal(countCells(edited.cells, edited.palette).find(item => item.code === 'R1').count, 52 * 52 - 1)
  const undone = editCell(edited, 0, 0, 'R1')
  assert.equal(undone.cells[0][0], first.cells[0][0])
})

test('complete Artkal palette can add a new color to draft counts', () => {
  assert.equal(artkalColors.length, 221)
  assert.equal(new Set(artkalColors.map(item => item.code)).size, 221)
  const selected = artkalColors.find(item => item.code === 'M15')
  assert.ok(selected && /^#[0-9a-f]{6}$/i.test(selected.hex))
  const work = {
    id: 'artkal-color-test', name: 'test', width: 2, height: 2, brand: 'Artkal', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', progress: 0,
    palette: [{ code: 'H7', name: 'H7', hex: '#000000', count: 4 }, { code: selected.code, name: selected.name, hex: selected.hex, count: 0 }],
    cells: [['H7', 'H7'], ['H7', 'H7']],
  }
  const edited = editCell(work, 0, 0, selected.code)
  assert.equal(countCells(edited.cells, edited.palette).find(item => item.code === 'M15').count, 1)
  assert.equal(edited.palette.find(item => item.code === 'M15').hex, selected.hex)
  assert.equal(countCells(edited.cells, edited.palette).find(item => item.code === 'M15').count, 1)
})

test('brand is sent to the convert API and each brand has its own full card', () => {
  assert.equal(conversionForm({ filePath: '/p.jpg', mode: 'scene_direct' }).brand, 'Artkal')
  assert.equal(conversionForm({ filePath: '/p.jpg', mode: 'scene_direct', brand: 'Mard' }).brand, 'Mard')
  const { BRAND_COLORS } = require('../src/data/palettes.ts')
  const csv = fs.readFileSync(require('node:path').join(__dirname, '../../backend/color_standards/mard_221_colors_vertical.csv'), 'utf8')
    .replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map(line => line.split(','))
  assert.equal(BRAND_COLORS.Mard.length, 221)
  assert.deepEqual(BRAND_COLORS.Mard.map(c => [c.code, c.hex]), csv.map(([code, , , hex]) => [code, hex.toUpperCase()]))
  assert.equal(BRAND_COLORS.Artkal.length, 221)
})

test('rectangular editor canvas draws extra rows', async () => {
  const rectangles = []
  const context2d = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    setTransform() {}, translate() {}, save() {}, restore() {},
    fillRect: (...args) => rectangles.push(args),
    beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, strokeRect() {},
  }
  taro.createSelectorQuery = () => ({
    select: () => ({ fields: () => ({ exec: done => done([{ node: { width: 0, height: 0, getContext: () => context2d } }]) }) }),
  })
  const node = await drawCells('editor', Array.from({ length: 4 }, () => ['H7', 'H7']), [{ code: 'H7', hex: '#000000' }], 0, 0, 2, 10, 4)
  assert.ok(node)
  assert.deepEqual(rectangles[0], [0, 0, 20, 40])
  assert.equal(rectangles.filter(rect => rect[2] === 20 && rect[3] === 10).length, 4)
})

test('zoom keeps both frames fixed and clips the next row into the bottom remainder', async () => {
  const cells = Array.from({ length: 208 }, (_, row) => Array(104).fill(row % 2 ? 'H8' : 'H7'))
  const palette = [{ code: 'H7', hex: '#000000' }, { code: 'H8', hex: '#0000ff' }]
  for (const ratio of [1.2, 1.25, 1.55]) {
    for (const scale of [1, 2, 3]) {
      const fills = []
      const borders = []
      let clipHeight = Infinity
      const clips = []
      const ctx = {
        setTransform() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
        save() { clips.push(clipHeight) },
        rect(x, y, width, height) { this.pathHeight = y + height },
        clip() { clipHeight = Math.min(clipHeight, this.pathHeight) },
        restore() { clipHeight = clips.pop() },
        strokeRect(x, y, width, height) { borders.push({ x, y, width, height }) },
        fillRect(x, y, width, height) { fills.push({ x, y, width, height: Math.max(0, Math.min(height, clipHeight - y)), color: this.fillStyle }) },
      }
      const canvas = { width: 0, height: 0, getContext: () => ctx }
      taro.createSelectorQuery = () => ({
        select: () => ({ fields: () => ({ exec: done => done([{ node: canvas }]) }) }),
      })
      const height = 210 * ratio
      const options = { axes: true, axisPad: 20, scale, bufferCssHeight: height, showCodes: true }
      const dimensions = [Math.round(250 * scale), Math.round((height + 40) * scale)]
      for (const columns of [20, 21, 38, 41, ...Array.from({ length: 97 }, (_, index) => index + 8), 20]) {
        fills.length = borders.length = 0
        const px = 210 / columns
        const rows = Math.floor(columns * ratio)
        const row = columns % 21
        await drawCells('redraw-check', cells, palette, row, 0, columns, px, rows, options)
        assert.deepEqual([canvas.width, canvas.height], dimensions, 'zooming must keep the bitmap size stable')
        const sampleY = height - 0.01
        const sample = fills.filter(rect => rect.x <= 5 && 5 < rect.x + rect.width && rect.y <= sampleY && sampleY < rect.y + rect.height).at(-1)
        assert.equal(sample?.color, palette[(row + Math.ceil(columns * ratio - 1e-9) - 1) % 2].hex, `ratio ${ratio}, columns ${columns}: the bottom must show the correct row`)
        const cellFills = fills.filter(rect => palette.some(color => color.hex === rect.color))
        assert.ok(cellFills.every(rect => rect.y + rect.height <= height + 1e-9), 'cells must not spill into the bottom axis')
        assert.deepEqual([borders.at(-2)?.x, borders.at(-2)?.y, borders.at(-2)?.height], [0, 0, height], 'the inner border must stay fixed')
        assert.ok(Math.abs(borders.at(-2)?.width - 210) < 1e-9, 'the inner border width must stay fixed')
        assert.equal(borders.at(-1)?.height, height + 39, 'the outer border must stay fixed')
        assert.equal(clips.length, 0, 'each redraw must restore its clipping region')
      }
      await drawCells('export-check', cells.slice(0, 78).map(row => row.slice(0, 78)), palette, 0, 0, 78, 20, 78, { axes: true, scale: 1 })
      assert.deepEqual([canvas.width, canvas.height], [1632, 1632], 'full-pattern exports must keep their original dimensions')
    }
  }
})

test('stage data URLs are materialized as local files', async () => {
  const result = normalizeConversion(response('subject_cartoon'))
  result.images = {
    original: 'data:image/png;base64,b3JpZ2luYWw=',
    ai: 'data:image/png;base64,YWk=',
    subject: 'data:image/png;base64,c3ViamVjdA==',
  }
  const local = await materializePreviews(result)
  for (const [kind, value] of Object.entries(local.images)) {
    assert.ok(value.startsWith('/user/perlabo-mock-task-'), `${kind} stage should be local`)
    assert.equal(files.get(value).encoding, 'base64')
  }
})

test('clearing local data cancels delayed work writes', async () => {
  clearLocalData()
  const work = {
    id: 'clear-timer', name: 'test', width: 1, height: 1, brand: 'Artkal', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', progress: 0,
    palette: [], cells: [[null]],
  }
  saveWork(work)
  saveWork({ ...getWork(work.id), name: 'queued update' })
  saveEditorHistory(work.id, { undo: [{ row: 0, column: 0, before: null, after: 'H7' }], redo: [] })
  files.set('/user/perlabo-owned.png', { data: 'saved image' })
  clearLocalData()
  assert.equal(files.has('/user/perlabo-owned.png'), false)
  await new Promise(resolve => setTimeout(resolve, 450))
  assert.equal(storage.size, 0)
})

test('cleanup invalidates an in-flight login and conversion', async () => {
  invalidateSession()
  const login = deferred()
  loginImpl = () => login.promise
  const pendingLogin = ensureSession()
  await Promise.resolve()
  clearLocalData()
  login.resolve({ code: 'test-code' })
  await assert.rejects(pendingLogin, /本地数据已清理/)
  assert.equal(storage.has('pindou.session.token'), false)

  loginImpl = async () => ({ code: 'test-code' })
  requestImpl = async () => ({ statusCode: 200, data: { token: 'conversion-token' } })
  await ensureSession()
  const upload = deferred()
  uploadImpl = () => upload.promise
  payload = response('scene_direct')
  const pendingConversion = convertPattern({ filePath: '/temp/photo.jpg', mode: 'scene_direct' })
  await new Promise(resolve => setImmediate(resolve))
  clearLocalData()
  upload.resolve({ statusCode: 200, data: JSON.stringify(payload) })
  await assert.rejects(pendingConversion, /本地数据已清理/)
})

test('failed draft saves throw or show a user-visible error', async () => {
  clearLocalData()
  const work = {
    id: 'failed-save', name: 'test', width: 1, height: 1, brand: 'Artkal', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', progress: 0,
    palette: [], cells: [[null]],
  }
  failStorageWrites = true
  assert.throws(() => saveWork(work), /草稿保存失败/)
  failStorageWrites = false
  clearLocalData()
  saveWork(work)
  saveWork({ ...getWork(work.id), name: 'queued update' })
  failStorageWrites = true
  await new Promise(resolve => setTimeout(resolve, 450))
  failStorageWrites = false
  assert.ok(toasts.some(item => /草稿保存失败/.test(item.title)))
  failStorageWrites = true
  assert.throws(() => deleteWork(work.id), /草稿保存失败/)
  failStorageWrites = false
  assert.ok(getWork(work.id), 'failed deletion must retain the cached work')
})

test('401 retry reuses the same request_id', async () => {
  clearLocalData()
  invalidateSession()
  loginImpl = async () => ({ code: 'test-code' })
  requestImpl = async () => ({ statusCode: 200, data: { token: 'retry-token' } })
  let attempts = 0
  uploadCalls.length = 0
  payload = response('scene_direct')
  uploadImpl = async () => ++attempts === 1
    ? { statusCode: 401, data: JSON.stringify({ detail: 'expired' }) }
    : { statusCode: 200, data: JSON.stringify(payload) }
  await convertPattern({ filePath: '/temp/photo.jpg', mode: 'scene_direct' })
  assert.equal(uploadCalls.length, 2)
  assert.match(uploadCalls[0].formData.request_id, /^request_/)
  assert.equal(uploadCalls[1].formData.request_id, uploadCalls[0].formData.request_id)
})

if (process.env.SHARED_API_RESPONSE_JSON) test('adapter accepts the actual shared FastAPI response', () => {
  const raw = JSON.parse(fs.readFileSync(process.env.SHARED_API_RESPONSE_JSON, 'utf8'))
  const result = materializePreviews(normalizeConversion(raw))
  assert.deepEqual([52, 78, 104].map(size => result.variants[size].cells.length), [52, 78, 104])
  assert.equal(result.aiPasses, 0)
  assert.ok(result.variants[104].previewUrl.startsWith('/user/perlabo-'))
  assert.ok(result.algorithmVersion)
})
