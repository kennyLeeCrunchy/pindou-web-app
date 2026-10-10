import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { selectTab } from '../../custom-tab-bar/select'
import { clearLocalData as clearAllLocalData } from '../../utils/localData'
import { useEffect, useState } from 'react'
import { getModelSettings, saveModelSettings, stopLocalApp, type ModelSettings } from '../../services/api'
import './index.scss'

export default function SettingsPage() {
  useDidShow(() => selectTab(2))
  const [modelSettings, setModelSettings] = useState<ModelSettings>()
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('正在读取模型配置…')
  const [saving, setSaving] = useState(false)
  const [stopped, setStopped] = useState(false)
  useEffect(() => { void getModelSettings().then(value => { setModelSettings(value); setMessage('') }).catch(error => setMessage(error.message)) }, [])
  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!modelSettings || saving || stopped) return
    setSaving(true); setMessage('')
    try {
      const { key_configured, ...config } = modelSettings
      const updated = await saveModelSettings({ ...config, api_key: apiKey })
      setModelSettings(updated); setApiKey(''); setMessage('已保存，下一次重绘使用新配置。尚未验证密钥、模型权限或余额。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') }
    finally { setSaving(false) }
  }
  const exit = async () => {
    if (!window.confirm('退出后电脑和手机都无法继续访问，双击 Pindou.exe 可重新启动。是否退出？')) return
    try { await stopLocalApp(); setStopped(true); setMessage('应用已停止，可以关闭此网页。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '退出失败') }
  }
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
      <View className='card ai-settings'>
        <Text className='setting-title'>AI 模型配置</Text>
        <Text className='setting-description'>仅在服务器电脑上修改。图片和描述会发送到你填写的 URL，请使用可信供应商的图片编辑接口。</Text>
        {modelSettings && <form onSubmit={saveSettings}>
          <fieldset disabled={saving || stopped}>
            <label className='ai-label' htmlFor='ai-provider'>模型供应商</label>
            <input className='ai-field' id='ai-provider' value={modelSettings.provider} required maxLength={80} onChange={event => setModelSettings({ ...modelSettings, provider: event.target.value })} />
            <label className='ai-label' htmlFor='ai-protocol'>接口类型</label>
            <select className='ai-field' id='ai-protocol' value={modelSettings.protocol} onChange={event => setModelSettings({ ...modelSettings, protocol: event.target.value as ModelSettings['protocol'] })}><option value='dashscope'>阿里云 DashScope</option><option value='openai'>OpenAI 兼容 · 图片编辑</option></select>
            <label className='ai-label' htmlFor='ai-model'>模型名称</label>
            <input className='ai-field' id='ai-model' value={modelSettings.model} required maxLength={160} spellCheck={false} onChange={event => setModelSettings({ ...modelSettings, model: event.target.value })} />
            <label className='ai-label' htmlFor='ai-url'>API 基础 URL</label>
            <input className='ai-field' id='ai-url' type='url' value={modelSettings.base_url} required maxLength={2048} spellCheck={false} onChange={event => setModelSettings({ ...modelSettings, base_url: event.target.value })} />
            <Text className='setting-description'>填写基础地址，不含最后的接口路径。OpenAI 兼容接口会请求 /images/edits，必须支持图片编辑；仅提供聊天接口的模型无法使用。</Text>
            <label className='ai-label' htmlFor='ai-key'>API Key{modelSettings.key_configured ? '（已保存）' : '（未配置）'}</label>
            <input className='ai-field' id='ai-key' type='password' value={apiKey} maxLength={4096} autoComplete='new-password' placeholder={modelSettings.key_configured ? '留空保留现有密钥；更换 URL 或接口时须重新填写' : '填写你自己的模型密钥'} onChange={event => setApiKey(event.target.value)} />
            <button type='submit' className='raised-button ai-action'>{saving ? '正在保存…' : '保存模型配置'}</button>
          </fieldset>
        </form>}
        <p className='settings-status' role='status'>{message}</p>
        {modelSettings && <button type='button' className='secondary-button exit-button ai-action' disabled={stopped || saving} onClick={exit}>退出应用</button>}
      </View>
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
      <Text className='version'>拼豆助手 0.2.0</Text>
    </View>
  )
}
