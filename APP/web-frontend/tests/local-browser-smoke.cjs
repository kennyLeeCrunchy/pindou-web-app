// Optional UI verification: npm install --no-save playwright, or provide the
// installed Playwright module through PINDOU_PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require(process.env.PINDOU_PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PINDOU_TEST_BASE_URL || 'http://localhost:5188'

async function checkNavigationLayout(page) {
  await page.waitForFunction(() => {
    const nav = document.querySelector('.local-nav')?.getBoundingClientRect()
    const pages = [...document.querySelectorAll('main > .taro_page')].filter(node => getComputedStyle(node).display !== 'none')
    return nav && pages.length && pages.every(node => node.getBoundingClientRect().bottom <= nav.top + 1)
  })
}

async function checkDownload(download, name) {
  assert.match(download.suggestedFilename(), /\.png$/)
  const file = await download.path()
  const png = fs.readFileSync(file)
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16) * 3, png.readUInt32BE(20) * 4, `${name}: width:height must be 4:3`)
  if (process.env.PINDOU_EXPORT_DIR) await download.saveAs(path.join(process.env.PINDOU_EXPORT_DIR, `${name}.png`))
}

async function checkEditorHit(page, touchSession) {
  const canvas = page.locator('#edit-canvas')
  await canvas.evaluate(node => node.scrollIntoView({ block: 'start' }))
  await page.waitForFunction(() => {
    const canvas = document.getElementById('edit-canvas')
    return canvas.width === Math.round(canvas.getBoundingClientRect().width * window.devicePixelRatio)
  })
  const sample = await canvas.evaluate(canvas => {
    const rect = canvas.getBoundingClientRect()
    const range = document.querySelector('.view-controls').innerText.match(/(\d+)–(\d+)\s*行.*?(\d+)–(\d+)\s*列/s)
    const columns = +range[4] - +range[3] + 1
    const rows = +range[2] - +range[1] + 1
    const cell = (rect.width - 40) / columns
    const ctx = canvas.getContext('2d'), scale = window.devicePixelRatio
    const navTop = document.querySelector('.local-nav').getBoundingClientRect().top
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = 20 + (column + 0.25) * cell, y = 20 + (row + 0.25) * cell
      if (rect.top + y < 10 || rect.top + y >= navTop - 10) continue
      const pixelX = Math.floor(x * scale), pixelY = Math.floor(y * scale)
      const rgba = [...ctx.getImageData(pixelX, pixelY, 1, 1).data]
      if (rgba.slice(0, 3).some(channel => channel < 220)) return { clientX: rect.left + x, clientY: rect.top + y, pixelX, pixelY, rgba }
    }
  })
  assert.ok(sample, 'Find a visible colored cell from the actual canvas')
  const before = await page.locator('.editor .hint').innerText()
  if (touchSession) {
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sample.clientX, y: sample.clientY }] })
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else await page.mouse.click(sample.clientX, sample.clientY)
  await page.waitForFunction(({ pixelX, pixelY }) => {
    const rgba = document.getElementById('edit-canvas').getContext('2d').getImageData(pixelX, pixelY, 1, 1).data
    return rgba[0] === 255 && rgba[1] === 255 && rgba[2] === 255
  }, sample)
  const after = await page.locator('.editor .hint').innerText()
  assert.equal(+after.match(/(\d+) 颗/)[1], +before.match(/(\d+) 颗/)[1] - 1, 'Only the touched cell is erased')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.waitForFunction(({ pixelX, pixelY, rgba }) => {
    const restored = [...document.getElementById('edit-canvas').getContext('2d').getImageData(pixelX, pixelY, 1, 1).data]
    return restored.every((channel, index) => channel === rgba[index])
  }, sample)
}

async function checkPreview(page, size) {
  await page.waitForFunction(size => {
    const canvas = document.querySelector('.pattern-grid-picture canvas')
    const px = Math.max(2, Math.floor((Math.min(900, window.innerWidth) - 64) / size))
    return canvas && canvas.width === Math.round(size * px * window.devicePixelRatio) &&
      canvas.getContext('2d').getImageData(1, 1, 1, 1).data[3] === 255
  }, size)
  assert.equal(await page.locator('.pattern-grid-picture img, .pattern-grid-picture taro-image-core').count(), 0)
  assert.equal(await page.locator('.pattern-grid-picture canvas').count(), 1)
}

;(async () => {
  const health = await (await fetch(`${base}/api/health`)).json()
  assert.equal(health.service, 'perlabo-web', 'Verify service identity before browser navigation')
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PINDOU_CHROMIUM_PATH ? { executablePath: process.env.PINDOU_CHROMIUM_PATH } : {}),
  })
  let page
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 3 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base)
    await page.getByText('选择图片开始制作', { exact: true }).click()
    await checkNavigationLayout(page)
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByText('上传图片', { exact: true }).click()
    await (await chooserPromise).setFiles(path.join(__dirname, 'fixtures/local-robot.png'))
    await page.locator('.image-preview').waitFor()
    console.log('Image selected')
    await page.route('**/api/pattern/prepare', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '准备失败测试' }) }))
    await page.getByText('第一步：准备图片', { exact: true }).click()
    await page.getByText('图片准备失败', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => {
      const panel = document.querySelector('.status-panel--error')
      return panel.previousElementSibling.textContent.includes('第一步') && panel.nextElementSibling.textContent.includes('第二步')
    }), true)
    await page.unroute('**/api/pattern/prepare')
    let releasePrepare
    const heldPrepare = new Promise(resolve => { releasePrepare = resolve })
    await page.route('**/api/pattern/prepare', async route => { await heldPrepare; await route.continue() })
    await page.getByText('第一步：准备图片', { exact: true }).click()
    await page.getByText('正在准备图片', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => {
      const panel = document.querySelector('.status-panel--loading')
      return panel.previousElementSibling.textContent.includes('第一步') && panel.nextElementSibling.textContent.includes('第二步')
    }), true)
    releasePrepare()
    await page.locator('.prepared-stages').waitFor({ timeout: 100000 })
    await page.unroute('**/api/pattern/prepare')
    const generateButton = page.getByText('第二步：生成三档图纸', { exact: true })
    await generateButton.scrollIntoViewIfNeeded()
    const generateBounds = await generateButton.boundingBox()
    const navBounds = await page.locator('.local-nav').boundingBox()
    assert.ok(generateBounds.y + generateBounds.height < navBounds.y, 'Generation action must be fully above fixed navigation')
    assert.equal(await page.locator('.tier-hint').evaluate(node => node.nextElementSibling?.textContent.includes('第二步：生成三档图纸')), true, 'Generation guidance must precede its action')
    console.log('Image prepared')
    await page.getByText('第二步：生成三档图纸', { exact: true }).click()
    await page.getByText('图纸已生成', { exact: true }).waitFor({ timeout: 100000 })
    await checkNavigationLayout(page)
    console.log('Pattern generated')
    for (const size of [52, 78, 104]) {
      await page.getByText(`${size}×${size}`, { exact: true }).click()
      assert.equal(await page.locator('.size-card.active').innerText().then(text => text.split('\n')[0]), `${size}×${size}`)
      await checkPreview(page, size)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const size of [52, 78, 104]) {
      await page.getByText(`${size}×${size}`, { exact: true }).click()
      await checkPreview(page, size)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    }
    if (process.env.PINDOU_PREVIEW_SCREENSHOT) {
      await page.locator('.pattern-grid-picture').screenshot({ path: process.env.PINDOU_PREVIEW_SCREENSHOT })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByText('78×78', { exact: true }).click()
    const previewDownload = page.waitForEvent('download')
    await page.getByText('保存图纸图片', { exact: true }).click()
    await checkDownload(await previewDownload, 'preview-paper')
    await page.getByText('编辑图纸', { exact: true }).click()
    await page.locator('#edit-canvas').waitFor()
    await checkNavigationLayout(page)
    const canvas = page.locator('#edit-canvas')
    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    await page.mouse.click(box.x + 40, box.y + 40)
    await page.waitForFunction(() => !document.querySelector('.history-button')?.disabled)
    await page.getByRole('button', { name: '撤销', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(), true)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await page.getByText('清空', { exact: true }).click()
    await checkEditorHit(page)
    await page.getByRole('button', { name: '缩小', exact: true }).click()
    await checkEditorHit(page)
    await page.setViewportSize({ width: 390, height: 844 })
    const touch = await page.context().newCDPSession(page)
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await checkEditorHit(page, touch)
    await canvas.evaluate(node => node.scrollIntoView({ block: 'start' }))
    const touchBox = await canvas.boundingBox()
    const beforePan = await page.locator('.editor .hint').innerText()
    const pair = [{ x: touchBox.x + 90, y: touchBox.y + 100 }, { x: touchBox.x + 190, y: touchBox.y + 100 }]
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair.map(point => ({ x: point.x - 36, y: point.y - 36 })) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    assert.equal(await page.locator('.editor .hint').innerText(), beforePan, 'Two-finger pan must not paint')
    await checkEditorHit(page, touch)
    await canvas.evaluate(node => node.scrollIntoView({ block: 'start' }))
    const pinchBox = await canvas.boundingBox()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pinchBox.x + 100, y: pinchBox.y + 100 }, { x: pinchBox.x + 180, y: pinchBox.y + 100 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pinchBox.x + 60, y: pinchBox.y + 100 }, { x: pinchBox.x + 220, y: pinchBox.y + 100 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await checkEditorHit(page, touch)
    await touch.detach()
    await page.setViewportSize({ width: 1280, height: 900 })
    const editorDownload = page.waitForEvent('download')
    await page.getByText('保存图片', { exact: true }).click()
    await checkDownload(await editorDownload, 'editor-paper')
    await page.goBack()
    await page.getByText('当前图纸 · 已保存作品', { exact: true }).waitFor()
    await checkPreview(page, 78)
    await page.getByRole('link', { name: '作品', exact: true }).click()
    await page.getByText('78×78 拼豆图纸', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('78×78 拼豆图纸', { exact: true }).waitFor()
    await page.getByText('看图', { exact: true }).click()
    await page.locator('#view-canvas').waitFor()
    await checkNavigationLayout(page)
    await page.getByText('颜色用量', { exact: true }).waitFor()
    assert.ok(await page.locator('.viewer-usage__item').count() > 0)
    assert.match(await page.locator('.viewer-usage__series').first().innerText(), /系/)
    const viewerDownload = page.waitForEvent('download')
    await page.getByText('保存带色号图纸', { exact: true }).click()
    await checkDownload(await viewerDownload, 'viewer-paper')
    await page.getByRole('link', { name: '制作图纸', exact: true }).click()
    const sceneChooser = page.waitForEvent('filechooser')
    await page.getByText('上传图片', { exact: true }).click()
    await (await sceneChooser).setFiles(path.join(__dirname, 'fixtures/local-robot.png'))
    await page.locator('.image-preview').waitFor()
    await page.getByText('风景整图', { exact: true }).click()
    await page.getByText('Mard 色系', { exact: true }).click()
    await page.getByText('第一步：准备图片', { exact: true }).click()
    await page.locator('.prepared-stages').waitFor({ timeout: 100000 })
    await page.getByText('第二步：生成三档图纸', { exact: true }).click()
    await page.getByText('图纸已生成', { exact: true }).waitFor({ timeout: 100000 })
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    assert.equal(desktopOverflow, false)
    for (const size of [52, 104]) {
      await page.getByText(`${size}×${size}`, { exact: true }).click()
      await page.getByText('编辑图纸', { exact: true }).click()
      await page.locator('#edit-canvas').waitFor()
      await page.goBack()
      await page.getByText('图纸已生成', { exact: true }).waitFor()
    }
    await page.getByRole('link', { name: '作品', exact: true }).click()
    assert.equal(await page.locator('.works-list .card').count(), 3)
    await checkNavigationLayout(page)
    // Wait for the router to hide the previous page before measuring scroll extent.
    await page.waitForFunction(() => [...document.querySelectorAll('.taro_page')].filter(node => getComputedStyle(node).display !== 'none').length === 1)
    await page.setViewportSize({ width: 390, height: 390 })
    assert.equal(await page.locator('.works').evaluate(node => node.scrollHeight > window.innerHeight), true, 'The works list must really exceed one screen')
    const lastCard = page.locator('.works-list .card').last()
    await lastCard.evaluate(node => {
      node.scrollIntoView({ block: 'end' })
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = parent.scrollHeight
      }
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight
    })
    if (process.env.PINDOU_EXPORT_DIR) await page.screenshot({ path: path.join(process.env.PINDOU_EXPORT_DIR, 'works-bottom.png') })
    for (const button of await lastCard.locator('.action-button').all()) {
      const bounds = await button.boundingBox()
      const nav = await page.locator('.local-nav').boundingBox()
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= nav.y, `Every last-card action must remain above bottom navigation: ${JSON.stringify({ bounds, nav })}`)
    }
    assert.equal(await page.locator('.local-nav').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(244, 231, 215)')
    if (process.env.PINDOU_EXPORT_DIR) await page.screenshot({ path: path.join(process.env.PINDOU_EXPORT_DIR, 'works-bottom.png') })
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    mobile.on('pageerror', error => errors.push(error.message))
    await mobile.goto(`${base}/#/pages/home/index`)
    await mobile.getByText('选择图片开始制作', { exact: true }).waitFor()
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    assert.deepEqual(errors, [])
    console.log('PASS: loading/error placement; 52/78/104 previews; mouse/touch hits after scroll, zoom, pan, pinch and resize; all 3 PNG exports are 4:3; viewer color usage; 3-work scroll and bottom navigation; no browser errors')
  } catch (error) {
    if (page) console.error('Visible page:', (await page.locator('body').innerText()).slice(-2400))
    throw error
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
