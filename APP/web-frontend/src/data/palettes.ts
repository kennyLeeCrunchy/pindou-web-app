import artkal from './artkal-m-colors.json'
import mard from './mard-colors.json'
import type { BeadBrand } from '../shared/types'

export type BrandColor = { code: string; series: string; name: string; hex: string }

/* Both full cards are 221 colours grouped into the same A–H/M series letters,
   so the editor's series filter works unchanged for either brand. */
export const BRAND_COLORS: Record<BeadBrand, BrandColor[]> = { Artkal: artkal, Mard: mard }
export const BRAND_LABEL: Record<BeadBrand, string> = { Artkal: 'Artkal M 系列', Mard: 'Mard' }
