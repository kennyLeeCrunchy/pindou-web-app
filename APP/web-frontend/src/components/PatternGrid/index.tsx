import { View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import type { PatternCount } from '../../shared/types'
import { drawCells } from '../../utils/canvas'
import './index.scss'

export default function PatternGrid({ cells, palette }: { cells: (string | null)[][]; palette: PatternCount[] }) {
  const [pixelDensity, setPixelDensity] = useState(window.devicePixelRatio || 1)
  const [width, setWidth] = useState(() => Math.min(900, window.innerWidth))
  useEffect(() => {
    const resize = () => { setWidth(Math.min(900, window.innerWidth)); setPixelDensity(window.devicePixelRatio || 1) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const size = cells.length
  const px = Math.max(2, Math.floor((width - 64) / size))
  useEffect(() => { void drawCells('pattern-preview', cells, palette, 0, 0, size, px, size, { showGrid: true }) }, [cells, palette, size, px, pixelDensity])
  return <View className='pattern-grid-picture'>
    <canvas id='pattern-preview' style={{ width: `${size * px}px`, height: `${size * px}px` }} />
  </View>
}
