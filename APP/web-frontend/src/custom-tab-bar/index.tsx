import { Component } from 'react'
import Taro from '@tarojs/taro'
import { View } from '@tarojs/components'
import './index.scss'

const tabs = [
  { pagePath: '/pages/home/index', label: '首页', icon: 'home' },
  { pagePath: '/pages/works/index', label: '作品', icon: 'works' },
  { pagePath: '/pages/settings/index', label: '设置', icon: 'settings' },
]

/* Every tab page owns its own tab bar instance. Starting at 0 and correcting in
   useDidShow made the bar flash the wrong key on each switch, so read the
   route at construction instead. */
function currentIndex() {
  const pages = Taro.getCurrentPages()
  const route = pages[pages.length - 1]?.route || ''
  return Math.max(0, tabs.findIndex(tab => tab.pagePath === `/${route}`))
}

export default class CustomTabBar extends Component<{}, { selected: number }> {
  state = { selected: currentIndex() }

  setSelected = (selected: number) => { if (selected !== this.state.selected) this.setState({ selected }) }

  switchTab = (index: number, url: string) => {
    if (index === this.state.selected) return
    void Taro.switchTab({ url }).catch(() => {
      void Taro.showToast({ title: '切换失败，请重试', icon: 'none' })
    })
  }

  render() {
    const { selected } = this.state
    return <View className='pixel-tabbar'>
      {tabs.map((tab, index) => <View
        key={tab.pagePath}
        className={`pixel-key ${selected === index ? 'pixel-key--active' : ''}`}
        hoverClass={selected === index ? 'none' : 'pixel-key--pressed'}
        hoverStayTime={60}
        onClick={() => this.switchTab(index, tab.pagePath)}
      >
        <View className={`pixel-icon pixel-icon--${tab.icon}`} />
        <View className='pixel-key__label'>{tab.label}</View>
      </View>)}
    </View>
  }
}
