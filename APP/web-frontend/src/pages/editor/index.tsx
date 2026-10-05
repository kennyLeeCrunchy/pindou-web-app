import Taro, { useDidHide, useDidShow, useLoad } from '@tarojs/taro'
import { Button, Canvas, Input, ScrollView, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { BRAND_COLORS, BRAND_LABEL, type BrandColor } from '../../data/palettes'
import { drawCells, axisPadFor } from '../../utils/canvas'
import type { Work } from '../../shared/types'
import { getWork, saveWork, flushWorks } from '../../store/works'
import { toUserMessage } from '../../utils/error'
import { saveImageToAlbum } from '../../utils/album'
import { editCell } from '../../utils/edit'
import { getEditorHistory, saveEditorHistory, flushEditorHistory, type CellChange } from '../../store/editorHistory'
import { countCells } from '../../utils/pattern'
import './index.scss'

const FALLBACK_BOARD = 280
const INITIAL_EXTENT = 20
const MIN_EXTENT = 10
/* On-screen coordinate strip, same look as the viewer page. */
const AXIS_PAD = 20
/* 1.25 rows per column at the default 20-column extent = 20×25 cells = exactly
   4×5 major (5-cell) grid squares — keeps the palette visible below the board. */
const ROW_RATIO = (isTablet: boolean) => (isTablet ? 1.2 : 1.25)
/* Pan limits use whole rows so the final pattern row can be shown in full. */
const visibleRowsFor = (columns: number, isTablet: boolean) => Math.max(1, Math.floor(columns * ROW_RATIO(isTablet)))
const SERIES = ['全部', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M']
type Point = { clientX: number; clientY: number }
type Gesture = { mode: 'tap' | 'canvas'; x: number; y: number; distance: number; row: number; column: number; extent: number; moved: boolean }
const distance = (a: Point, b: Point) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
const midpoint = (a: Point, b: Point): Point => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 })
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))
export default function EditorPage() {
  const [work, setWork] = useState<Work>()
  const [history, setHistory] = useState<CellChange[]>([])
  const [future, setFuture] = useState<CellChange[]>([])
  const [color, setColor] = useState<string | null>(null)
  const [rowStart, setRowStart] = useState(0)
  const [columnStart, setColumnStart] = useState(0)
  const [extent, setExtent] = useState(INITIAL_EXTENT)
  const [boardSize, setBoardSize] = useState(FALLBACK_BOARD)
  const [isTablet, setIsTablet] = useState(false)
  const [isTwoFingerGesture, setIsTwoFingerGesture] = useState(false)
  const visibleRows = visibleRowsFor(extent, isTablet)
  const renderedRows = Math.ceil(extent * ROW_RATIO(isTablet) - 1e-9)
  const [showPalette, setShowPalette] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [paletteSeries, setPaletteSeries] = useState('全部')
  const gesture = useRef<Gesture | null>(null)
  const lastMoveAt = useRef(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  const workIdRef = useRef('')
  useLoad(({ id }) => {
    const decodedId = id ? decodeURIComponent(id) : ''
    workIdRef.current = decodedId
    const found = decodedId ? getWork(decodedId) : undefined
    setWork(found)
    if (found) {
      setColor(found.palette[0]?.code || null)
      const timeline = getEditorHistory(found.id)
      setHistory(timeline.undo)
      setFuture(timeline.redo)
    }
  })
  /* Devtools hot reload can reset the store cache between save and load; the
     re-read on show gives the page the same second chance the viewer has. */
  useDidShow(() => {
    setPageVisible(true)
    const found = workIdRef.current ? getWork(workIdRef.current) : undefined
    setWork(found)
  })
  useDidHide(() => {
    setPageVisible(false)
    gesture.current = null
    setIsTwoFingerGesture(false)
  })
  useEffect(() => {
    const updateViewport = (width: number) => {
      const tablet = width >= 700
      setIsTablet(tablet)
      setBoardSize(Math.min(936, Math.max(200, width - (tablet ? 44 : 12))))
    }
    try {
      updateViewport(Taro.getWindowInfo().windowWidth || Taro.getSystemInfoSync().windowWidth)
    } catch { /* use fallback size */ }
    const onResize: Taro.onWindowResize.Callback = event => updateViewport(event.size.windowWidth)
    Taro.onWindowResize(onResize)
    return () => Taro.offWindowResize(onResize as unknown as Taro.offWindowResize.Callback)
  }, [])
  /* The old-interface canvas is a native component that floats above every
     normal view, so it is unmounted while the palette sheet is open and
     repainted once it comes back. */
  useEffect(() => { if (work && pageVisible && !showPalette) void drawCells('edit-canvas', work.cells, work.palette, rowStart, columnStart, extent, boardSize / extent, visibleRows, { showCodes: true, axes: true, axisPad: AXIS_PAD, bufferCssHeight: boardSize * ROW_RATIO(isTablet) }) }, [work, pageVisible, showPalette, rowStart, columnStart, extent, boardSize, visibleRows])
  if (!work) {
    return <View className='state'><Text>作品不存在或已被删除</Text><Button onClick={() => Taro.navigateBack()}>返回</Button></View>
  }
  const counts = countCells(work.cells, work.palette)
  const beads = counts.reduce((sum, item) => sum + item.count, 0)
  const brandColors = BRAND_COLORS[work.brand] || BRAND_COLORS.Artkal
  const brandLabel = BRAND_LABEL[work.brand] || BRAND_LABEL.Artkal
  const matchingColors = brandColors.filter(item =>
    (paletteSeries === '全部' || item.series === paletteSeries) &&
    (!paletteSearch.trim() || `${item.code} ${item.name}`.toUpperCase().includes(paletteSearch.trim().toUpperCase())))
  const selectBrandColor = (item: BrandColor) => {
    if (!work.palette.some(existing => existing.code === item.code)) {
      setWork(saveWork({ ...work, palette: [...work.palette, { code: item.code, name: item.name, hex: item.hex, count: 0 }] }))
    }
    setColor(item.code)
    setShowPalette(false)
  }
  const paint = (row: number, column: number) => {
    const before = work.cells[row]?.[column]
    if (before === undefined || before === color) return
    const nextHistory = [...history.slice(-49), { row, column, before, after: color }]
    setHistory(nextHistory)
    setFuture([])
    setWork(saveWork(editCell(work, row, column, color)))
    saveEditorHistory(work.id, { undo: nextHistory, redo: [] })
  }
  const maxExtent = Math.max(work.width, work.height)
  const exportCellSize = Math.max(8, Math.floor(1560 / Math.max(work.width, work.height)))
  const exportPad = axisPadFor(exportCellSize)
  const exportCanvasWidth = work.width * exportCellSize + exportPad * 2
  const exportCanvasHeight = work.height * exportCellSize + exportPad * 2
  const zoom = (next: number) => {
    const size = Math.max(MIN_EXTENT, Math.min(maxExtent, Math.round(next)))
    const nextRows = visibleRowsFor(size, isTablet)
    const centerRow = rowStart + visibleRows / 2
    const centerColumn = columnStart + extent / 2
    setExtent(size)
    setRowStart(clamp(Math.round(centerRow - nextRows / 2), Math.max(0, work.height - nextRows)))
    setColumnStart(clamp(Math.round(centerColumn - size / 2), Math.max(0, work.width - size)))
  }
  const touchStart = (event: any) => {
    const points = event.touches as Point[]
    if (points?.length >= 2) {
      const center = midpoint(points[0], points[1])
      gesture.current = { mode: 'canvas', x: center.clientX, y: center.clientY, distance: distance(points[0], points[1]), row: rowStart, column: columnStart, extent, moved: true }
      setIsTwoFingerGesture(true)
    } else if (points?.length === 1) {
      gesture.current = { mode: 'tap', x: points[0].clientX, y: points[0].clientY, distance: 0, row: rowStart, column: columnStart, extent, moved: false }
      setIsTwoFingerGesture(false)
    }
  }
  const throttled = () => {
    const now = Date.now()
    if (now - lastMoveAt.current < 33) return false
    lastMoveAt.current = now
    return true
  }
  const touchMove = (event: any) => {
    const points = event.touches as Point[]
    const active = gesture.current
    if (points?.length >= 2) {
      if (!active || active.mode !== 'canvas') {
        touchStart(event)
        return
      }
      if (!throttled()) return
      const center = midpoint(points[0], points[1])
      const currentDistance = distance(points[0], points[1])
      const size = currentDistance >= 10 && active.distance >= 10
        ? Math.max(MIN_EXTENT, Math.min(maxExtent, Math.round(active.extent * active.distance / currentDistance)))
        : active.extent
      const oldRows = visibleRowsFor(active.extent, isTablet)
      const nextRows = visibleRowsFor(size, isTablet)
      const cellPx = boardSize / active.extent
      const dx = center.clientX - active.x
      const dy = center.clientY - active.y
      setExtent(size)
      setRowStart(clamp(Math.round(active.row + (oldRows - nextRows) / 2 - dy / cellPx), Math.max(0, work.height - nextRows)))
      setColumnStart(clamp(Math.round(active.column + (active.extent - size) / 2 - dx / cellPx), Math.max(0, work.width - size)))
    } else if (points?.length === 1 && active?.mode === 'tap') {
      const dx = points[0].clientX - active.x
      const dy = points[0].clientY - active.y
      if (Math.hypot(dx, dy) > 6) active.moved = true
    } else if (points?.length === 1 && active?.mode === 'canvas') {
      gesture.current = null
      setIsTwoFingerGesture(false)
    }
  }
  const touchEnd = (event: any) => {
    const active = gesture.current
    if (event.touches?.length) {
      gesture.current = null
      setIsTwoFingerGesture(false)
      return
    }
    gesture.current = null
    setIsTwoFingerGesture(false)
    const point = event.changedTouches?.[0] as Point | undefined
    if (!point || !active || active.mode !== 'tap' || active.moved) return
    Taro.createSelectorQuery().select('#edit-canvas').boundingClientRect(rect => {
      if (!rect || Array.isArray(rect)) return
      const cellSize = (rect.width - AXIS_PAD * 2) / extent
      const x = point.clientX - rect.left - AXIS_PAD
      const y = point.clientY - rect.top - AXIS_PAD
      /* Include the partial last row, but never paint from the axis strips. */
      if (x >= 0 && x < rect.width - AXIS_PAD * 2 && y >= 0 && y < rect.height - AXIS_PAD * 2) {
        paint(Math.floor(y / cellSize) + rowStart, Math.floor(x / cellSize) + columnStart)
      }
    }).exec()
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    const nextHistory = history.slice(0, -1)
    const nextFuture = [...future.slice(-49), last]
    setWork(saveWork(editCell(work, last.row, last.column, last.before)))
    setHistory(nextHistory)
    setFuture(nextFuture)
    saveEditorHistory(work.id, { undo: nextHistory, redo: nextFuture })
  }
  const redo = () => {
    const next = future[future.length - 1]
    if (!next) return
    const nextHistory = [...history.slice(-49), next]
    const nextFuture = future.slice(0, -1)
    setWork(saveWork(editCell(work, next.row, next.column, next.after)))
    setHistory(nextHistory)
    setFuture(nextFuture)
    saveEditorHistory(work.id, { undo: nextHistory, redo: nextFuture })
  }
  const save = () => {
    try { setWork(saveWork(work)); flushWorks(); flushEditorHistory(work.id); void Taro.showToast({ title: '作品已保存', icon: 'success' }) }
    catch (reason) { setError(toUserMessage(reason)) }
  }
  const exportImage = async () => {
    setBusy(true); setError('')
    try {
      await new Promise<void>(resolve => Taro.nextTick(() => resolve()))
      const saved = saveWork(work)
      flushWorks()
      const px = Math.max(8, Math.floor(1560 / Math.max(saved.width, saved.height)))
      const pad = axisPadFor(px)
      const exportWidth = saved.width * px + pad * 2
      const exportHeight = saved.height * px + pad * 2
      const node = await drawCells('export-canvas', saved.cells, saved.palette, 0, 0, saved.width, px, saved.height, { showCodes: true, axes: true, scale: 1 })
      if (!node) throw new Error('画布尚未就绪，请重试')
      const image = await Taro.canvasToTempFilePath({ canvas: node, width: exportWidth, height: exportHeight, destWidth: exportWidth, destHeight: exportHeight, fileType: 'png' })
      setWork(saved)
      if (!await saveImageToAlbum(image.tempFilePath)) return
      await Taro.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (reason) { setError(toUserMessage(reason)) }
    finally { setBusy(false) }
  }
  return <View className='editor'>
    <View className='editor-head'><View className='editor-heading'><Text className='editor-kicker'>PIXEL STUDIO · 编辑中</Text><Text className='editor-title'>{work.name}</Text><Text className='hint'>{counts.length} 色 · {beads} 颗 · 自动保存</Text></View><View className='history-controls'><Button className='history-button' disabled={!history.length} onClick={undo} aria-label='撤销'><View className='pixel-glyph pixel-glyph--left' /></Button><Button className='history-button' disabled={!future.length} onClick={redo} aria-label='重做'><View className='pixel-glyph pixel-glyph--right' /></Button></View></View>
    {pageVisible && !showPalette && <View className='editor-board'><Canvas type='2d' id='edit-canvas' className='edit-canvas' disableScroll={isTwoFingerGesture} style={{ width: `${boardSize + AXIS_PAD * 2}px`, height: `${boardSize * ROW_RATIO(isTablet) + AXIS_PAD * 2}px` }} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={() => { gesture.current = null; setIsTwoFingerGesture(false) }} /></View>}
    <View className='view-controls'><Button disabled={extent >= maxExtent} onClick={() => zoom(extent * 1.5)} aria-label='缩小'><View className='pixel-glyph pixel-glyph--minus' /></Button><Text>{rowStart + 1}–{Math.min(work.height, rowStart + renderedRows)} 行 · {columnStart + 1}–{Math.min(work.width, columnStart + extent)} 列</Text><Button disabled={extent <= MIN_EXTENT} onClick={() => zoom(extent / 1.5)} aria-label='放大'><View className='pixel-glyph pixel-glyph--plus' /></Button></View>
    <Text className='gesture-hint'>双指拖动画布 · 双指缩放 · 单指滑动页面 · 单指点按填色</Text>
    <View className='palette-heading'><Text className='section-title'>选择颜色</Text><Button size='mini' onClick={() => setShowPalette(true)}>{work.brand || 'Artkal'} 全色卡 · {brandColors.length} 色</Button></View><ScrollView scrollX className='palette'><View className='palette-row'>
      <View className={`swatch ${color === null ? 'active' : ''}`} onClick={() => setColor(null)}><View className='dot empty-dot' /><Text>清空</Text></View>
      {work.palette.map(item => <View key={item.code} className={`swatch ${color === item.code ? 'active' : ''}`} onClick={() => setColor(item.code)}><View className='dot' style={{ background: item.hex }} /><Text>{item.code}</Text></View>)}
    </View></ScrollView>
    {error && <Text className='export-error'>{error}</Text>}
    <View className='bottom'><Button className='secondary-button' onClick={save}>保存作品</Button><Button className='raised-button' disabled={busy} onClick={exportImage}>保存图片</Button></View>
    {showPalette && <><View className='palette-backdrop' onTouchMove={event => event.stopPropagation()} onClick={() => setShowPalette(false)} /><View className='palette-sheet' onTouchMove={event => event.stopPropagation()}>
      <View className='palette-sheet__head'><Text>{brandLabel} · {brandColors.length} 色</Text><Text onClick={() => setShowPalette(false)}>关闭</Text></View>
      <Input className='palette-search' value={paletteSearch} placeholder='搜索色号，如 H7' onInput={event => setPaletteSearch(event.detail.value)} />
      <ScrollView scrollX className='palette-series'><View className='palette-series__row'>{SERIES.map(item => <View key={item} className={paletteSeries === item ? 'active' : ''} onClick={() => setPaletteSeries(item)}>{item}</View>)}</View></ScrollView>
      <ScrollView scrollY enhanced showScrollbar bounces={false} className='palette-all-colors' onTouchMove={event => event.stopPropagation()}><View className='palette-all-colors__grid'>{matchingColors.map(item => <View key={item.code} className='palette-color' onClick={() => selectBrandColor(item)}><View className='palette-color__dot' style={{ backgroundColor: item.hex }} /><Text>{item.code}</Text></View>)}</View>{!matchingColors.length && <Text className='palette-empty'>没有匹配的色号</Text>}</ScrollView>
    </View></>}
    {pageVisible && busy && <Canvas type='2d' id='export-canvas' className='export-canvas' style={{ width: `${exportCanvasWidth}px`, height: `${exportCanvasHeight}px` }} />}
  </View>
}
