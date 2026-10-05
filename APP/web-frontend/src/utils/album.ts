import Taro from '@tarojs/taro'

/** Called only after a save button tap; permission stays under user control. */
export async function saveImageToAlbum(filePath: string): Promise<boolean> {
  const scope = 'scope.writePhotosAlbum'
  const { authSetting } = await Taro.getSetting()
  if (authSetting[scope] === false) {
    const { confirm } = await Taro.showModal({
      title: '允许保存到相册',
      content: '请在微信权限设置中开启“保存到相册”（入口：右上角三个点 → 设置）。',
      confirmText: '去设置',
    })
    if (!confirm) return false
    const settings = await Taro.openSetting()
    if (!settings.authSetting[scope]) throw new Error('相册保存权限未开启。请点击右上角三个点 → 设置，开启“保存到相册”后重试。')
  }
  await Taro.saveImageToPhotosAlbum({ filePath })
  return true
}
