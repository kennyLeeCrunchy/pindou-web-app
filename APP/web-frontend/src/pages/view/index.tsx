import Taro, { useDidHide, useDidShow, useLoad } from '@tarojs/taro'
import { Button, Canvas, ScrollView, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import type { Work } from '../../shared/types'
import { getWork } from '../../store/works'
import { drawCells, axisPadFor, type CellRange } from '../../utils/canvas'
import { toUserMessage } from '../../utils/error'
import { saveImageToAlbum } from '../../utils/album'
import './index.scss'

const INITIAL_EXTENT = 26
const MIN_EXTENT = 8
const EXPORT_LIMIT = 1560
/* On-screen coordinate strip, drawn inside the canvas by the shared axes code. */
const AXIS_PAD = 20
type Point = { clientX: number; clientY: number }
type CanvasRect = { left: number; top: number; width: number; height: number }
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
  const canvasRect = useRef<CanvasRect | null>(null)
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
    canvasRect.current = null
  })

  useEffect(() => {
    const updateViewport = (width: number) => {
      const tablet = width >= 700
      setIsTablet(tablet)
      setBoardSize(Math.max(180, Math.min(880, width - (tablet ? 120 : 80))))
    }
    try { updateViewport(Taro.getWindowInfo().windowWidth || Taro.getSystemInfoSync().windowWidth) }
    catch { /* use the initial board size */ }
    const onResize: Taro.onWindowResize.Callback = event => updateViewport(event.size.windowWidth)
    Taro.onWindowResize(onResize)
    return () => Taro.offWindowResize(onResize as unknown as Taro.offWindowResize.Callback)
  }, [])

  useEffect(() => {
    if (!work || !pageVisible) return
    setExtent(Math.min(INITIAL_EXTENT, work.width))
    setRowStart(0)
    setColumnStart(0)
    setHighlightCode(work.palette[0]?.code || '')
  }, [work?.id])

  useEffect(() => {
    if (!work) return
    const maxRowStart = Math.max(0, work.height - visibleRows)
    const maxColumnStart = Math.max(0, work.width - extent)
    if (rowStart > maxRowStart) setRowStart(maxRowStart)
    if (columnStart > maxColumnStart) setColumnStart(maxColumnStart)
    void drawCells('view-canvas', work.cells, work.palette, rowStart, columnStart, extent, boardSize / extent, visibleRows, {
      showCodes: true,
      axes: true,
      axisPad: AXIS_PAD,
      bufferCssHeight: boardSize * ROW_RATIO(isTablet),
      highlightCode: highlightMode ? highlightCode : undefined,
      selection,
    })
  }, [work, pageVisible, rowStart, columnStart, extent, boardSize, visibleRows, highlightMode, highlightCode, selection])

  useEffect(() => {
    if (!pageVisible) return
    Taro.createSelectorQuery().select('#view-canvas').boundingClientRect(rect => {
      if (!rect || Array.isArray(rect)) return
      canvasRect.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }).exec()
  }, [work?.id, pageVisible, boardSize, extent, visibleRows])

  if (!work) return <View className='viewer-state'><Text>作品不存在或已被删除</Text><Button onClick={() => Taro.navigateBack()}>返回</Button></View>

  const maxExtent = work.width
  const minExtent = Math.min(MIN_EXTENT, maxExtent)
  const exportCellSize = Math.max(8, Math.floor(EXPORT_LIMIT / Math.max(work.width, work.height)))
  const exportPad = axisPadFor(exportCellSize)
  const exportWidth = work.width * exportCellSize + exportPad * 2
  const exportHeight = work.height * exportCellSize + exportPad * 2
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

  const cellAt = (point: Point, rect = canvasRect.current) => {
    if (!rect?.width || !rect.height) return undefined
    const cellSize = (rect.width - AXIS_PAD * 2) / extent
    const localColumn = clamp(Math.floor((point.clientX - rect.left - AXIS_PAD) / cellSize), extent - 1)
    const localRow = clamp(Math.floor((point.clientY - rect.top - AXIS_PAD) / cellSize), renderedRows - 1)
    return { row: rowStart + localRow, column: columnStart + localColumn }
  }

  const touchStart = (event: any) => {
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

  const touchEnd = (event: any) => {
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
      const node = await drawCells('view-export-canvas', work.cells, work.palette, 0, 0, work.width, exportCellSize, work.height, { showCodes: true, axes: true, scale: 1 })
      if (!node) throw new Error('画布尚未就绪，请重试')
      const image = await Taro.canvasToTempFilePath({
        canvas: node,
        width: exportWidth,
        height: exportHeight,
        destWidth: exportWidth,
        destHeight: exportHeight,
        fileType: 'png',
      })
      if (!await saveImageToAlbum(image.tempFilePath)) return
      await Taro.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (reason) { setError(toUserMessage(reason)) }
    finally { setBusy(false) }
  }

  return <View className='viewer'>
    <View className='viewer-heading'>
      <Text className='viewer-kicker'>拼豆看图 · 只读</Text>
      <Text className='viewer-title'>{work.name}</Text>
      <Text className='viewer-meta'>{work.width} × {work.height} · {work.palette.length} 色 · 放大后查看格内色号</Text>
    </View>

    <View className='viewer-tools'>
      <Button className={`viewer-tool ${highlightMode ? 'active' : ''}`} size='mini' onClick={toggleHighlight}>同色高亮{highlightMode ? '·开' : ''}</Button>
      <Button className={`viewer-tool ${countMode ? 'active' : ''}`} size='mini' onClick={toggleCountMode}>数格子{countMode ? '·开' : ''}</Button>
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
      <Canvas type='2d' id='view-canvas' className='viewer-canvas' disableScroll style={{ width: `${boardSize + AXIS_PAD * 2}px`, height: `${boardSize * ROW_RATIO(isTablet) + AXIS_PAD * 2}px` }} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={() => { gesture.current = null }} />
    </View>}

    <View className='viewer-controls'>
      <Button disabled={extent >= maxExtent} onClick={() => zoom(extent * 1.45)} aria-label='缩小'><View className='pixel-glyph pixel-glyph--minus' /></Button>
      <Text>{rowStart + 1}–{Math.min(work.height, rowStart + renderedRows)} 行 · {columnStart + 1}–{Math.min(work.width, columnStart + extent)} 列</Text>
      <Button disabled={extent <= minExtent} onClick={() => zoom(extent / 1.45)} aria-label='放大'><View className='pixel-glyph pixel-glyph--plus' /></Button>
    </View>
    <Text className='viewer-hint'>{countMode ? '单指拖动选格 · 双指平移或缩放' : '单指平移 · 双指缩放 · 用两侧坐标定位'}</Text>

    {error && <Text className='viewer-error'>{error}</Text>}
    <View className='viewer-actions'><Button className='raised-button' loading={busy} disabled={busy} onClick={exportImage}>保存带色号图纸</Button></View>
    {pageVisible && busy && <Canvas type='2d' id='view-export-canvas' className='viewer-export-canvas' style={{ width: `${exportWidth}px`, height: `${exportHeight}px` }} />}
  </View>
}
