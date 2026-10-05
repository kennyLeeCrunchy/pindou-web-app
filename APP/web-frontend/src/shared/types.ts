export type BeadBrand = 'Artkal' | 'Mard'
export type ConversionMode = 'cartoon_direct' | 'scene_direct' | 'subject_cartoon'
export type FramingMode = 'flat' | 'pendant'
export interface PatternCount { code: string; name: string; hex: string; count: number }
export interface PatternVariant {
  width: 52 | 78 | 104
  height: 52 | 78 | 104
  cells: (string | null)[][]
  counts: PatternCount[]
  previewUrl: string
}
export interface ConversionResult {
  id: string
  mode: ConversionMode
  framingMode?: FramingMode
  brand: BeadBrand
  aiPasses: number
  algorithmVersion: string
  maxColors?: number
  colorSelection?: 'auto' | 'manual'
  colorAdvice?: { recommendedMaxColors: number; recommendationAcceptable: boolean }
  images: { original?: string; ai?: string; subject?: string }
  variants: Record<52 | 78 | 104, PatternVariant>
}
export interface PreparedConversion {
  id: string
  mode: ConversionMode
  framingMode?: FramingMode
  aiPasses: number
  algorithmVersion: string
  preparedImage: string
  images: { original?: string; ai?: string; subject?: string }
}
export interface Work {
  id: string
  conversionId?: string
  name: string
  width: number
  height: number
  brand: BeadBrand
  status: 'draft' | 'completed'
  createdAt: string
  updatedAt: string
  progress: number
  palette: PatternCount[]
  cells: (string | null)[][]
  completedCells?: string[]
  previewDataUrl?: string
  sourceImagePath?: string
}
