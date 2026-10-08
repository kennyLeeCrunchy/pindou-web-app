import type { ConversionResult, PatternCount, PatternVariant, PreparedConversion } from '../shared/types'

let latest: ConversionResult | undefined
export function saveLatestPattern(result: ConversionResult) { latest = result }
export function getLatestPattern(): ConversionResult | undefined { return latest }
export function clearLatestPattern() { latest = undefined }

// Browsers can render data URLs directly; no native filesystem is needed.
export async function materializePrepared(result: PreparedConversion): Promise<PreparedConversion> {
  if (!/^data:image\/png;base64,/.test(result.preparedImage)) throw new Error('准备图片格式无效')
  return result
}
export async function materializePreviews(result: ConversionResult): Promise<ConversionResult> { return result }
export function countCells(cells: (string | null)[][], palette: PatternCount[]): PatternCount[] {
  const totals = new Map<string, number>()
  cells.forEach(row => row.forEach(code => { if (code) totals.set(code, (totals.get(code) || 0) + 1) }))
  return palette.filter(item => totals.has(item.code)).map(item => ({ ...item, count: totals.get(item.code)! }))
}
export function totalBeads(variant: PatternVariant) { return variant.counts.reduce((sum, item) => sum + item.count, 0) }
