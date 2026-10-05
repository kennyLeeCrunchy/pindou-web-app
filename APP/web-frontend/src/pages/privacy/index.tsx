import { Text, View } from '@tarojs/components'
import './index.scss'

const sections = [
  ['我们处理的信息', '当你主动选择图片时，小程序会处理该图片以生成拼豆图纸；作品、图纸参数与编辑记录用于保存和继续制作。'],
  ['权限使用', '相册读取仅在你选择图片时触发；保存到相册仅在你主动导出时触发。拒绝授权不会影响浏览设置和隐私说明。'],
  ['保存与清理', '作品、图纸、编辑记录和过程图片保存在手机；服务端仅保存伪匿名用户标识、当天额度与请求标识，用于限额和防重复。手机数据可在“设置—清理本地数据”中删除。你也可以在作品页删除对应作品。已保存到系统相册的图片请在系统相册中管理。'],
  ['信息共享', '我们不会出售你的个人信息，也不会将你选择的图片用于广告画像。为完成图片处理，三条处理路线都会将图片上传至本产品后端，处理完成或失败后清理临时数据，不在后端保存原图、过程图或图纸。照片重绘还会将图片和描述发送给阿里云 DashScope；第三方服务的数据处理按其隐私政策执行。'],
  ['AI 功能', '仅照片重绘路线调用后端 AI 图片编辑服务。平面版保留原取景；仅主动选择挂饰版时尝试补全身体。主体描述会随图片提交后端处理。照片重绘为实验功能，效果不保证，欢迎反馈。'],
  ['联系我们', '欢迎发送使用反馈、功能建议至邮箱：372278887@qq.com。也可在“设置 → 联系我们”复制邮箱。'],
]

export default function PrivacyPage() {
  return <View className='page-shell privacy-page'>
    <Text className='privacy-title'>隐私与数据说明</Text>
    <Text className='updated'>更新日期：2026 年 10 月 3 日</Text>
    <Text className='intro'>我们坚持最少、必要、透明的原则处理信息。以下说明应与微信公众平台中实际配置并公示的《小程序隐私保护指引》保持一致。</Text>
    {sections.map(([title, body]) => <View className='card privacy-section' key={title}>
      <Text className='section-title'>{title}</Text><Text className='section-body'>{body}</Text>
    </View>)}
  </View>
}
