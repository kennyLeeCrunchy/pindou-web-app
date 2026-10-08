import Taro from '@tarojs/taro'
import { invalidateLocalData } from '../store/dataEpoch'
import { clearWorksCache } from '../store/works'
import { clearAllEditorHistory } from '../store/editorHistory'
import { clearCanvasCache } from './canvas'
import { clearLatestPattern } from './pattern'

export function clearLocalData() {
  invalidateLocalData()
  clearWorksCache()
  clearAllEditorHistory()
  clearCanvasCache()
  clearLatestPattern()
  Taro.clearStorageSync()
}
