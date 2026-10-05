import Taro from '@tarojs/taro'
import type CustomTabBar from './index'

export function selectTab(index: number) {
  const page = Taro.getCurrentInstance().page
  if (!page) return
  const tabBar = Taro.getTabBar<CustomTabBar>(page)
  tabBar?.setSelected(index)
}
