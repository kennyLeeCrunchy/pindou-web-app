import Taro from '@tarojs/taro'
import { localDataEpoch, requireLocalDataEpoch } from '../store/dataEpoch'
import type { ConversionResult, PatternCount, PatternVariant, PreparedConversion } from '../shared/types'

const RESULT_KEY = 'latest-conversion-v2'
export function saveLatestPattern(result: ConversionResult) { Taro.setStorageSync(RESULT_KEY, result) }
export function getLatestPattern(): ConversionResult | undefined { return Taro.getStorageSync<ConversionResult | ''>(RESULT_KEY) || undefined }

export async function materializePrepared(result: PreparedConversion): Promise<PreparedConversion> {
  const epoch = localDataEpoch()
  const fs = Taro.getFileSystemManager()
  const written: string[] = []
  const localize = (url: string, kind: string) => {
    requireLocalDataEpoch(epoch)
    const match = url.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
    if (!match) throw new Error('准备图片格式无效')
    const path = `${Taro.env.USER_DATA_PATH}/perlabo-${result.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${kind}.png`
    fs.writeFileSync(path, match[1], 'base64')
    written.push(path)
    return path
  }
  try {
    const preparedImage = localize(result.preparedImage, 'prepared')
    const images = { ...result.images }
    for (const kind of ['original', 'ai', 'subject'] as const) {
      const url = images[kind]
      if (url) images[kind] = localize(url, kind)
    }
    return { ...result, preparedImage, images }
  } catch {
    for (const path of written) { try { fs.unlinkSync(path) } catch { /* already removed */ } }
    throw new Error('图片保存失败，请检查手机存储空间后重试')
  }
}

export async function materializePreviews(result: ConversionResult): Promise<ConversionResult> {
  const epoch = localDataEpoch()
  const fs = Taro.getFileSystemManager()
  const written: string[] = []
  const localize = (url: string, kind: string) => {
    requireLocalDataEpoch(epoch)
    const match = url.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return url
    const path = `${Taro.env.USER_DATA_PATH}/perlabo-${result.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${kind}.png`
    fs.writeFileSync(path, match[1], 'base64')
    written.push(path)
    return path
  }
  try {
    for (const size of [52, 78, 104] as const) result.variants[size].previewUrl = localize(result.variants[size].previewUrl, String(size))
    for (const kind of ['original', 'ai', 'subject'] as const) {
      const url = result.images[kind]
      if (url) result.images[kind] = localize(url, kind)
    }
    return result
  } catch {
    for (const path of written) { try { fs.unlinkSync(path) } catch { /* already removed */ } }
    throw new Error('图片保存失败，请检查手机存储空间后重试')
  }
}
export function countCells(cells: (string | null)[][], palette: PatternCount[]): PatternCount[] {
  const totals = new Map<string, number>()
  cells.forEach(row => row.forEach(code => { if (code) totals.set(code, (totals.get(code) || 0) + 1) }))
  return palette.filter(item => totals.has(item.code)).map(item => ({ ...item, count: totals.get(item.code)! }))
}
export function totalBeads(variant: PatternVariant) { return variant.counts.reduce((sum, item) => sum + item.count, 0) }
