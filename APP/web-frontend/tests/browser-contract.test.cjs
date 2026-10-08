const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const storage = new Map()
const taro = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
  removeStorageSync: key => storage.delete(key), clearStorageSync: () => storage.clear(),
  showToast: async () => {},
}
const load = Module._load
Module._load = function (request, parent, isMain) {
  return request === '@tarojs/taro' ? { __esModule: true, default: taro } : load.call(this, request, parent, isMain)
}
require.extensions['.ts'] = function (module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename)
}
const api = require('../src/services/api.ts')
const { clearLocalData } = require('../src/utils/localData.ts')
const { saveLatestPattern, getLatestPattern } = require('../src/utils/pattern.ts')
const { editCell } = require('../src/utils/edit.ts')
const { saveWork, getWork, flushWorks } = require('../src/store/works.ts')
const nativeFetch = global.fetch
const png = 'data:image/png;base64,aGVsbG8='
const calls = []
let reply
global.fetch = async (url, init) => {
  if (url.startsWith('data:')) return nativeFetch(url)
  calls.push({ url, init })
  return reply(url, init)
}
const response = (mode = 'scene_direct') => ({
  task_id: 'test-pattern', mode, brand: 'Artkal', ai_passes: 0,
  variants: [52, 78, 104].map(size => ({ width: size, height: size,
    cells: Array.from({ length: size }, () => Array(size).fill('R1')),
    counts: [{ code: 'R1', name: 'red', hex: '#ff0000', count: size * size }], preview_data_url: png,
  })),
})
test('browser upload uses same-origin multipart with a valid filename, without a model key or WX session', async () => {
  calls.length = 0
  reply = async () => Response.json(response())
  const result = await api.convertPattern({ filePath: png, mode: 'scene_direct' })
  assert.equal(calls[0].url, '/api/pattern/convert')
  assert.deepEqual(calls[0].init.headers, { 'X-Pindou-Local': '1' })
  const form = calls[0].init.body
  assert.equal(form.get('image').name, 'image.png')
  assert.equal(form.get('max_colors'), '24')
  assert.match(form.get('request_id'), /^[A-Za-z0-9_-]{16,80}$/)
  assert.equal(result.variants[104].cells.length, 104)
})
test('color changes reuse prepared pixels and never trigger a second AI pass', async () => {
  calls.length = 0
  reply = async url => Response.json(url.endsWith('/prepare') ? {
    phase: 'prepared', task_id: 'prepared', mode: 'subject_cartoon', ai_passes: 1,
    framing_mode: 'pendant', prepared_image_url: png, raw_image_url: png, ai_image_url: png,
  } : response('cartoon_direct'))
  const prepared = await api.preparePattern({ filePath: png, mode: 'subject_cartoon' })
  const result = await api.completePreparedPattern(prepared, { maxColors: 32, brand: 'Mard' })
  assert.deepEqual(calls.map(call => call.init.body.get('mode')), ['subject_cartoon', 'cartoon_direct'])
  assert.equal(calls[1].init.body.get('max_colors'), '32')
  assert.equal(result.mode, 'subject_cartoon')
  assert.equal(result.aiPasses, 1)
})
test('API errors do not silently retry a potentially paid request', async () => {
  calls.length = 0
  reply = async () => Response.json({ detail: '模型配置缺失' }, { status: 503 })
  await assert.rejects(api.preparePattern({ filePath: png, mode: 'subject_cartoon' }), /模型配置缺失/)
  assert.equal(calls.length, 1)
})
test('incomplete tiers and unsupported browser images cannot be successful conversions', async () => {
  const raw = response(); raw.variants.pop()
  assert.throws(() => api.normalizeConversion(raw), /104×104/)
  await assert.rejects(api.convertPattern({ filePath: 'wxfile://old.png', mode: 'scene_direct' }), /图片格式无效/)
})
test('clearing data invalidates in-flight responses and removes transient previews', async () => {
  let resolve
  reply = async () => new Promise(done => { resolve = done })
  const pending = api.convertPattern({ filePath: png, mode: 'scene_direct' })
  while (!resolve) await new Promise(done => setImmediate(done))
  saveLatestPattern(response())
  clearLocalData()
  resolve(Response.json(response()))
  await assert.rejects(pending, /本地数据已清理/)
  assert.equal(getLatestPattern(), undefined)
})
test('saved cell edits survive reopening and leave other sizes unchanged', () => {
  clearLocalData()
  const work = { id: 'edit-52', name: 'test', width: 1, height: 1, brand: 'Artkal', status: 'draft',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: 0,
    palette: [{ code: 'R1', name: 'red', hex: '#ff0000', count: 1 }], cells: [['R1']],
  }
  saveWork(work); saveWork({ ...work, id: 'edit-78' })
  saveWork(editCell(getWork('edit-52'), 0, 0, null)); flushWorks()
  assert.equal(getWork('edit-52').cells[0][0], null)
  assert.equal(getWork('edit-78').cells[0][0], 'R1')
})

test('52/78/104 previews keep white empty cells and a five-cell grid at narrow browser widths', async () => {
  const { drawCells } = require('../src/utils/canvas.ts')
  const previousDocument = global.document
  const previousCanvas = global.HTMLCanvasElement
  try {
    for (const [size, px] of [[52, 5], [78, 3], [104, 2]]) {
      const fills = [], strokes = []
      let lines = []
      const ctx = {
        setTransform() {}, translate() {}, save() {}, restore() {}, rect() {}, clip() {},
        fillRect(...rect) { fills.push({ color: this.fillStyle, rect }) },
        beginPath() { lines = [] },
        moveTo(x, y) { lines.push([x, y]) }, lineTo() {},
        stroke() { strokes.push({ width: this.lineWidth, lines: [...lines] }) },
      }
      class Canvas { width = 0; height = 0; getContext() { return ctx } }
      const canvas = new Canvas()
      global.HTMLCanvasElement = Canvas
      global.document = { getElementById: () => canvas }
      const cells = Array.from({ length: size }, () => Array(size).fill(null))
      cells[1][2] = 'H7'
      await drawCells('preview', cells, [{ code: 'H7', hex: '#123456' }], 0, 0, size, px, size, { showGrid: true, scale: 2 })
      assert.deepEqual([canvas.width, canvas.height], [size * px * 2, size * px * 2])
      assert.deepEqual(fills[0], { color: '#ffffff', rect: [0, 0, size * px, size * px] })
      assert.deepEqual(fills[1], { color: '#123456', rect: [2 * px, px, px, px] })
      assert.equal(strokes.length, 2)
      assert.equal(strokes.reduce((sum, stroke) => sum + stroke.lines.length, 0), 2 * (size + 1))
      assert.equal(strokes[1].width, 1)
      assert.equal(strokes[1].lines.length, 2 * (Math.floor(size / 5) + 1))
      assert.ok(strokes[1].lines.some(([x, y]) => x === 5 * px && y === 0))
      assert.ok(strokes[1].lines.some(([x, y]) => x === 0 && y === 5 * px))
    }
  } finally {
    global.document = previousDocument
    global.HTMLCanvasElement = previousCanvas
  }
})

test('canvas hits use local CSS coordinates and exclude axes after scroll, zoom and pan', () => {
  const { canvasCellAt, canvasPointFromClient } = require('../src/utils/canvasTouch.ts')
  for (const top of [140, 40, -90]) for (const columns of [20, 30, 13]) {
    const view = { rowStart: 8, columnStart: 5, columns, width: 319, height: 398.75, axisPad: 20 }
    const px = view.width / columns
    const rect = { left: 18, top }
    const point = canvasPointFromClient({ clientX: rect.left + 20 + 3.5 * px, clientY: top + 20 + 4.5 * px }, rect)
    assert.deepEqual(canvasCellAt(point, view), { row: 12, column: 8 })
    for (const point of [{ x: 19, y: 100 }, { x: 100, y: 19 }, { x: 339, y: 100 }, { x: 100, y: 418.75 }, { x: NaN, y: 100 }]) {
      assert.equal(canvasCellAt(point, view), undefined)
    }
    const bottom = canvasCellAt({ x: 338.99, y: 418.74 }, view)
    assert.equal(bottom.column, 5 + columns - 1)
    assert.equal(bottom.row, 8 + Math.floor((418.74 - 20) / px))
  }
})

test('export uses live counts and brand series, preserving complete grid and legend in 4:3 paper', async () => {
  const { patternExportLayout, patternColorUsage, createPatternImage } = require('../src/utils/patternExport.ts')
  const { BRAND_COLORS } = require('../src/data/palettes.ts')
  const make = (size, colors) => ({ width: size, height: size, brand: 'Mard',
    palette: colors.map(color => ({ ...color, count: 999 })),
    cells: Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) =>
      row * size + column < colors.length ? colors[row * size + column].code : null)),
  })
  for (const size of [52, 78, 104]) for (const amount of [0, 2, 64, 221]) {
    const pattern = make(size, BRAND_COLORS.Mard.slice(0, amount))
    const layout = patternExportLayout(pattern)
    assert.equal(layout.width * 3, layout.height * 4)
    assert.equal(layout.beads, amount)
    assert.equal(layout.colors.length, amount)
    assert.ok(layout.diagramTop + size * layout.cellSize + 2 * Math.max(18, Math.round(layout.cellSize * 1.8)) < layout.legendTop)
    assert.ok(layout.legendTop + layout.legendHeader + layout.rows * layout.rowHeight <= layout.height - layout.margin)
  }
  const pattern = make(52, BRAND_COLORS.Mard.slice(0, 3))
  pattern.cells[0][1] = pattern.cells[0][0]
  pattern.cells[0][2] = null
  assert.deepEqual(patternColorUsage(pattern).map(color => [color.code, color.series, color.count]), [['A1', 'A', 2]])
  const labels = []
  const ctx = { setTransform() {}, translate() {}, save() {}, restore() {}, rect() {}, clip() {}, fillRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillText(text) { labels.push(text) } }
  class Canvas { width = 0; height = 0; getContext() { return ctx }; toDataURL() { return png } }
  const canvas = new Canvas()
  const previousDocument = global.document, previousCanvas = global.HTMLCanvasElement
  try {
    global.HTMLCanvasElement = Canvas
    global.document = { getElementById: () => canvas }
    assert.equal(await createPatternImage('paper', pattern), png)
    assert.deepEqual([canvas.width, canvas.height], [3200, 2400])
    assert.ok(labels.includes('Mard · 拼豆图纸'))
    assert.ok(labels.includes('A1') && labels.includes('A系') && labels.includes('2 颗'))
    assert.ok(!labels.includes('999 颗') && !labels.includes('A2') && !labels.includes('A3'))
  } finally { global.document = previousDocument; global.HTMLCanvasElement = previousCanvas }
})
