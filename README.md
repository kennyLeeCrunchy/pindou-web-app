# Pindou Web 应用

此仓库拥有独立的 APP/web-frontend 和 APP/web-backend，不依赖其他三个项目，不使用跨项目软链接或共享源码目录。

已实现：localhost 和可信局域网浏览器入口、图片上传、两步转换、三档图纸、鼠标编辑、浏览器作品保存与 PNG 下载。保留独立 FastAPI 后端和原有图纸算法；Taro 构建目标已改为 H5，不引用其他项目。

在此仓库根目录运行 `./start-local.ps1`，打开 **http://localhost:5188**。首次会安装前端依赖并构建；更新前端后使用 `./start-local.ps1 -Rebuild`。后端使用本机 Python（优先 APP/web-backend/.venv），需已安装 APP/web-backend/requirements.txt。首次依赖安装需要联网。停止启动窗口即可停止服务。详细说明见 [本地运行与验证](docs/LOCALHOST.md)。

日常可直接双击 `启动Web.cmd`，自动启动局域网服务并打开浏览器；服务已运行时复用现有服务。首次防火墙配置需要 Windows 管理员确认，详见 [局域网说明](docs/LAN.md)。

默认本地入口只监听 127.0.0.1；运行 `./start-lan.ps1` 可允许当前网卡所属的可信局域网访问，手机与电脑连接同一 Wi-Fi 后打开启动窗口显示的地址。首次需要管理员执行限定网段的防火墙脚本，见 [局域网说明](docs/LAN.md)。两种模式均使用同源 API、临时服务凭据和本地内存额度，不需要微信或手机号登录，不读写 CloudBase 数据。所有受信任的设备共用额度，重启清空。已有阿里云北京配置保存在忽略提交的 APP/web-backend/.env；AI 重绘仍会向阿里云发送图片、消耗现有账户额度。模型密钥不进入前端包。

待验证/确定：真实付费 AI 请求的效果与耗时、公开注册登录、公开发布及云端接入。本机运行完成不代表公开上线条件已满足。API 单独运行仍可使用 `python run_api.py`，端口默认 8001、需要独立 Bearer 凭据。

后续方案：Cloudflare Pages 托管前端，Cloudflare Tunnel 连接本机 FastAPI。账号、域名、Access 登录和 API 代理仍待配置，当前未创建公网入口。准确的构建路径与连接顺序见 [Cloudflare 配置准备](docs/CLOUDFLARE.md)。

每份项目各自维护算法、色卡与素材副本。源码目录独立不等同于 CloudBase 环境、DashScope 账单或真实用户额度独立。服务端密钥只能在本地环境中配置，不进入 Git 或浏览器包。

docs 中历史重构、PRD 和技术报告用于对照，不覆盖当前代码和验证记录。模型根据图片与 prompt 做语义处理；代码仅约束引用、参数、预算、鉴权、并发和结构，不能保证视觉效果。
