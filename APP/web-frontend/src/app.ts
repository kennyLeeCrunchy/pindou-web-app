import Taro from '@tarojs/taro'
import type { PropsWithChildren } from 'react'
import { createElement } from 'react'
import { flushEditorHistory } from './store/editorHistory'
import { flushWorks } from './store/works'
import './app.scss'

/* Both stores debounce their writes so painting a grid does not hit storage on
   every tap; this is where the pending write lands when the app backgrounds. */
const flushLocalChanges = () => {
  try { flushWorks(); flushEditorHistory() }
  catch { void Taro.showToast({ title: '本机保存失败，请释放存储空间', icon: 'none' }) }
}
window.addEventListener('pagehide', flushLocalChanges)
document.addEventListener('visibilitychange', () => { if (document.hidden) flushLocalChanges() })

function App({ children }: PropsWithChildren) {
  return createElement('main', null,
    createElement('nav', { className: 'local-nav', 'aria-label': '应用导航' },
      ...[['首页', 'home'], ['制作图纸', 'convert'], ['作品', 'works'], ['设置', 'settings']].map(([label, page]) =>
        createElement('a', { key: page, href: `#/pages/${page}/index`, onClick: flushLocalChanges }, label)),
    ), children)
}

export default App
