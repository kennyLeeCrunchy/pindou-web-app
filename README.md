# 拼豆助手 · Pindou Web

把图片转换成拼豆图纸，在浏览器中查看、编辑、统计颜色用量，并导出带色号和网格的图片。

## 下载即用（Windows）

[![下载 Windows 版](https://img.shields.io/badge/下载_Windows_版-v0.2.0-E04A42?style=for-the-badge)](https://github.com/kennyLeeCrunchy/pindou-web-app/releases/download/v0.2.0/pindou-web-windows-x64.zip)

1. 点击上方按钮，直接下载 **pindou-web-windows-x64.zip**。无需下载 Source code。
2. 右键“全部提取”，将整个文件夹解压到可写目录。
3. 双击 **Pindou.exe**，浏览器会自动打开 `http://localhost:5188`。

支持 Windows 10/11 x64，无需安装 Python 或 Node.js。不要在压缩包内直接运行，也不要删除 `_internal` 文件夹。后台运行，不弹终端。在电脑网页“设置 → 退出应用”停止服务；关闭浏览器不会停止服务。升级前请先退出旧版。

程序未签名，Windows 可能显示未知发布者提示。请从本仓库 Release 下载，并使用同页的 `SHA256SUMS.txt` 校验安装包。详细使用说明见 [Windows 版说明](WINDOWS.md)。

## 模型配置与手机访问

在电脑网页 **设置 → AI 模型配置** 填写供应商、接口类型、模型、基础 URL 和自己的 API Key。默认 **阿里云百炼北京 / DashScope / qwen-image-3.0-pro**。支持 OpenAI 兼容的图片编辑接口，不能使用纯聊天接口；具体请求与返回格式见 [Windows 版说明](WINDOWS.md)，协议参考 [官方图片编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)。

保存后下一次重绘立即生效。密钥只保存在服务器电脑的 `.env` 文件，不回显到网页，也不随安装包分发。更换 URL 或接口时须填写对应供应商的密钥；不要分享 `.env` 或 `runtime`。

双击 EXE 默认启动同一私有网段的局域网服务，首页显示手机访问地址。保持电脑和手机连接同一个网络、电脑应用持续运行；首次 Windows 防火墙管理员授权需允许。手机不能修改模型配置或退出服务，同网段设备可使用你的 AI 额度，因此只在可信网络中使用。只需本机时可运行 `Pindou.exe --local-only`。

供应商名称仅用于显示；接口类型、URL 和模型决定实际请求。字段格式由代码校验，密钥有效性、模型权限与余额尚未通过付费调用验证；重绘效果仍需人工检查。

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

Windows 版默认允许本机及检测到的私有网段访问。AI 尝试次数在当前服务进程内共用、重启清空，不会重置供应商余额，也不是正式的个人每日额度。

目前没有公开注册登录、云端作品同步或 Cloudflare Pages/Tunnel 部署。本包不含大型 BiRefNet 抠图模型权重，使用现有算法及可用的白底回退；复杂背景、遮挡和人物重绘效果可能不稳定。尚未完成不同 Windows 电脑的兼容性验收。

## 从源码运行

开发环境需要 Node.js 18+、Python 及后端依赖：

```powershell
python -m pip install -r APP/web-backend/requirements.txt
./start-local.ps1
```

打开 `http://localhost:5188`。首次启动会安装前端 npm 依赖并构建，后续会检测前端变更。更新前端后也可显式执行 `./start-local.ps1 -Rebuild`。

需要局域网访问时，双击仓库中的 **启动Web.cmd**，或执行 `./start-lan.ps1`。首次防火墙配置需要 Windows 管理员确认，手机须连接同一可信 Wi-Fi。源码模式的 AI 配置保存在 `APP/web-backend/.env`，配置可在电脑端网页设置修改。

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
python -m unittest tests.test_local_app tests.test_local_settings -v

# 回到仓库根目录；需要安装 PyInstaller
python -m pip install pyinstaller
python build-release.py
```

打包脚本仅收集前端产物、后端代码、运行依赖和色卡，不包含本机 `.env` 或作品运行数据。验证记录见 [前端](APP/web-frontend/VALIDATION.md) 与 [后端](APP/web-backend/VALIDATION.md)。默认测试不调用付费模型。
