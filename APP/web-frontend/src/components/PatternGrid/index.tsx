import { Canvas, Image, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect } from 'react'
import type { PatternCount } from '../../shared/types'
import { drawCells } from '../../utils/canvas'
import './index.scss'

/* getWindowInfo is a bridge call and this used to run in the render body, so
   every parent re-render paid for it. The width only changes on resize, so
   measure it once and keep recomputing the cell size normally — switching
   between the 52/78/104 tiers must still relayout. */
let measuredWidth = 0
function windowWidth() {
  if (measuredWidth) return measuredWidth
  try { measuredWidth = Taro.getWindowInfo().windowWidth || Taro.getSystemInfoSync().windowWidth } catch { measuredWidth = 375 }
  return measuredWidth
}

export default function PatternGrid({ cells, palette, previewUrl, edited = false }: { cells: (string | null)[][]; palette: PatternCount[]; previewUrl?: string; edited?: boolean }) {
  const size = cells.length
  const px = Math.max(2, Math.floor((windowWidth() - 64) / size))
  useEffect(() => { if (edited || !previewUrl) void drawCells('pattern-preview', cells, palette, 0, 0, size, px) }, [cells, palette, previewUrl, edited, size, px])
  return <View className='pattern-grid-picture'>{!edited && previewUrl
    ? <Image src={previewUrl} mode='aspectFit' />
    : <Canvas type='2d' id='pattern-preview' style={{ width: `${size * px}px`, height: `${size * px}px` }} />}
  </View>
}
