import Taro from '@tarojs/taro'
import type { BeadBrand, ConversionMode, ConversionResult, FramingMode, PatternCount, PatternVariant, PreparedConversion } from '../shared/types'
import { ensureSession, invalidateSession } from './auth'
import { localDataEpoch, requireLocalDataEpoch } from '../store/dataEpoch'

export const API_BASE_URL = (process.env.TARO_APP_API_BASE_URL || '').trim().replace(/\/$/, '')
export interface QuotaStatus { limit: number; remaining: number | null; unlimited: boolean }
export async function getQuotaStatus(): Promise<QuotaStatus> {
  if (!API_BASE_URL) throw new Error('服务地址尚未配置')
  const generation = localDataEpoch()
  const attempt = async () => {
    const token = await ensureSession()
    requireLocalDataEpoch(generation)
    const response = await Taro.request<Json>({ url: `${API_BASE_URL}/api/auth/quota`,
      header: { 'X-Session-Token': token, 'Cache-Control': 'no-cache' }, timeout: 100000 })
    requireLocalDataEpoch(generation)
    return response
  }
  let response = await attempt()
  if (response.statusCode === 401) { invalidateSession(); response = await attempt() }
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('额度暂时无法查询，请稍后重试')
  const raw = response.data
  if (!raw || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100 || typeof raw.unlimited !== 'boolean'
    || (raw.unlimited ? raw.remaining !== null : !Number.isInteger(raw.remaining) || raw.remaining < 0 || raw.remaining > raw.limit)) throw new Error('额度信息暂时无法读取')
  return { limit: raw.limit, remaining: raw.remaining, unlimited: raw.unlimited }
}
export interface ConvertInput {
  filePath: string
  mode: ConversionMode
  framingMode?: FramingMode
  subjectTarget?: string
  prompt?: string
  maxColors?: number
  colorSelection?: 'auto' | 'manual'
  preset?: string
  brand?: BeadBrand
  requestId?: string
}
export function defaultMaxColors(mode: ConversionMode): number { return mode === 'scene_direct' ? 24 : 12 }
export function conversionForm(input: ConvertInput): Record<string, string> {
  const maxColors = input.maxColors ?? defaultMaxColors(input.mode)
  if (!Number.isInteger(maxColors) || maxColors < 4 || maxColors > 64) throw new Error('颜色数量须为 4–64')
  return {
    request_id: input.requestId || `request_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
    mode: input.mode,
    ...(input.mode === 'subject_cartoon' ? { framing_mode: input.framingMode || 'flat' } : {}),
    ...(input.mode === 'subject_cartoon' && input.subjectTarget?.trim() ? { subject_target: input.subjectTarget.trim() } : {}),
    ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
    max_colors: String(maxColors),
    color_selection: input.colorSelection ?? (input.maxColors === undefined ? 'auto' : 'manual'),
    preset: input.preset || '221',
    brand: input.brand || 'Artkal',
  }
}
type Json = Record<string, any>
function absoluteUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  if (/^(https?:|wxfile:|data:)/.test(value)) return value
  return API_BASE_URL ? `${API_BASE_URL}${value.startsWith('/') ? '' : '/'}${value}` : value
}
function parseCounts(value: unknown): PatternCount[] {
  if (Array.isArray(value)) return value.map((v: Json) => ({ code: String(v.code), name: String(v.name || v.code), hex: String(v.hex), count: Number(v.count) }))
  if (value && typeof value === 'object') return Object.entries(value).map(([code, v]) => {
    const item = v as Json
    return { code, name: String(item.name || code), hex: String(item.hex), count: Number(item.count) }
  })
  throw new Error('接口缺少色号用量')
}
function parseVariant(raw: Json, size: 52 | 78 | 104): PatternVariant {
  const source = raw.pattern || raw
  const cells = source.cells
  if (!Array.isArray(cells) || cells.length !== size || !cells.every((row: unknown) => Array.isArray(row) && row.length === size)) throw new Error(`${size}×${size} 图纸数据不完整`)
  const previewUrl = absoluteUrl(raw.preview_data_url || raw.preview_url || source.preview_data_url)
  if (!previewUrl) throw new Error(`${size}×${size} 图纸预览缺失`)
  return { width: size, height: size, cells, counts: parseCounts(source.counts || source.colors), previewUrl }
}
/** Shared API cells are authoritative; incomplete tiers never appear as a successful conversion. */
export function normalizeConversion(raw: Json): ConversionResult {
  const candidates = raw.variants || raw.patterns || raw.pattern_variants
  const find = (size: 52 | 78 | 104): Json | undefined => Array.isArray(candidates)
    ? candidates.find((item: Json) => Number(item.width || item.size) === size)
    : candidates?.[size] || candidates?.[`${size}x${size}`]
  if (!['cartoon_direct', 'scene_direct', 'subject_cartoon'].includes(raw.mode)) throw new Error('接口返回了未知处理路线')
  const variants = { 52: parseVariant(find(52) || {}, 52), 78: parseVariant(find(78) || {}, 78), 104: parseVariant(find(104) || {}, 104) }
  return {
    id: String(raw.task_id || raw.pattern_id || raw.id || Date.now()), mode: raw.mode,
    framingMode: raw.framing_mode || undefined, brand: (raw.brand || 'Artkal') as BeadBrand,
    aiPasses: Number(raw.ai_passes || 0), algorithmVersion: String(raw.algorithm_version || raw.pipeline || ''),
    maxColors: raw.max_colors === undefined ? undefined : Number(raw.max_colors),
    colorSelection: raw.color_selection === 'auto' || raw.color_selection === 'manual' ? raw.color_selection : undefined,
    colorAdvice: raw.color_advice ? {
      recommendedMaxColors: Number(raw.color_advice.recommended_max_colors),
      recommendationAcceptable: Boolean(raw.color_advice.recommendation_acceptable),
    } : undefined,
    images: {
      original: absoluteUrl(raw.raw_image_url || raw.original_image_url),
      ai: absoluteUrl(raw.ai_image_url || raw.clean_image_url),
      subject: absoluteUrl(raw.transparent_image_url || raw.subject_image_url),
    }, variants,
  }
}
async function uploadPattern(input: ConvertInput, endpoint: 'prepare' | 'convert'): Promise<Json> {
  if (!API_BASE_URL) throw new Error('服务地址尚未配置，请联系管理员')
  const generation = localDataEpoch()
  const form = conversionForm(input)
  const attempt = async () => {
    const token = await ensureSession()
    requireLocalDataEpoch(generation)
    const response = await Taro.uploadFile({ url: `${API_BASE_URL}/api/pattern/${endpoint}`, filePath: input.filePath, name: 'image', formData: form, header: { 'X-Session-Token': token }, timeout: 100000 })
    requireLocalDataEpoch(generation)
    let raw: Json
    try { raw = JSON.parse(response.data) } catch { throw new Error('服务器返回了无法识别的数据') }
    return { response, raw }
  }
  let result = await attempt()
  if (result.response.statusCode === 401) {
    invalidateSession()
    result = await attempt()
  }
  if (result.response.statusCode < 200 || result.response.statusCode >= 300) throw new Error(String(result.raw.detail || `请求失败（${result.response.statusCode}）`))
  return result.raw
}
export async function convertPattern(input: ConvertInput): Promise<ConversionResult> {
  return normalizeConversion(await uploadPattern(input, 'convert'))
}
export async function preparePattern(input: ConvertInput): Promise<PreparedConversion> {
  const raw = await uploadPattern(input, 'prepare')
  if (raw.phase !== 'prepared' || !['cartoon_direct', 'scene_direct', 'subject_cartoon'].includes(raw.mode)
    || typeof raw.prepared_image_url !== 'string' || !raw.prepared_image_url.startsWith('data:image/png;base64,')) throw new Error('准备图片数据不完整，请更新后端后重试')
  return {
    id: String(raw.task_id), mode: raw.mode, framingMode: raw.framing_mode || undefined,
    aiPasses: Number(raw.ai_passes || 0), algorithmVersion: String(raw.algorithm_version || ''),
    preparedImage: raw.prepared_image_url,
    images: { original: absoluteUrl(raw.raw_image_url), ai: absoluteUrl(raw.ai_image_url), subject: absoluteUrl(raw.transparent_image_url) },
  }
}
export async function completePreparedPattern(prepared: PreparedConversion, input: Pick<ConvertInput, 'maxColors' | 'colorSelection' | 'brand' | 'requestId'>): Promise<ConversionResult> {
  const result = await convertPattern({ ...input, filePath: prepared.preparedImage,
    mode: prepared.mode === 'scene_direct' ? 'scene_direct' : 'cartoon_direct' })
  return { ...result, mode: prepared.mode, framingMode: prepared.framingMode,
    aiPasses: prepared.aiPasses, images: { ...prepared.images } }
}
