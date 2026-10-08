import { Button, Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import PatternGrid from '../../components/PatternGrid'
import StatusPanel from '../../components/StatusPanel'
import type { ConversionResult, PatternVariant, Work } from '../../shared/types'
import { getWork, saveWork, flushWorks } from '../../store/works'
import { toUserMessage } from '../../utils/error'
import { saveImageToAlbum } from '../../utils/album'
import { countCells, getLatestPattern, totalBeads } from '../../utils/pattern'
import { createPatternImage, patternExportLayout } from '../../utils/patternExport'
import './index.scss'

const sizes = [52, 78, 104] as const
const workId = (id: string, size: number) => `${id}-${size}`
function displayVariant(result: ConversionResult, size: 52 | 78 | 104): { variant: PatternVariant; edited: boolean; work?: Work } {
  const variant = result.variants[size]
  const work = getWork(workId(result.id, size))
  return work ? { variant: { ...variant, cells: work.cells, counts: countCells(work.cells, work.palette) }, edited: true, work } : { variant, edited: false }
}
export default function PreviewPage() {
  const [result, setResult] = useState<ConversionResult>()
  const [size, setSize] = useState<52 | 78 | 104>(78)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [stageErrors, setStageErrors] = useState<Record<string, string>>({})
  const [pageVisible, setPageVisible] = useState(true)
  const lastId = useRef('')
  useDidShow(() => {
    setPageVisible(true)
    const latest = getLatestPattern()
    setResult(latest)
    setStageErrors({})
    if (latest?.id !== lastId.current) setSize(latest?.mode === 'scene_direct' ? 52 : 78)
    lastId.current = latest?.id || ''
    setRevision(n => n + 1)
  })
  useDidHide(() => setPageVisible(false))
  const selected = result && displayVariant(result, size)
  const exportPattern = result && selected ? { width: size, height: size, cells: selected.variant.cells, palette: selected.variant.counts, brand: result.brand } : undefined
  const exportLayout = exportPattern && patternExportLayout(exportPattern)
  void revision
  const openEditor = () => {
    if (!result || !selected) return
    const id = workId(result.id, size)
    try {
      if (!selected.work) {
        const now = new Date().toISOString()
        saveWork({ id, conversionId: result.id, name: `${size}×${size} 拼豆图纸`, width: size, height: size, brand: result.brand, status: 'draft', createdAt: now, updatedAt: now, progress: 0, palette: selected.variant.counts, cells: selected.variant.cells.map(row => [...row]) })
      }
      flushWorks()
      void Taro.navigateTo({ url: `/pages/editor/index?id=${encodeURIComponent(id)}` })
    } catch (reason) { setError(toUserMessage(reason)) }
  }
  const saveImage = async () => {
    if (!selected || !exportPattern || selected.edited || saving) return
    setSaving(true); setError('')
    try {
      await new Promise<void>(resolve => Taro.nextTick(() => resolve()))
      const imagePath = await createPatternImage('preview-export', exportPattern)
      if (!await saveImageToAlbum(imagePath)) return
      await Taro.showToast({ title: '已开始下载', icon: 'success' })
    } catch (reason) { setError(toUserMessage(reason)) }
    finally { setSaving(false) }
  }
  if (!result || !selected) return <View className='preview-page'><StatusPanel kind='empty' title='暂无图纸' description='请先选择图片完成转换。' actionText='去生成' onAction={() => Taro.redirectTo({ url: '/pages/convert/index' })} /></View>
  const { variant, edited } = selected
  const stages: [string, string | undefined][] = [
    ['原图', result.images.original],
    ...(result.mode === 'subject_cartoon' ? [['AI 重绘', result.images.ai] as [string, string | undefined]] : []),
    ...(result.mode !== 'scene_direct' ? [['透明主体', result.images.subject] as [string, string | undefined]] : []),
  ]
  return <View className='preview-page'>
    <View className='preview-heading'><Text className='preview-heading__tag'>图纸已生成</Text><Text className='preview-heading__title'>选择适合的尺寸</Text>
      <Text className='preview-heading__meta'>{result.aiPasses ? `AI 重绘 ${result.aiPasses} 次` : '直接转换 · 0 次 AI'}</Text></View>
    {result.maxColors !== undefined && <Text className='preview-hint'>{result.colorSelection === 'auto' ? '智能选择' : '手动设置'} · 最多 {result.maxColors} 色</Text>}
    {result.colorSelection === 'auto' && result.colorAdvice?.recommendationAcceptable === false && <Text className='preview-hint'>已尝试到颜色上限，请对照处理过程检查五官、边缘与颜色，必要时在编辑器调整。</Text>}
    <View className='size-cards'>{sizes.map(item => <View key={item} className={`size-card ${size === item ? 'active' : ''}`} onClick={() => setSize(item)}>
      <Text>{item}×{item}</Text><Text>{result.variants[item].counts.length} 色</Text><Text>{totalBeads(result.variants[item])} 颗</Text>
    </View>)}</View>
    <View className='preview-card'><Text className='section-title'>当前图纸 {edited ? '· 已保存作品' : ''}</Text>
      {pageVisible && <PatternGrid cells={variant.cells} palette={variant.counts} />}
      <Text className='preview-hint'>{size}×{size} · {variant.counts.length} 色 · {totalBeads(variant)} 颗</Text>
    </View>
    <View className='preview-card'><Text className='section-title'>处理过程</Text><View className='stage-list'>{stages.map(([label, url]) => url
      ? <View key={label} className='stage'><Image src={url} mode='aspectFit' onError={event => setStageErrors(prev => ({ ...prev, [label]: event.detail?.errMsg || '加载失败' }))} /><Text>{label}</Text>{stageErrors[label] && <Text className='stage-error'>{stageErrors[label]}</Text>}</View>
      : <View key={label} className='stage stage-missing'><Text>{label}暂无图片</Text></View>)}</View></View>
    <View className='preview-card'><Text className='section-title'>色号与颗数</Text><ScrollView scrollY className='palette-list'>
      {variant.counts.map(item => <View className='palette-item' key={item.code}><View className='palette-swatch' style={{ backgroundColor: item.hex }} /><View className='palette-name'><Text>{item.code}</Text><Text>{item.name}</Text></View><Text className='palette-count'>{item.count} 颗</Text></View>)}
    </ScrollView></View>
    {error && <StatusPanel kind='error' title='保存失败' description={error} />}
    <View className='preview-actions'><Button className='secondary-button' onClick={openEditor}>编辑图纸</Button><Button className='raised-button' loading={saving} onClick={edited ? openEditor : saveImage}>{edited ? '进入编辑器导出' : '保存图纸图片'}</Button></View>
    {pageVisible && saving && exportLayout && <canvas id='preview-export' className='preview-export-canvas' style={{ width: `${exportLayout.width}px`, height: `${exportLayout.height}px` }} />}
  </View>
}
