import type { BeadBrand, ConversionMode, ConversionResult, FramingMode, PatternCount, PatternVariant, PreparedConversion } from '../shared/types'
import { localDataEpoch, requireLocalDataEpoch } from '../store/dataEpoch'

export const API_BASE_URL = ''
async function localRequest(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, { ...init, headers: { ...init.headers, 'X-Pindou-Local': '1' }, signal: AbortSignal.timeout(100000) })
  } catch (reason) {
    if (reason instanceof Error && /timeout|abort/i.test(reason.name)) throw new Error('处理超时，请重试')
    throw new Error('本地服务连接失败，请确认启动窗口仍在运行')
  }
}
export interface QuotaStatus { limit: number; remaining: number | null; unlimited: boolean }
export async function getQuotaStatus(): Promise<QuotaStatus> {
  const generation = localDataEpoch()
  const response = await localRequest('/api/auth/quota', { cache: 'no-store' })
  const raw = await response.json()
  requireLocalDataEpoch(generation)
  if (!response.ok) throw new Error('额度暂时无法查询，请稍后重试')
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
  if (/^(https?:|blob:|data:)/.test(value)) return value
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
  const generation = localDataEpoch()
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(input.filePath)) throw new Error('图片格式无效，请重新选择')
  const blob = await (await fetch(input.filePath)).blob()
  requireLocalDataEpoch(generation)
  const form = new FormData()
  form.append('image', blob, `image.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`)
  for (const [key, value] of Object.entries(conversionForm(input))) form.append(key, value)
  const response = await localRequest(`/api/pattern/${endpoint}`, { method: 'POST', body: form })
  let raw: Json
  try { raw = await response.json() } catch { throw new Error('本地服务返回了无法识别的数据') }
  requireLocalDataEpoch(generation)
  if (!response.ok) throw new Error(typeof raw.detail === 'string' ? raw.detail : `请求失败（${response.status}）`)
  return raw
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
