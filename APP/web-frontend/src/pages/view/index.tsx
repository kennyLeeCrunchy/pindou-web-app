import Taro, { useDidHide, useDidShow, useLoad } from '@tarojs/taro'
import { ScrollView, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import type { Work } from '../../shared/types'
import { getWork } from '../../store/works'
import { drawCells, type CellRange } from '../../utils/canvas'
import { createPatternImage, patternExportLayout } from '../../utils/patternExport'
import { canvasCellAt, canvasPointFromClient, type CanvasViewport } from '../../utils/canvasTouch'
import { BRAND_LABEL } from '../../data/palettes'
import { toUserMessage } from '../../utils/error'
import { downloadPatternImage } from '../../utils/album'
import './index.scss'

const INITIAL_EXTENT = 26
const MIN_EXTENT = 8
/* On-screen coordinate strip, drawn inside the canvas by the shared axes code. */
const AXIS_PAD = 20
type Point = { clientX: number; clientY: number }
type Gesture =
  | { mode: 'count'; startRow: number; startColumn: number }
  | { mode: 'pan'; x: number; y: number; row: number; column: number; cellSize: number }
  | { mode: 'pinch'; x: number; y: number; distance: number; row: number; column: number; extent: number }

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))
const distance = (a: Point, b: Point) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
const midpoint = (a: Point, b: Point): Point => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 })
const ROW_RATIO = (isTablet: boolean) => (isTablet ? 1.25 : 1.55)
/* Pan limits use whole rows so the final pattern row can be shown in full. */
const visibleRowsFor = (columns: number, isTablet: boolean) => Math.max(1, Math.floor(columns * ROW_RATIO(isTablet)))

export default function ViewPage() {
  const [work, setWork] = useState<Work>()
  const [extent, setExtent] = useState(INITIAL_EXTENT)
  const [rowStart, setRowStart] = useState(0)
  const [columnStart, setColumnStart] = useState(0)
  const [boardSize, setBoardSize] = useState(290)
  const [pixelDensity, setPixelDensity] = useState(window.devicePixelRatio || 1)
  const [boardMeasured, setBoardMeasured] = useState(false)
  const [isTablet, setIsTablet] = useState(false)
  const [highlightMode, setHighlightMode] = useState(false)
  const [highlightCode, setHighlightCode] = useState('')
  const [countMode, setCountMode] = useState(false)
  const [selection, setSelection] = useState<CellRange>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pageVisible, setPageVisible] = useState(true)
  const workIdRef = useRef('')
  const gesture = useRef<Gesture | null>(null)
  const drawnViewport = useRef<CanvasViewport | null>(null)
  const lastMoveAt = useRef(0)
  const visibleRows = visibleRowsFor(extent, isTablet)
  const renderedRows = Math.ceil(extent * ROW_RATIO(isTablet) - 1e-9)

  const reload = (id = workIdRef.current) => {
    if (!id) return
    setWork(getWork(id))
  }
  useLoad(({ id }) => {
    const decodedId = id ? decodeURIComponent(id) : ''
    workIdRef.current = decodedId
    reload(decodedId)
  })
  useDidShow(() => { setPageVisible(true); reload() })
  useDidHide(() => {
    setPageVisible(false)
    gesture.current = null
    drawnViewport.current = null
  })

  useEffect(() => {
    const updateViewport = (width: number) => {
      const tablet = width >= 700
      setIsTablet(tablet)
      gesture.current = null
    }
    updateViewport(window.innerWidth)
    const onResize = () => { setPixelDensity(window.devicePixelRatio || 1); updateViewport(window.innerWidth) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    setBoardMeasured(false)
    if (!work || !pageVisible) return
    const canvas = document.getElementById('view-canvas')
    if (!canvas) return
    let lastWidth = 0
    const measure = () => {
      const width = canvas.getBoundingClientRect().width - AXIS_PAD * 2
      if (width <= 0 || Math.abs(width - lastWidth) < 0.01) return
      lastWidth = width
      drawnViewport.current = null
      gesture.current = null
      setBoardSize(width)
      setBoardMeasured(true)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [work?.id, pageVisible])

  useEffect(() => {
    if (!work || !pageVisible) return
    setExtent(Math.min(INITIAL_EXTENT, work.width))
    setRowStart(0)
    setColumnStart(0)
    setHighlightCode(work.palette[0]?.code || '')
  }, [work?.id])

  useEffect(() => {
    drawnViewport.current = null
    if (!work || !pageVisible || !boardMeasured) return
    let cancelled = false
    const maxRowStart = Math.max(0, work.height - visibleRows)
    const maxColumnStart = Math.max(0, work.width - extent)
    if (rowStart > maxRowStart) setRowStart(maxRowStart)
    if (columnStart > maxColumnStart) setColumnStart(maxColumnStart)
    const view = { rowStart, columnStart, columns: extent, width: boardSize, height: boardSize * ROW_RATIO(isTablet), axisPad: AXIS_PAD }
    void drawCells('view-canvas', work.cells, work.palette, rowStart, columnStart, extent, boardSize / extent, visibleRows, {
      showCodes: true,
      axes: true,
      axisPad: AXIS_PAD,
      bufferCssHeight: view.height,
      highlightCode: highlightMode ? highlightCode : undefined,
      selection,
    }).then(node => { if (!cancelled && node) drawnViewport.current = view }).catch(reason => {
      if (!cancelled) setError(toUserMessage(reason))
    })
    return () => { cancelled = true }
  }, [work, pageVisible, boardMeasured, rowStart, columnStart, extent, boardSize, visibleRows, isTablet, pixelDensity, highlightMode, highlightCode, selection])

  if (!work) return <View className='viewer-state'><Text>作品不存在或已被删除</Text><button type='button' className='viewer-back-button' onClick={() => Taro.navigateBack()}>返回</button></View>

  const maxExtent = work.width
  const minExtent = Math.min(MIN_EXTENT, maxExtent)
  const exportLayout = patternExportLayout(work)
  const selectedCount = selection
    ? selection.direction === 'row'
      ? Math.abs(selection.endColumn - selection.startColumn) + 1
      : Math.abs(selection.endRow - selection.startRow) + 1
    : 0
  const selectedBeads = (() => {
    if (!selection) return 0
    let count = 0
    if (selection.direction === 'row') {
      const row = work.cells[selection.startRow] || []
      for (let column = Math.min(selection.startColumn, selection.endColumn); column <= Math.max(selection.startColumn, selection.endColumn); column++) {
        if (row[column]) count++
      }
    } else {
      for (let row = Math.min(selection.startRow, selection.endRow); row <= Math.max(selection.startRow, selection.endRow); row++) {
        if (work.cells[row]?.[selection.startColumn]) count++
      }
    }
    return count
  })()

  const zoom = (next: number) => {
    const size = Math.max(minExtent, Math.min(maxExtent, Math.round(next)))
    const nextRows = visibleRowsFor(size, isTablet)
    const centerRow = rowStart + visibleRows / 2
    const centerColumn = columnStart + extent / 2
    setExtent(size)
    setRowStart(clamp(Math.round(centerRow - nextRows / 2), Math.max(0, work.height - nextRows)))
    setColumnStart(clamp(Math.round(centerColumn - size / 2), Math.max(0, work.width - size)))
  }

  const cellAt = (point: Point) => {
    const rect = document.getElementById('view-canvas')?.getBoundingClientRect()
    const view = drawnViewport.current
    return rect && view ? canvasCellAt(canvasPointFromClient(point, rect), view) : undefined
  }

  const touchStart = (event: any) => {
    if (!drawnViewport.current) return
    const points = event.touches as Point[]
    if (points?.length >= 2) {
      const center = midpoint(points[0], points[1])
      gesture.current = { mode: 'pinch', x: center.clientX, y: center.clientY, distance: distance(points[0], points[1]), row: rowStart, column: columnStart, extent }
      return
    }
    if (points?.length !== 1) return
    if (countMode) {
      const cell = cellAt(points[0])
      if (!cell || cell.row >= work.height || cell.column >= work.width) return
      gesture.current = { mode: 'count', startRow: cell.row, startColumn: cell.column }
      setSelection({ startRow: cell.row, startColumn: cell.column, endRow: cell.row, endColumn: cell.column, direction: 'row' })
    } else {
      gesture.current = { mode: 'pan', x: points[0].clientX, y: points[0].clientY, row: rowStart, column: columnStart, cellSize: boardSize / extent }
    }
  }

  const throttled = () => {
    const now = Date.now()
    if (now - lastMoveAt.current < 16) return false
    lastMoveAt.current = now
    return true
  }
  const touchMove = (event: any) => {
    const points = event.touches as Point[]
    const active = gesture.current
    if (points?.length >= 2) {
      if (!active || active.mode !== 'pinch') {
        touchStart(event)
        return
      }
      if (!throttled()) return
      const center = midpoint(points[0], points[1])
      const currentDistance = distance(points[0], points[1])
      const size = currentDistance >= 10 && active.distance >= 10
        ? Math.max(minExtent, Math.min(maxExtent, Math.round(active.extent * active.distance / currentDistance)))
        : active.extent
      const nextRows = visibleRowsFor(size, isTablet)
      const dx = center.clientX - active.x
      const dy = center.clientY - active.y
      const cellSize = boardSize / active.extent
      setExtent(size)
      setRowStart(clamp(Math.round(active.row + (visibleRowsFor(active.extent, isTablet) - nextRows) / 2 - dy / cellSize), Math.max(0, work.height - nextRows)))
      setColumnStart(clamp(Math.round(active.column + (active.extent - size) / 2 - dx / cellSize), Math.max(0, work.width - size)))
      return
    }
    if (points?.length !== 1 || !active) return
    if (active.mode === 'pan') {
      if (!throttled()) return
      const dx = points[0].clientX - active.x
      const dy = points[0].clientY - active.y
      setRowStart(clamp(Math.round(active.row - dy / active.cellSize), Math.max(0, work.height - visibleRows)))
      setColumnStart(clamp(Math.round(active.column - dx / active.cellSize), Math.max(0, work.width - extent)))
      return
    }
    if (active.mode !== 'count') return
    const cell = cellAt(points[0])
    if (!cell) return
    const row = Math.min(work.height - 1, cell.row)
    const column = Math.min(work.width - 1, cell.column)
    const dx = Math.abs(column - active.startColumn)
    const dy = Math.abs(row - active.startRow)
    const direction = dx >= dy ? 'row' : 'column'
    const endRow = direction === 'row' ? active.startRow : row
    const endColumn = direction === 'row' ? column : active.startColumn
    setSelection({ startRow: active.startRow, startColumn: active.startColumn, endRow, endColumn, direction })
  }

  const touchEnd = (event: any = { touches: [] }) => {
    if (event.touches?.length) { touchStart(event); return }
    gesture.current = null
  }

  const toggleHighlight = () => {
    const enabled = !highlightMode
    setHighlightMode(enabled)
    if (enabled && !highlightCode) setHighlightCode(work.palette[0]?.code || '')
  }

  const toggleCountMode = () => {
    const enabled = !countMode
    setCountMode(enabled)
    setSelection(undefined)
    gesture.current = null
  }

  const exportImage = async () => {
    setBusy(true)
    setError('')
    try {
      await new Promise<void>(resolve => Taro.nextTick(() => resolve()))
      const imagePath = await createPatternImage('view-export-canvas', work)
      if (!await downloadPatternImage(imagePath)) return
      await Taro.showToast({ title: '已开始下载', icon: 'success' })
    } catch (reason) { setError(toUserMessage(reason)) }
    finally { setBusy(false) }
  }

  return <View className='viewer'>
    <View className='viewer-heading'>
      <Text className='viewer-kicker'>拼豆看图 · 只读</Text>
      <Text className='viewer-title'>{work.name}</Text>
      <Text className='viewer-meta'>{work.width} × {work.height} · {exportLayout.colors.length} 色 · 放大后查看格内色号</Text>
    </View>

    <View className='viewer-tools'>
      <button type='button' className={`viewer-tool ${highlightMode ? 'active' : ''}`} onClick={toggleHighlight}>同色高亮{highlightMode ? '·开' : ''}</button>
      <button type='button' className={`viewer-tool ${countMode ? 'active' : ''}`} onClick={toggleCountMode}>数格子{countMode ? '·开' : ''}</button>
    </View>

    {highlightMode && <ScrollView scrollX className='viewer-palette'>
      <View className='viewer-palette__row'>
        {work.palette.map(item => <View key={item.code} className={`viewer-color ${highlightCode === item.code ? 'active' : ''}`} onClick={() => setHighlightCode(item.code)}>
          <View className='viewer-color__dot' style={{ backgroundColor: item.hex }} /><Text>{item.code}</Text>
        </View>)}
      </View>
    </ScrollView>}

    {countMode && <View className='count-instruction'>
      {selection ? <Text>已选 {selectedCount} 格 · 其中有豆 {selectedBeads} 颗</Text> : <Text>在图纸上按住并拖动，选出一行或一列</Text>}
    </View>}

    {pageVisible && <View className='viewer-board-wrap'>
      <canvas id='view-canvas' className='viewer-canvas' style={{ width: '100%', height: `${boardSize * ROW_RATIO(isTablet) + AXIS_PAD * 2}px` }} onMouseDown={event => { event.preventDefault(); touchStart({ touches: [event] }) }} onMouseMove={event => { if (event.buttons === 1) touchMove({ touches: [event] }) }} onMouseUp={() => touchEnd()} onMouseLeave={() => touchEnd()} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={() => { gesture.current = null }} />
    </View>}

    <View className='viewer-controls'>
      <button type='button' className='web-icon-button' disabled={extent >= maxExtent} onClick={() => zoom(extent * 1.45)} aria-label='缩小'><View className='pixel-glyph pixel-glyph--minus' /></button>
      <Text>{rowStart + 1}–{Math.min(work.height, rowStart + renderedRows)} 行 · {columnStart + 1}–{Math.min(work.width, columnStart + extent)} 列</Text>
      <button type='button' className='web-icon-button' disabled={extent <= minExtent} onClick={() => zoom(extent / 1.45)} aria-label='放大'><View className='pixel-glyph pixel-glyph--plus' /></button>
    </View>
    <Text className='viewer-hint'>{countMode ? '单指拖动选格 · 双指平移或缩放' : '单指平移 · 双指缩放 · 用两侧坐标定位'}</Text>

    <View className='viewer-usage'>
      <Text className='viewer-usage__title'>颜色用量</Text>
      <Text className='viewer-usage__meta'>{BRAND_LABEL[work.brand] || work.brand} · {exportLayout.colors.length} 色 · 共 {exportLayout.beads} 颗</Text>
      <View className='viewer-usage__grid'>{exportLayout.colors.map(color => <View key={color.code} className='viewer-usage__item'>
        <View className='viewer-usage__swatch' style={{ backgroundColor: color.hex }} />
        <View className='viewer-usage__label'><Text className='viewer-usage__code'>{color.code}</Text><Text className='viewer-usage__series'>{color.series ? `${color.series}系` : '未标记'}</Text></View>
        <Text className='viewer-usage__count'>{color.count} 颗</Text>
      </View>)}</View>
      {!exportLayout.colors.length && <Text className='viewer-usage__meta'>暂无用色</Text>}
    </View>

    {error && <Text className='viewer-error'>{error}</Text>}
    <View className='viewer-actions'><button type='button' className='raised-button' disabled={busy} onClick={exportImage}>保存带色号图纸</button></View>
    {pageVisible && busy && <canvas id='view-export-canvas' className='viewer-export-canvas' style={{ width: `${exportLayout.width}px`, height: `${exportLayout.height}px` }} />}
  </View>
}
