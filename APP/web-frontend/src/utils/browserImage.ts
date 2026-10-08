export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new window.Image()
  const ready = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
  })
  image.src = src
  return ready
}

export function canvasImage(canvas: HTMLCanvasElement, type = 'png', quality = 1): { tempFilePath: string } {
  return { tempFilePath: canvas.toDataURL(type === 'jpg' ? 'image/jpeg' : 'image/png', quality) }
}

export function chooseImageFile(): Promise<File | undefined> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp'
  input.style.display = 'none'
  document.body.appendChild(input)
  return new Promise(resolve => {
    const finish = () => { const file = input.files?.[0]; input.remove(); resolve(file) }
    input.onchange = finish
    input.addEventListener('cancel', finish, { once: true })
    input.click()
  })
}

export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}
