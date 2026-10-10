import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState } from 'react'
import StatusPanel from '../../components/StatusPanel'
import { completePreparedPattern, preparePattern, defaultMaxColors } from '../../services/api'
import type { BeadBrand, ConversionMode, FramingMode, PreparedConversion } from '../../shared/types'
import { toUserMessage } from '../../utils/error'
import { materializePrepared, materializePreviews, saveLatestPattern } from '../../utils/pattern'
import { canvasImage, chooseImageFile, createCanvas, loadImage, readImageFile } from '../../utils/browserImage'
import './index.scss'

const modes: { key: ConversionMode; title: string; help: string }[] = [
  { key: 'cartoon_direct', title: '卡通主体', help: '自动提取主体并直转图纸' },
  { key: 'scene_direct', title: '风景整图', help: '保留整幅画面，直接转图纸' },
  { key: 'subject_cartoon', title: '照片重绘', help: 'AI 像素重绘后提取主体' },
]
const colorOptions = Array.from({ length: 61 }, (_, index) => index + 4)
const supportedImage = /^(jpe?g|png|webp)$/i
/* 服务端（含 CloudBase SCF 入口）的硬上限；大图在本页先压缩到 1536 再上传。 */
const UPLOAD_LIMIT = 4 * 1024 * 1024
const PIXEL_LIMIT = 12_000_000
const HARD_SIZE_LIMIT = 64 * 1024 * 1024
const TARGET_SIDE = 1536
/* 压缩块整体限时：canvas 解码在异常情况下可能不回调。 */
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => Promise.race([
  promise,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('压缩超时')), ms)),
])
/* wx.compressImage 在部分机型上不回调或输出仍过大，改用离屏 canvas 手动缩图：
   后端拿到图也会缩到 1536，这里目标边长一致。createImage 按 EXIF 方向解码，
   重编码后不再携带 EXIF，方向已经画进像素里。 */
const downscale = async (src: string, targetSide: number, quality: number) => {
  const image = await loadImage(src)
  const info = { width: image.naturalWidth, height: image.naturalHeight }
  const scale = Math.min(1, targetSide / Math.max(info.width, info.height))
  const width = Math.max(1, Math.round(info.width * scale))
  const height = Math.max(1, Math.round(info.height * scale))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height)
  const output = canvasImage(canvas, 'jpg', quality)
  const size = Math.floor(output.tempFilePath.split(',')[1].length * 3 / 4)
  return { path: output.tempFilePath, width, height, size }
}
const BRAND_KEY = 'pindou.brand.v1'
const brands: { key: BeadBrand; title: string }[] = [{ key: 'Artkal', title: 'Artkal 色系' }, { key: 'Mard', title: 'Mard 色系' }]
const savedBrand = (): BeadBrand => { try { return Taro.getStorageSync(BRAND_KEY) === 'Mard' ? 'Mard' : 'Artkal' } catch { return 'Artkal' } }

export default function ConvertPage() {
  const pending = useRef<{ signature: string; id: string }>()
  const [filePath, setFilePath] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [mode, setMode] = useState<ConversionMode>('cartoon_direct')
  const [framing, setFraming] = useState<FramingMode>('flat')
  const [subjectTarget, setSubjectTarget] = useState('')
  const [customColors, setCustomColors] = useState<number>()
  const [brand, setBrand] = useState<BeadBrand>(savedBrand)
  const chooseBrand = (next: BeadBrand) => { setBrand(next); try { Taro.setStorageSync(BRAND_KEY, next) } catch { /* preference only */ } }
  const [loading, setLoading] = useState(false)
  const [prepared, setPrepared] = useState<PreparedConversion>()
  const [loadingStage, setLoadingStage] = useState<'prepare' | 'pattern'>('prepare')
  const [error, setError] = useState('')
  const [pickError, setPickError] = useState('')
  const maxColors = customColors ?? defaultMaxColors(mode)
  const colorSelection = customColors === undefined ? 'auto' : 'manual'
  const chooseImage = async () => {
    if (loading) return
    try {
      setPickError('')
      const file = await chooseImageFile()
      if (!file) return
      if (file.size > HARD_SIZE_LIMIT) throw new Error('图片太大，请缩小后再选择')
      const path = await readImageFile(file)
      const decoded = await loadImage(path)
      const imageInfo = { type: file.type.split('/')[1], width: decoded.naturalWidth, height: decoded.naturalHeight }
      if (!supportedImage.test(imageInfo.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片')
      let uploadPath = path
      let uploadSize = file.size
      let uploadPixels = imageInfo.width * imageInfo.height
      /* 手机原图普遍超过 4MB，先在本地缩到 1536 再上传（后端最终也会缩到 1536）。 */
      if (uploadSize > 3 * 1024 * 1024 || Math.max(imageInfo.width, imageInfo.height) > TARGET_SIDE) {
        for (const attempt of [{ side: TARGET_SIDE, quality: 0.85 }, { side: TARGET_SIDE, quality: 0.6 }, { side: Math.round(TARGET_SIDE * 0.75), quality: 0.6 }] as const) {
          try {
            const scaled = await withTimeout(downscale(path, attempt.side, attempt.quality), 15000)
            if (scaled.size !== 0 && (scaled.size > UPLOAD_LIMIT || scaled.width * scaled.height > PIXEL_LIMIT)) continue
            uploadPath = scaled.path
            uploadSize = scaled.size || uploadSize
            uploadPixels = scaled.width * scaled.height
            break
          } catch { /* 换下一档；全部失败时用原图兜底 */ }
        }
      }
      if (uploadSize > UPLOAD_LIMIT) throw new Error('图片压缩后仍过大，请缩小后再选择')
      if (uploadPixels > PIXEL_LIMIT) throw new Error('图片像素过高，请缩小后再选择')
      pending.current = undefined
      setPrepared(undefined)
      setFilePath(uploadPath); setFileSize(uploadSize); setError('')
    } catch (reason) { const message = toUserMessage(reason); if (message) setPickError(message) }
  }
  const prepare = async () => {
    if (!filePath || loading) return
    setLoadingStage('prepare'); setLoading(true); setError(''); setPrepared(undefined)
    try {
      const signature = JSON.stringify([filePath, mode, framing, subjectTarget])
      if (pending.current?.signature !== signature) pending.current = { signature, id: `request_${Date.now()}_${Math.random().toString(36).slice(2)}` }
      const result = await preparePattern({ requestId: pending.current.id, filePath, mode,
        framingMode: mode === 'subject_cartoon' ? framing : undefined,
        subjectTarget: mode === 'subject_cartoon' ? subjectTarget : undefined })
      setPrepared(await materializePrepared(result))
      pending.current = undefined
    } catch (reason) { setError(toUserMessage(reason)) }
    finally { setLoading(false) }
  }
  const submit = async () => {
    if (!prepared || loading) return
    setLoadingStage('pattern'); setLoading(true); setError('')
    try {
      const result = await completePreparedPattern(prepared, { maxColors, colorSelection, brand })
      saveLatestPattern(await materializePreviews(result))
      await Taro.navigateTo({ url: '/pages/preview/index' })
    } catch (reason) { setError(toUserMessage(reason)) }
    finally { setLoading(false) }
  }
  return <View className='convert-page'>
    <View className='convert-page__intro'><Text className='convert-page__eyebrow'>PERLABO · 图片转图纸</Text><Text className='convert-page__title'>制作拼豆图纸</Text><Text className='convert-page__subtitle'>选择图片和处理路线，获得三种尺寸的图纸。</Text></View>
    <View className='convert-card'><Text className='section-title'>01 · 选择图片</Text>
      {filePath ? <View className='image-preview' onClick={chooseImage}><img src={filePath} alt='已选择的图片' /><Text>点击更换 · {(fileSize / 1024 / 1024).toFixed(1)} MB</Text></View> : <View className='upload-empty'><Text className='upload-empty__title'>选择图片开始制作</Text><Text className='upload-empty__hint'>支持 JPG、PNG、WebP，大图自动压缩</Text><button type='button' className='raised-button upload-cta' onClick={chooseImage}>上传图片</button></View>}
      {filePath && <Text className='field-tip'>JPG、PNG、WebP；大图会在浏览器压缩后上传。</Text>}
      {pickError && <Text className='upload-error'>{pickError}</Text>}
    </View>
    <View className='convert-card'><Text className='section-title'>02 · 选择处理路线</Text>
      {modes.map(item => <View key={item.key} className={`mode-card ${mode === item.key ? 'active' : ''}`} onClick={() => { if (loading || mode === item.key) return; setMode(item.key); setCustomColors(undefined); setPrepared(undefined); setError('') }}>
        <View className='mode-card__copy'><Text className='mode-card__title'>{item.title}</Text><Text className='field-tip'>{item.help}</Text></View>

      </View>)}
      {mode === 'subject_cartoon' && <><Text className='field-label'>要保留的主体（可选）</Text><Input className='text-field' value={subjectTarget} disabled={loading} maxlength={300} placeholder='例如：画面中央的人物' onInput={event => { setSubjectTarget(event.detail.value); setPrepared(undefined); setError('') }} /></>}
      {mode === 'subject_cartoon' && <><Text className='field-label'>人物取景</Text><View className='segments'>
        <button type='button' disabled={loading} className={`segment-button ${framing === 'flat' ? 'active' : ''}`} onClick={() => { if (framing !== 'flat') { setFraming('flat'); setPrepared(undefined); setError('') } }}>平面版 · 原取景</button>
        <button type='button' disabled={loading} className={`segment-button ${framing === 'pendant' ? 'active' : ''}`} onClick={() => { if (framing !== 'pendant') { setFraming('pendant'); setPrepared(undefined); setError('') } }}>挂饰版 · 补全</button>
      </View><Text className='field-tip'>仅选择挂饰版时才会补全原图未显示的身体。</Text></>}
    </View>
    <button type='button' className='raised-button primary-action' disabled={!filePath || loading} onClick={prepare}>{prepared ? '重新准备图片' : '第一步：准备图片'}</button>
    {loading && loadingStage === 'prepare' && <StatusPanel kind='loading' title='正在准备图片' description={mode === 'subject_cartoon' ? 'AI 重绘与主体提取可能需要约一分钟。' : '正在准备图像。'} />}
    {error && loadingStage === 'prepare' && <StatusPanel kind='error' title='图片准备失败' description={error} />}
    {prepared && <View className='convert-card prepared-card'><Text className='section-title'>03 · 确认图像</Text>
      <Text className='field-tip'>确认图像后再生成图纸。修改色系、色数会复用这张图，不会再次调用 AI 重绘。</Text>
      <View className='prepared-stages'>{([['原图', prepared.images.original], ...(prepared.mode === 'subject_cartoon' ? [['AI 重绘', prepared.images.ai]] : []), ...(prepared.mode !== 'scene_direct' ? [['透明主体', prepared.images.subject]] : [])] as [string, string | undefined][]).map(([label, url]) => url && <View className='prepared-stage' key={label}><img src={url} alt={label} onClick={() => { void Taro.previewImage({ urls: [url], current: url }) }} /><Text>{label}</Text></View>)}</View>
    </View>}
    <View className='convert-card prepared-card'><Text className='section-title'>第二步 · 色系与色数</Text>
      <View className='segments'>{brands.map(item => <button type='button' key={item.key} disabled={loading} className={`segment-button ${brand === item.key ? 'active' : ''}`} onClick={() => chooseBrand(item.key)}>{item.title}</button>)}</View>
      <Text className='field-tip'>两种色系均使用完整 221 色卡，色号与所选品牌对应。</Text>
      <View className='picker-row picker-row--spaced'><Text>{customColors === undefined ? '智能选色数' : `最多 ${maxColors} 色 · 自定义`}</Text>
        <select className='color-picker' aria-label='颜色数量' disabled={loading} value={customColors ?? 'auto'} onChange={event => setCustomColors(event.target.value === 'auto' ? undefined : Number(event.target.value))}><option value='auto'>智能选色数</option>{colorOptions.map(value => <option key={value} value={value}>最多 {value} 色</option>)}</select>
      </View><Text className='field-tip'>默认自动选择颜色上限，最多 64 色；也可手动选择 4–64 色。实际用色可能更少。</Text>
    </View>
    {loading && loadingStage === 'pattern' && <StatusPanel kind='loading' title='正在生成图纸' description='正在选择豆色并生成三档图纸，不会再次调用 AI 重绘。' />}
    {error && loadingStage !== 'prepare' && <StatusPanel kind='error' title='图纸生成失败' description={error} />}
    {!loading && <Text className='tier-hint'>{prepared ? '将同时生成 52×52 · 78×78 · 104×104 三档尺寸；从预览返回可调整色数再生成。' : '请先完成第一步并确认图像。'}</Text>}
    <button type='button' className='raised-button primary-action' disabled={!prepared || loading} onClick={submit}>第二步：生成三档图纸</button>
  </View>
}
