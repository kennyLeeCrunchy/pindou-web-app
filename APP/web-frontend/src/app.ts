import Taro from '@tarojs/taro'
import type { PropsWithChildren } from 'react'
import { flushEditorHistory } from './store/editorHistory'
import { flushWorks } from './store/works'
import { getSessionToken } from './services/auth'
import './app.scss'

getSessionToken()

/* Both stores debounce their writes so painting a grid does not hit storage on
   every tap; this is where the pending write lands when the app backgrounds. */
Taro.onAppHide(() => {
  try { flushWorks(); flushEditorHistory() }
  catch { void Taro.showToast({ title: '本机保存失败，请释放存储空间', icon: 'none' }) }
})

function App({ children }: PropsWithChildren) {
  return children
}

export default App
