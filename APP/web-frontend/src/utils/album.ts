/** Download the PNG after an explicit save action. */
export async function downloadPatternImage(filePath: string): Promise<boolean> {
  if (!/^data:image\/png;base64,/.test(filePath)) throw new Error('导出图片格式无效')
  const link = document.createElement('a')
  link.href = filePath
  link.download = `pindou-${Date.now()}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}
