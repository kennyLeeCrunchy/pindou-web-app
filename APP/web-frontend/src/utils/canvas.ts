import Taro from '@tarojs/taro'
import type { PatternCount } from '../shared/types'

export interface CellRange {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
  direction: 'row' | 'column'
}

export interface DrawCellsOptions {
  showCodes?: boolean
  highlightCode?: string
  selection?: CellRange
  axes?: boolean
  /* Buffer = css size × scale; exports pass 1 because their cellSize already targets output pixels. */
  scale?: number
  /* On-screen axis strip width in css px; defaults to the print-sized export pad. */
  axisPad?: number
  /* Fixed viewport height; draw and clip any partial bottom row without stretching cells. */
  bufferCssHeight?: number
}

export const axisPadFor = (cellSize: number) => Math.max(18, Math.round(cellSize * 1.8))

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

let pixelRatio: number | undefined
function dpr(): number {
  if (!pixelRatio) {
    try { pixelRatio = Taro.getWindowInfo().pixelRatio || 2 } catch { pixelRatio = 2 }
  }
  return pixelRatio
}

/* type='2d' canvas node via one selector query per redraw — the legacy
   interface paid one JS->native bridge call per draw primitive (thousands per
   frame), which is what made redraws crawl. The first query can race the
   mount, so retry once. */
function canvasNode(id: string): Promise<any | undefined> {
  const grab = () => new Promise<any>(resolve =>
    Taro.createSelectorQuery().select(`#${id}`).fields({ node: true }).exec((result: any) => resolve(result?.[0]?.node)))
  return grab().then(node => node || new Promise<void>(resolve => setTimeout(resolve, 50)).then(grab))
}

/* Redraws go through an async node query, so two overlapping calls can finish
   out of order and a stale frame would paint over a newer one (visible as
   flicker / content jumping backwards while panning). Last call wins. */
const drawSequence = new Map<string, number>()

export function clearCanvasCache() {
  for (const [id, sequence] of drawSequence) drawSequence.set(id, sequence + 1)
  pixelRatio = undefined
}

function codeColor(hex: string | undefined): string {
  const match = hex?.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!match) return 'rgba(75,68,62,0.54)'
  const [, red, green, blue] = match
  const luminance = (Number.parseInt(red, 16) * 0.2126 + Number.parseInt(green, 16) * 0.7152 + Number.parseInt(blue, 16) * 0.0722) / 255
  return luminance < 0.38 ? 'rgba(245,242,238,0.62)' : 'rgba(70,64,58,0.54)'
}

/** Draws one frame and returns the canvas node (pass it to canvasToTempFilePath). */
export async function drawCells(
  canvasId: string,
  cells: (string | null)[][],
  palette: PatternCount[],
  fromRow = 0,
  fromColumn = 0,
  extent = cells.length,
  cellSize = 6,
  rowCount = extent,
  options: DrawCellsOptions = {},
): Promise<any | undefined> {
  const token = (drawSequence.get(canvasId) || 0) + 1
  drawSequence.set(canvasId, token)
  const canvas = await canvasNode(canvasId)
  if (!canvas) return undefined
  if (drawSequence.get(canvasId) !== token) return undefined
  const pad = options.axes ? (options.axisPad ?? axisPadFor(cellSize)) : 0
  const scale = options.scale ?? dpr()
  const cssWidth = extent * cellSize
  const cssHeight = options.bufferCssHeight ?? rowCount * cellSize
  if (options.bufferCssHeight !== undefined) rowCount = Math.ceil(cssHeight / cellSize - 1e-9)
  const bufferWidth = Math.round((cssWidth + pad * 2) * scale)
  const bufferHeight = Math.round((cssHeight + pad * 2) * scale)
  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth
    canvas.height = bufferHeight
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  if (pad) ctx.translate(pad, pad)
  const colors = new Map(palette.map(item => [item.code, item.hex]))

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, cssWidth, cssHeight)
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  /* Clear the entire viewport before painting, including its partial last row. */
  ctx.fillRect(0, 0, cssWidth, cssHeight)
  for (let y = 0; y < rowCount; y++) {
    const row = cells[fromRow + y]
    if (!row) break
    let x = 0
    while (x < extent) {
      const code = row[fromColumn + x]
      let end = x + 1
      while (end < extent && row[fromColumn + end] === code) end++
      if (code) {
        ctx.fillStyle = colors.get(code) || '#ffffff'
        ctx.fillRect(x * cellSize, y * cellSize, (end - x) * cellSize, cellSize)
        if (options.highlightCode && options.highlightCode !== code) {
          ctx.fillStyle = 'rgba(255,255,255,0.72)'
          ctx.fillRect(x * cellSize, y * cellSize, (end - x) * cellSize, cellSize)
        }
      }
      x = end
    }
  }

  const selectionTop = options.selection && Math.min(options.selection.startRow, options.selection.endRow)
  const selectionBottom = options.selection && Math.max(options.selection.startRow, options.selection.endRow)
  const selectionLeft = options.selection && Math.min(options.selection.startColumn, options.selection.endColumn)
  const selectionRight = options.selection && Math.max(options.selection.startColumn, options.selection.endColumn)
  const selectionVisible = !!options.selection && selectionBottom! >= fromRow && selectionTop! < fromRow + rowCount &&
    selectionRight! >= fromColumn && selectionLeft! < fromColumn + extent
  const visibleSelection = selectionVisible ? {
    startRow: clamp(selectionTop! - fromRow, 0, rowCount - 1),
    endRow: clamp(selectionBottom! - fromRow, 0, rowCount - 1),
    startColumn: clamp(selectionLeft! - fromColumn, 0, extent - 1),
    endColumn: clamp(selectionRight! - fromColumn, 0, extent - 1),
  } : undefined
  if (visibleSelection && options.selection) {
    const left = Math.min(visibleSelection.startColumn, visibleSelection.endColumn) * cellSize
    const top = Math.min(visibleSelection.startRow, visibleSelection.endRow) * cellSize
    const width = (Math.abs(visibleSelection.endColumn - visibleSelection.startColumn) + 1) * cellSize
    const height = (Math.abs(visibleSelection.endRow - visibleSelection.startRow) + 1) * cellSize
    ctx.fillStyle = 'rgba(217,75,69,0.14)'
    ctx.fillRect(left, top, width, height)
  }

  if (cellSize >= 6) {
    const minor: [number, number, number, number][] = []
    const major: [number, number, number, number][] = []
    for (let i = 0; i <= extent; i++) {
      const target = (fromColumn + i) % 5 === 0 ? major : minor
      target.push([i * cellSize, 0, i * cellSize, rowCount * cellSize])
    }
    for (let i = 0; i <= rowCount; i++) {
      const target = (fromRow + i) % 5 === 0 ? major : minor
      target.push([0, i * cellSize, extent * cellSize, i * cellSize])
    }
    for (const [style, width, lines] of [['rgba(80,65,55,0.18)', 0.5, minor], ['rgba(58,48,42,0.5)', 1, major]] as const) {
      if (!lines.length) continue
      ctx.strokeStyle = style
      ctx.lineWidth = width
      ctx.beginPath()
      for (const [x1, y1, x2, y2] of lines) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2) }
      ctx.stroke()
    }
  }

  /* One shared type style for in-cell codes and axis numbers: bold, sized to
     the longest palette code so it keeps ~10% side padding (bold glyphs run
     ~0.66em per character) — a slightly smaller size beats touching the cell
     edge. Axis numbers share the size so both read as one design language. */
  let maxCodeLength = 1
  for (const code of colors.keys()) maxCodeLength = Math.max(maxCodeLength, code.length)
  /* Codes under ~12px are unreadable and cost one fillText per cell — skipped
     entirely while zoomed out. */
  const showCodes = !!options.showCodes && cellSize >= 12
  const labelFont = Math.max(6, Math.min(18, cellSize * 0.55, showCodes ? cellSize * 1.35 / maxCodeLength : 18))

  if (showCodes) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${labelFont}px sans-serif`
    for (let y = 0; y < rowCount; y++) {
      const row = cells[fromRow + y]
      if (!row) break
      for (let x = 0; x < extent; x++) {
        const code = row[fromColumn + x]
        if (!code) continue
        const hex = colors.get(code)
        let textColor = codeColor(hex)
        if (options.highlightCode && options.highlightCode !== code) textColor = 'rgba(70,64,58,0.22)'
        ctx.fillStyle = textColor
        ctx.fillText(code, (x + 0.5) * cellSize, (y + 0.5) * cellSize)
      }
    }
  }

  if (visibleSelection && options.selection) {
    const left = Math.min(visibleSelection.startColumn, visibleSelection.endColumn) * cellSize
    const top = Math.min(visibleSelection.startRow, visibleSelection.endRow) * cellSize
    const width = (Math.abs(visibleSelection.endColumn - visibleSelection.startColumn) + 1) * cellSize
    const height = (Math.abs(visibleSelection.endRow - visibleSelection.startRow) + 1) * cellSize
    const count = options.selection.direction === 'row'
      ? Math.abs(options.selection.endColumn - options.selection.startColumn) + 1
      : Math.abs(options.selection.endRow - options.selection.startRow) + 1
    ctx.strokeStyle = 'rgba(196,55,49,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(left + 1, top + 1, Math.max(0, width - 2), Math.max(0, height - 2))
    const label = `${count}格`
    const labelWidth = Math.max(36, label.length * Math.max(6, Math.min(12, cellSize * 0.65)) + 12)
    const labelHeight = Math.max(18, Math.min(24, cellSize + 8))
    const centerX = clamp(left + width / 2, labelWidth / 2 + 1, extent * cellSize - labelWidth / 2 - 1)
    const centerY = clamp(top + height / 2, labelHeight / 2 + 1, cssHeight - labelHeight / 2 - 1)
    ctx.fillStyle = 'rgba(48,42,39,0.78)'
    ctx.fillRect(centerX - labelWidth / 2, centerY - labelHeight / 2, labelWidth, labelHeight)
    ctx.fillStyle = '#ffffff'
    ctx.font = `${Math.max(10, Math.min(14, cellSize * 0.72))}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, centerX, centerY)
  }
  ctx.restore()

  if (pad) {
    /* Coordinate frame in the same pass as the grid: beige axis strips with
       numbers (every cell while they fit, else 5-step), plus grid/outer
       borders. Labels stop at the pattern bounds; zoomed-out viewports can be
       larger than the work. */
    const gridWidth = cssWidth
    const gridHeight = cssHeight
    const fullRows = Math.min(rowCount, Math.floor(cssHeight / cellSize + 1e-9))
    const bottomAxisY = gridHeight + pad / 2
    const maxRows = cells.length
    const maxColumns = cells[0]?.length || 0
    ctx.fillStyle = '#f2e9e0'
    ctx.fillRect(-pad, -pad, gridWidth + pad * 2, pad)
    ctx.fillRect(-pad, gridHeight, gridWidth + pad * 2, pad)
    ctx.fillRect(-pad, -pad, pad, cssHeight + pad * 2)
    ctx.fillRect(gridWidth, -pad, pad, cssHeight + pad * 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${labelFont}px sans-serif`
    ctx.fillStyle = '#5c5048'
    const showAll = cellSize >= 14
    const firstColumn = fromColumn + 1
    const lastColumn = fromColumn + extent
    const firstRow = fromRow + 1
    const lastRow = fromRow + fullRows
    for (let x = 0; x < extent; x++) {
      const number = fromColumn + x + 1
      if (number <= maxColumns && (number === firstColumn || number === lastColumn || showAll || number % 5 === 0)) {
        ctx.fillText(String(number), (x + 0.5) * cellSize, -pad / 2)
        ctx.fillText(String(number), (x + 0.5) * cellSize, bottomAxisY)
      }
    }
    for (let y = 0; y < fullRows; y++) {
      const number = fromRow + y + 1
      if (number <= maxRows && (number === firstRow || number === lastRow || showAll || number % 5 === 0)) {
        ctx.fillText(String(number), -pad / 2, (y + 0.5) * cellSize)
        ctx.fillText(String(number), gridWidth + pad / 2, (y + 0.5) * cellSize)
      }
    }
    ctx.strokeStyle = 'rgba(58,48,42,0.85)'
    ctx.lineWidth = 2
    ctx.strokeRect(0, 0, gridWidth, gridHeight)
    ctx.strokeStyle = 'rgba(58,48,42,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(-pad + 0.5, -pad + 0.5, gridWidth + pad * 2 - 1, cssHeight + pad * 2 - 1)
  }

  return canvas
}
