import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import './index.scss'

type Tab = 'home' | 'works' | 'settings'
const items: { key: Tab; label: string; symbol: string; path: string }[] = [
  { key: 'home', label: '首页', symbol: '✦', path: '/pages/home/index' },
  { key: 'works', label: '作品', symbol: '▦', path: '/pages/works/index' },
  { key: 'settings', label: '设置', symbol: '⚙', path: '/pages/settings/index' },
]

export function PixelNav({ selected }: { selected: Tab }) {
  return <View className='pixel-nav'>
    <View className='pixel-nav__frame'>
      {items.map(item => <View key={item.key} className={`pixel-nav__key ${selected === item.key ? 'pixel-nav__key--active' : ''}`} onClick={() => { if (selected !== item.key) void Taro.reLaunch({ url: item.path }) }}>
        <Text className='pixel-nav__symbol'>{item.symbol}</Text>
        <Text className='pixel-nav__label'>{item.label}</Text>
      </View>)}
    </View>
  </View>
}
