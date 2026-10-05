export function toUserMessage(reason: unknown): string {
  if (reason && typeof reason === 'object') {
    const err = reason as { errMsg?: string; message?: string }
    const message = err.message || err.errMsg || ''
    if (/cancel/i.test(message)) return ''
    if (err.errMsg) console.warn('[微信接口失败]', err.errMsg)
    if (/saveImageToPhotosAlbum/i.test(message)) {
      if (/privacy/i.test(message)) return '相册保存权限尚未满足隐私授权要求，请联系管理员检查隐私指引'
      if (/auth|deny|denied|permission/i.test(message)) return '未获得相册写入权限。请点击右上角三个点 → 设置，开启“保存到相册”后重试。'
      if (/file.*(invalid|not exist)|invalid.*file|no such file/i.test(message)) return '图纸图片文件无效或已被清理，请重新生成后保存'
      return `保存到相册失败：${message.replace(/^saveImageToPhotosAlbum:fail\s*/i, '') || '请检查相册权限和手机存储空间'}`
    }
    if (/canvasToTempFilePath/i.test(message)) return '图纸导出失败，请重新打开图纸后重试'
    if (/timeout/i.test(message)) return '处理超时，请检查网络后重试'
    if (/^(request|uploadFile|downloadFile):fail|network/i.test(message)) return '网络连接异常，请稍后重试'
    if (message) return message
  }
  return '暂时无法完成转换，请稍后重试'
}
