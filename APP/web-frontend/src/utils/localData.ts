import Taro from '@tarojs/taro'
import { invalidateLocalData } from '../store/dataEpoch'
import { clearWorksCache } from '../store/works'
import { clearAllEditorHistory } from '../store/editorHistory'
import { invalidateSession } from '../services/auth'
import { clearCanvasCache } from './canvas'

export function clearLocalData() {
  invalidateLocalData()
  clearWorksCache()
  clearAllEditorHistory()
  clearCanvasCache()
  invalidateSession()
  const fs = Taro.getFileSystemManager()
  let failed = false
  let names: string[] = []
  try { names = fs.readdirSync(Taro.env.USER_DATA_PATH || '') } catch { failed = true }
  for (const name of names) {
    if (!/^(perlabo-|pattern-)[^/\\]+\.(png|jpg|json)$/.test(name)) continue
    try { fs.unlinkSync(`${Taro.env.USER_DATA_PATH}/${name}`) } catch { failed = true }
  }
  Taro.clearStorageSync()
  if (failed) throw new Error('部分图片清理失败，请重试')
}
