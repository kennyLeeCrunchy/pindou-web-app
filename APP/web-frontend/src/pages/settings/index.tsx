import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { selectTab } from '../../custom-tab-bar/select'
import { clearLocalData as clearAllLocalData } from '../../utils/localData'
import './index.scss'

export default function SettingsPage() {
  useDidShow(() => selectTab(2))
  const clearLocalData = async () => {
    const result = await Taro.showModal({
      title: '清理本地数据',
      content: '将清除本机作品、编辑记录、缓存图片和偏好设置，并取消待保存操作。已下载的图片不受影响。',
      confirmText: '确认清理',
      confirmColor: '#b74632',
    })
    if (!result.confirm) return
    try {
      clearAllLocalData()
      await Taro.showToast({ title: '已清理', icon: 'success' })
    } catch {
      await Taro.showToast({ title: '清理失败，请重试', icon: 'none' })
    }
  }

  return (
    <View className='page-shell settings-page'>
      <View className='card setting-group'>
        <View className='setting-row' onClick={() => Taro.navigateTo({ url: '/pages/privacy/index' })}>
          <View>
            <Text className='setting-title'>隐私与数据说明</Text>
            <Text className='setting-description'>了解图片、作品和设备数据的使用方式</Text>
          </View>
          <View className='chevron'><View className='pixel-glyph pixel-glyph--chevron' /></View>
        </View>
      </View>
      <View className='card contact-card'>
        <Text className='setting-title'>联系我们</Text>
        <Text className='contact-email' selectable>372278887@qq.com</Text>
        <Button className='secondary-button contact-copy' onClick={() => Taro.setClipboardData({ data: '372278887@qq.com' })}>复制邮箱</Button>
      </View>
      <View className='card local-data'>
        <Text className='setting-title'>本地数据</Text>
        <Text className='setting-description block'>作品和界面偏好仅保存在当前设备，可随时清理。</Text>
        <Button className='secondary-button clear-button' onClick={clearLocalData}>清理本地数据</Button>
      </View>
      <View className='review-note'>
        <Text className='review-note-title'>当前版本说明</Text>
        <Text className='setting-description block'>照片重绘提供图片 AI 像素重绘；其他路线直接转图纸。作品保存在本机，不提供公开内容发布或用户互动。</Text>
      </View>
      <Text className='version'>拼豆助手 0.1.0</Text>
    </View>
  )
}
