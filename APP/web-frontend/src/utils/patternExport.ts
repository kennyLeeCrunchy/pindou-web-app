import { canvasImage } from './browserImage'
import { BRAND_COLORS, BRAND_LABEL } from '../data/palettes'
import type { PatternCount, Work } from '../shared/types'
import { countCells } from './pattern'
import { axisPadFor, drawCells } from './canvas'

type ExportPattern = Pick<Work, 'width' | 'height' | 'cells' | 'palette' | 'brand'>
export type UsageColor = PatternCount & { series: string }

/** Counts come from current cells; series labels come from the selected brand's card. */
export function patternColorUsage(pattern: ExportPattern): UsageColor[] {
  const card = new Map((BRAND_COLORS[pattern.brand] || []).map(color => [color.code, color.series]))
  return countCells(pattern.cells, pattern.palette).map(color => ({ ...color, series: card.get(color.code) || '' }))
    .sort((a, b) => a.series.localeCompare(b.series) || a.code.localeCompare(b.code, 'en', { numeric: true }))
}

export function patternExportLayout(pattern: ExportPattern) {
  const colors = patternColorUsage(pattern)
  const cellSize = Math.max(12, Math.min(30, Math.floor(1560 / Math.max(pattern.width, pattern.height, 1))))
  const pad = axisPadFor(cellSize)
  const diagramWidth = pattern.width * cellSize + pad * 2
  const diagramHeight = pattern.height * cellSize + pad * 2
  const columns = colors.length > 64 ? 12 : 8
  const rows = Math.max(1, Math.ceil(colors.length / columns))
  const margin = 48, headerHeight = 88, legendHeader = 64, rowHeight = 56
  const requiredHeight = margin * 2 + headerHeight + diagramHeight + 32 + legendHeader + rows * rowHeight
  // Integer dimensions always preserve width:height = 4:3; many colors expand the paper.
  const height = Math.ceil(Math.max(2400, requiredHeight, (diagramWidth + margin * 2) * 3 / 4) / 3) * 3
  const width = height / 3 * 4
  return {
    width, height, cellSize, colors, columns, rows, margin, rowHeight,
    diagramLeft: (width - diagramWidth) / 2, diagramTop: margin + headerHeight,
    legendTop: height - margin - rows * rowHeight - legendHeader, legendHeader,
    beads: colors.reduce((sum, color) => sum + color.count, 0),
  }
}

/** All three save-image actions use the same full-pattern paper and live legend. */
export async function createPatternImage(canvasId: string, pattern: ExportPattern): Promise<string> {
  const layout = patternExportLayout(pattern)
  const canvas = await drawCells(canvasId, pattern.cells, pattern.palette, 0, 0, pattern.width, layout.cellSize, pattern.height, {
    showGrid: true, showCodes: true, axes: true, scale: 1,
    sheet: { width: layout.width, height: layout.height, left: layout.diagramLeft, top: layout.diagramTop },
  })
  if (!canvas) throw new Error('图纸画布尚未就绪，请重试')
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#4a3229'
  ctx.font = 'bold 38px sans-serif'
  ctx.fillText(`${BRAND_LABEL[pattern.brand] || pattern.brand} · 拼豆图纸`, layout.width / 2, 62)
  ctx.font = '24px sans-serif'
  ctx.fillStyle = '#7b6257'
  ctx.fillText(`${pattern.width} × ${pattern.height} 格 · ${layout.colors.length} 色 · 共 ${layout.beads} 颗`, layout.width / 2, 106)

  ctx.strokeStyle = '#dcc5b2'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(layout.margin, layout.legendTop)
  ctx.lineTo(layout.width - layout.margin, layout.legendTop)
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillStyle = '#4a3229'
  ctx.fillText('颜色用量 · 色号 / 色系 / 颗数', layout.margin, layout.legendTop + 32)
  const itemWidth = (layout.width - layout.margin * 2) / layout.columns
  layout.colors.forEach((color, index) => {
    const x = layout.margin + index % layout.columns * itemWidth
    const y = layout.legendTop + layout.legendHeader + Math.floor(index / layout.columns) * layout.rowHeight
    ctx.fillStyle = '#faf7f2'
    ctx.fillRect(x, y, itemWidth - 12, 52)
    ctx.fillStyle = color.hex
    ctx.fillRect(x + 12, y + 12, 28, 28)
    ctx.strokeStyle = '#bca99b'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 12, y + 12, 28, 28)
    ctx.textAlign = 'left'
    ctx.font = 'bold 26px sans-serif'
    ctx.fillStyle = '#4a3229'
    ctx.fillText(color.code, x + 52, y + 18)
    ctx.font = '18px sans-serif'
    ctx.fillStyle = '#7b6257'
    ctx.fillText(color.series ? `${color.series}系` : '未标记', x + 52, y + 43)
    ctx.textAlign = 'right'
    ctx.font = '26px sans-serif'
    ctx.fillStyle = '#4a3229'
    ctx.fillText(`${color.count} 颗`, x + itemWidth - 26, y + 27)
  })
  if (!layout.colors.length) {
    ctx.textAlign = 'left'; ctx.font = '24px sans-serif'; ctx.fillStyle = '#7b6257'
    ctx.fillText('暂无用色', layout.margin, layout.legendTop + layout.legendHeader + 28)
  }
  const image = canvasImage(canvas)
  return image.tempFilePath
}
