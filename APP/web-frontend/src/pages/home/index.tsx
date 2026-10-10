import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { getLocalInfo } from '../../services/api'
import logo from '../../assets/perlabo-beaker-mark.png'
import { selectTab } from '../../custom-tab-bar/select'
import './index.scss'

/* Unmount while hidden: without it the home tree bleeds over the page pushed
   on top of it (e.g. convert). The page is static, so rebuilding it is cheap. */
export default function HomePage() {
  const [lanUrl, setLanUrl] = useState<string | null>()
  useEffect(() => { void getLocalInfo().then(info => setLanUrl(info.lan_url)).catch(() => setLanUrl(null)) }, [])
  const [visible, setVisible] = useState(true)
  useDidShow(() => { setVisible(true); selectTab(0) })
  useDidHide(() => setVisible(false))
  const startConvert = () => Taro.navigateTo({ url: '/pages/convert/index' })

  if (!visible) return null

  return (
    <View className='page-shell home-page'>
      <View className='hero'>
        <View className='brand-row'><img className='brand-mark' src={logo} alt='拼豆助手标志' /><Text className='eyebrow'>PERLABO · 拼豆助手</Text></View>
        <Text className='title'>把喜欢的图片，变成清晰的拼豆图纸</Text>
        <Text className='subtitle'>上传图片，选择卡通主体、风景整图或照片重绘，再编辑三档图纸。</Text>
        <button type='button' className='primary-button start-button' onClick={startConvert}>选择图片开始制作</button>
        <View className='privacy-tip'>
          <Text className='privacy-message'>图片在本机后端处理；照片重绘会发送给设置中选择的 AI 服务，按供应商规则计费。</Text>
          <Text className='privacy-link' onClick={() => Taro.navigateTo({ url: '/pages/privacy/index' })}>查看隐私说明 ›</Text>
        </View>
      </View>

      <View className='card steps'>
        <Text className='section-title'>三步完成</Text>
        {[
          ['01', '选择图片', '选择一张清晰的图片'],
          ['02', '生成图纸', '设置网格尺寸并匹配拼豆色号'],
          ['03', '编辑保存', '微调格子后保存作品或图片'],
        ].map(([number, title, description]) => (
          <View className='step' key={number}>
            <Text className='step-number'>{number}</Text>
            <View className='step-copy'>
              <Text className='step-title'>{title}</Text>
              <Text className='step-description'>{description}</Text>
            </View>
          </View>
        ))}
      </View>
      <View className='card lan-help'>
        <Text className='section-title'>手机也能使用</Text>
        <Text className='setting-description'>保持电脑和手机连接同一个网络，电脑需保持开机、应用保持运行。</Text>
        {lanUrl ? <><Text className='lan-address'>手机浏览器输入网址：<br /><a href={lanUrl}>{lanUrl}</a></Text><Text className='setting-description'>打不开时，首次启动时允许 Windows 的局域网授权；若取消，请退出后重新启动，并检查路由器是否开启设备隔离。</Text></> : <Text className='setting-description'>未检测到局域网地址。请连接 Wi-Fi 或有线网络，再退出并重新启动应用。</Text>}
        <Text className='setting-description'>关闭浏览器不会停止服务；在电脑端“设置 → 退出应用”停止。手机作品保存在手机浏览器，不与电脑自动同步。</Text>
      </View>
    </View>
  )
}
