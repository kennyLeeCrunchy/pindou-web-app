# 拼豆助手 · Pindou Web

把图片转换成拼豆图纸，在浏览器中查看、编辑、统计颜色用量，并导出带色号和网格的图片。

## 下载即用（Windows）

1. 打开 [Windows 版 Release](https://github.com/kennyLeeCrunchy/pindou-web-app/releases/tag/v0.1.0)，下载 **pindou-web-windows-x64.zip**。
2. 右键“全部提取”，将整个文件夹解压到可写目录。
3. 双击 **Pindou.exe**，浏览器会自动打开 `http://localhost:5188`。

支持 Windows 10/11 x64，无需安装 Python 或 Node.js。不要在压缩包内直接运行，也不要删除 `_internal` 文件夹。服务窗口保持打开，关闭窗口或按 Ctrl+C 即停止运行。若 5188 已被占用，先关闭原来的拼豆服务。

程序未签名，Windows 可能显示未知发布者提示。请从本仓库 Release 下载，并使用同页的 `SHA256SUMS.txt` 校验安装包。详细使用说明见 [Windows 版说明](WINDOWS.md)。

## AI 密钥配置

首次启动会弹出密钥配置窗口。照片 AI 重绘使用 **阿里云百炼北京地域 API Key**，填入自己的 `sk-` 开头的 Key，点击“保存”。也可以选择“暂不配置”，先使用直接转图纸。

以后双击 **配置 AI 密钥.cmd** 即可修改；保存后关闭服务并重新启动。密钥只保存在使用者电脑的 `.env` 文件中，不回传开发者、不进入前端页面，也不随公开安装包分发。不要将配置后的 `.env` 或 `runtime` 文件夹分享给他人。

AI 重绘会将图片和描述发送至阿里云，使用该 Key 所属账户的余额与模型权限。密钥格式检查不能证明 Key 有效或余额充足；模型生成的主体、构图和相似度需要使用者检查。

## 功能

- 支持 JPG、PNG、WebP，较大的图片会在浏览器中压缩后上传本机后端。
- 卡通主体直转、风景整图直转，以及照片 AI 重绘。
- 一次生成 52×52、78×78、104×104 三档图纸，支持 Artkal 和 Mard 色卡。
- 编辑格子、缩放和移动画布、撤销与重做。
- 在浏览器保存作品，查看色号、色系与每种颜色的用量。
- 导出横向 4:3 PNG，包含完整图纸网格、坐标与颜色用量。

图纸尺寸、参数范围和颜色用量由代码校验或统计；AI 重绘效果不由这些校验保证。

## 数据与当前限制

作品和偏好保存在当前浏览器、当前网址的本地存储中。不同电脑、浏览器、地址或端口之间不会自动同步；清理浏览器网站数据会删除本地作品，请及时导出。已下载的 PNG 文件独立保存在电脑中。

Windows 版默认仅允许本机访问。AI 尝试次数在当前服务进程内共用、重启清空，不会重置阿里云余额，也不是正式的个人每日额度。

目前没有公开注册登录、云端作品同步或 Cloudflare Pages/Tunnel 部署。本包不含大型 BiRefNet 抠图模型权重，使用现有算法及可用的白底回退；复杂背景、遮挡和人物重绘效果可能不稳定。尚未完成不同 Windows 电脑的兼容性验收。

## 从源码运行

开发环境需要 Node.js 18+、Python 及后端依赖：

```powershell
python -m pip install -r APP/web-backend/requirements.txt
./start-local.ps1
```

打开 `http://localhost:5188`。首次启动会安装前端 npm 依赖并构建，后续会检测前端变更。更新前端后也可显式执行 `./start-local.ps1 -Rebuild`。

需要局域网访问时，双击仓库中的 **启动Web.cmd**，或执行 `./start-lan.ps1`。首次防火墙配置需要 Windows 管理员确认，手机须连接同一可信 Wi-Fi。源码模式的 AI 配置保存在 `APP/web-backend/.env`，也可在该目录运行 `python run_local.py --configure` 打开密钥窗口。

源码目录：

```text
APP/web-frontend/   React / Taro H5 前端
APP/web-backend/    FastAPI 后端与图纸算法
```

此仓库包含 Web 应用的前后端源码。

## 验证与打包

```powershell
# 在 APP/web-frontend 中
npm run typecheck
npm run test:contract
npm run build

# 在 APP/web-backend 中
python -m unittest tests.test_local_app tests.test_desktop_settings -v

# 回到仓库根目录；需要安装 PyInstaller
python -m pip install pyinstaller
python build-release.py
```

打包脚本仅收集前端产物、后端代码、运行依赖和色卡，不包含本机 `.env` 或作品运行数据。验证记录见 [前端](APP/web-frontend/VALIDATION.md) 与 [后端](APP/web-backend/VALIDATION.md)。默认测试不调用付费模型。
