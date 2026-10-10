import { Text, View } from '@tarojs/components'
import './index.scss'

const sections = [
  ['本地运行', '此版本的页面和 FastAPI 后端运行在本机。作品保存在当前浏览器，不公开发布。'],
  ['图片处理', '主体直转和风景直转将图片提交给本机 Python 后端处理，不调用生图模型。照片重绘会把图片和描述发送给设置中选择的模型供应商，使用你自己的 API Key；第三方数据处理按其政策执行。'],
  ['保存与清理', '已保存作品、编辑记录和偏好保存在当前浏览器。刷新页面会丢失未保存的转换预览。设置中可以清理浏览器数据；已下载到电脑的文件需在电脑中自行管理。'],
  ['额度', '本地 AI 尝试额度保存在服务进程内存，重启会清空；这不会重置供应商账户余额。失败的模型请求也可能产生费用。'],
  ['密钥', '密钥通过本机设置页填写，只保存到服务端本地配置文件，不回显已保存的密钥；局域网设备不能修改模型配置。'],
  ['AI 效果', '照片重绘根据原图、主体描述和提示词尝试生成卡通像素图。提示词不能保证五官、姿态或颜色一致，请人工检查结果。'],
]

export default function PrivacyPage() {
  return <View className='page-shell privacy-page'>
    <Text className='privacy-title'>隐私与数据说明</Text>
    <Text className='updated'>更新日期：2026 年 10 月 10 日</Text>
    <Text className='intro'>以下说明对应当前 localhost 本机版本。</Text>
    {sections.map(([title, body]) => <View className='card privacy-section' key={title}>
      <Text className='section-title'>{title}</Text><Text className='section-body'>{body}</Text>
    </View>)}
  </View>
}
