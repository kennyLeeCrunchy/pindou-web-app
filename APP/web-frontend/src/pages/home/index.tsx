import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Button, Image, Text, View } from '@tarojs/components'
import { useState } from 'react'
import logo from '../../assets/perlabo-beaker-mark.png'
import { selectTab } from '../../custom-tab-bar/select'
import './index.scss'

/* Unmount while hidden: without it the home tree bleeds over the page pushed
   on top of it (e.g. convert). The page is static, so rebuilding it is cheap. */
export default function HomePage() {
  const [visible, setVisible] = useState(true)
  useDidShow(() => { setVisible(true); selectTab(0) })
  useDidHide(() => setVisible(false))
  const startConvert = () => Taro.navigateTo({ url: '/pages/convert/index' })

  if (!visible) return null

  return (
    <View className='page-shell home-page'>
      <View className='hero'>
        <View className='brand-row'><Image className='brand-mark' src={logo} mode='aspectFit' /><Text className='eyebrow'>PERLABO · 拼豆助手</Text></View>
        <Text className='title'>把喜欢的图片，变成清晰的拼豆图纸</Text>
        <Text className='subtitle'>上传图片，选择卡通主体、风景整图或照片重绘，再编辑三档图纸。</Text>
        <Button className='primary-button start-button' onClick={startConvert}>选择图片开始制作</Button>
        <View className='privacy-tip'>
          <Text className='privacy-message'>所选图片会上传到服务器；照片重绘还会交给 AI 服务处理。</Text>
          <Text className='privacy-link' onClick={() => Taro.navigateTo({ url: '/pages/privacy/index' })}>查看隐私说明 ›</Text>
        </View>
      </View>

      <View className='card steps'>
        <Text className='section-title'>三步完成</Text>
        {[
          ['01', '选择图片', '从相册选择一张清晰的图片'],
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
    </View>
  )
}
