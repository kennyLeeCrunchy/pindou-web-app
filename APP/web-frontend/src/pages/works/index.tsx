import { useDidShow } from '@tarojs/taro'
import Taro from '@tarojs/taro'
import { Button, Image, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import type { Work } from '../../shared/types'
import { deleteWork, getWorks, renameWork } from '../../store/works'
import { selectTab } from '../../custom-tab-bar/select'
import { toUserMessage } from '../../utils/error'
import './index.scss'

const getThumbnailSize = () => {
  try {
    const width = Taro.getWindowInfo().windowWidth || Taro.getSystemInfoSync().windowWidth
    return Math.min(180, Math.max(64, width * 0.22))
  } catch { return 88 }
}

const thumbnailCache = new Map<string, { updatedAt: string; path: string }>()

function WorkThumbnail({ work, size }: { work: Work; size: number }) {
  const cached = thumbnailCache.get(work.id)
  const [imagePath, setImagePath] = useState(cached?.updatedAt === work.updatedAt ? cached.path : '')

  useEffect(() => {
    const existing = thumbnailCache.get(work.id)
    if (existing?.updatedAt === work.updatedAt) {
      setImagePath(existing.path)
      return
    }
    let active = true
    const render = async () => {
      const cellSize = size * 2 / Math.max(work.width, work.height, 1)
      const width = Math.max(1, Math.round(work.width * cellSize))
      const height = Math.max(1, Math.round(work.height * cellSize))
      const canvas = Taro.createOffscreenCanvas({ type: '2d', width, height })
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
      const colors = new Map(work.palette.map(item => [item.code, item.hex]))
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      work.cells.forEach((row, y) => row.forEach((code, x) => {
        if (!code) return
        ctx.fillStyle = colors.get(code) || '#ffffff'
        const left = Math.round(x * cellSize)
        const top = Math.round(y * cellSize)
        ctx.fillRect(left, top, Math.round((x + 1) * cellSize) - left, Math.round((y + 1) * cellSize) - top)
      }))
      const image = await Taro.canvasToTempFilePath({ canvas: canvas as unknown as Taro.Canvas,
        x: 0, y: 0, width, height, destWidth: width, destHeight: height, fileType: 'png' })
      thumbnailCache.set(work.id, { updatedAt: work.updatedAt, path: image.tempFilePath })
      if (active) setImagePath(image.tempFilePath)
    }
    const timer = setTimeout(() => { void render().catch(() => { if (active) setImagePath('') }) }, 0)
    return () => { active = false; clearTimeout(timer) }
  }, [work.id, work.updatedAt, work.cells, work.palette, work.width, work.height, size])

  return imagePath ? <Image src={imagePath} mode='aspectFit' className='thumbnail-image' /> : null
}

export default function WorksPage() {
  const [works, setWorks] = useState<Work[]>(getWorks)
  const [thumbnailSize] = useState(getThumbnailSize)
  const reload = () => {
    const next = getWorks()
    setWorks(current => current.length === next.length && current.every((work, index) =>
      work.id === next[index].id && work.updatedAt === next[index].updatedAt) ? current : next)
  }
  useDidShow(() => { selectTab(1); reload() })

  const rename = (work: Work) => Taro.showModal({
    title: '重命名作品', editable: true, placeholderText: work.name, content: work.name,
  } as Parameters<typeof Taro.showModal>[0]).then(result => {
    const nextName = (result as typeof result & { content?: string }).content?.trim()
    if (result.confirm && nextName) {
      renameWork(work.id, nextName)
      reload()
    }
  })

  const remove = (work: Work) => Taro.showModal({
    title: '删除作品？', content: `“${work.name}”删除后无法恢复。`, confirmColor: '#d14343',
  }).then(result => {
    if (result.confirm) { deleteWork(work.id); reload() }
  }).catch(reason => Taro.showToast({ title: toUserMessage(reason), icon: 'none' }))

  if (!works.length) return <View className='works empty'>
    <View className='empty-icon' /><Text className='empty-title'>还没有作品</Text>
    <Text className='muted'>在图纸预览中进入编辑器并保存作品，作品会显示在这里。</Text>
    <Button className='raised-button primary' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>去创建</Button>
  </View>

  return <View className='works'>
    <View className='heading'><Text className='title'>我的作品</Text><Text className='muted'>{works.length} 个本地作品</Text></View>
    <View className='works-list'>{works.map(work => <View className='card' key={work.id}>
      <View className='preview' onClick={() => Taro.navigateTo({ url: `/pages/view/index?id=${encodeURIComponent(work.id)}` })}>
        <WorkThumbnail work={work} size={thumbnailSize} />
        <Text className='preview-size'>{work.width} × {work.height}</Text>
      </View>
      <View className='meta'>
        <Text className='name'>{work.name}</Text>
        <Text className='muted'>{work.brand} · {new Date(work.updatedAt).toLocaleDateString()}</Text>
        <View className='actions'>
          <View hoverClass='action-button-pressed' className='action-button rename-button' onClick={() => rename(work)}><View className='action-label'>重命名</View></View>
          <View hoverClass='action-button-pressed' className='action-button delete-button' onClick={() => remove(work)}><View className='action-label'>删除</View></View>
          <View hoverClass='action-button-pressed' className='action-button view-work' onClick={() => Taro.navigateTo({ url: `/pages/view/index?id=${encodeURIComponent(work.id)}` })}><View className='action-label'>看图</View></View>
          <View hoverClass='action-button-pressed' className='action-button open' onClick={() => Taro.navigateTo({ url: `/pages/editor/index?id=${encodeURIComponent(work.id)}` })}><View className='action-label'>编辑</View></View>
        </View>
      </View>
    </View>)}</View>
  </View>
}
