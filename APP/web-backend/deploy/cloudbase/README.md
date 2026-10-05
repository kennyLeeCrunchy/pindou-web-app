# CloudBase 独立 Web 后端部署

本目录只给 `APP/web-backend` 打包，启动 `app.api_main:app`，不替换当前小程序函数。现有腾讯云 HTTP/Web 函数支持的 FastAPI 运行方式继续使用；新的 Web 函数、域名和额度配置需要另行设置。本轮没有部署或创建资源。

## 打包

从仓库根目录执行：

```powershell
python APP/web-backend/deploy/cloudbase/build_package.py
```

脚本会下载 Linux x86_64 / Python 3.10 依赖，使用独立临时目录 `.tmp/web-cloudbase-package`，输出到 `releases/web/YYYY-MM-DD-HHMMSS-cloudbase/pindou-web-python310.zip`，同时生成 SHA-256 清单。只打包本 Web 后端的完整 `app`、`color_standards`、锁定依赖与 bootstrap；排除缓存、`.env` 和 runtime。没有 `app/assets` 时不会因硬复制该目录失败。上传 ZIP 的根目录包含 `scf_bootstrap`，入口监听 `PINDOU_PORT`（默认 9000）。

## 云端配置

创建独立 Web HTTP/Web 函数，上传 Web 专用代码包；不要覆盖小程序函数。bootstrap 使用 `/tmp/pindou-web-runtime`，单 worker，关闭访问日志。先按已有方案以 1024 MB 内存、65 秒初始化超时、90 秒执行超时、每实例并发 1 验证；控制最大实例数。此处是初始验证配置，当前网关超时、资源配额和账号计费状态仍需控制台及真实请求核对。

必需变量：

- `PINDOU_WEB_ACCESS_TOKEN`：独立随机访问凭证，至少 32 字符；浏览器发送 Bearer token。当前所有访客共享额度身份，没有账号注册或登录。
- `PINDOU_CORS_ORIGINS`：实际 Web 前端来源，逗号分隔；使用确切协议、域名和端口。
- `PINDOU_QUOTA_BACKEND=cloudbase`：多实例生产使用持久额度，不能使用重启清空的 local 模式。
- `CLOUDBASE_ENV_ID`：Web 使用的环境 ID。
- `PINDOU_WEB_QUOTA_COLLECTION=pindou_web_quota`：Web 专属集合，提前创建并禁止客户端直接读写。
- `PINDOU_TCB_SECRET_ID` / `PINDOU_TCB_SECRET_KEY`：受限后端身份，具备额度库 `tcb:RunCommands` 权限。
- `PINDOU_TCB_SESSION_TOKEN`：临时凭证使用时必填，并负责刷新。
- `DASHSCOPE_API_KEY`：真人图像处理服务凭证。
- `PINDOU_RATE_MAX_CONVERSIONS`：默认 20；范围及扣额规则由后端代码验证。
- `PINDOU_I2I_TIMEOUT`：bootstrap 默认 70 秒，还受总处理期限和计算预留时间限制。

密钥只放服务端受限环境变量，不放 ZIP 或前端。关闭平台请求及响应正文采集，避免记录图片或访问凭证。CloudBase 环境、数据和账单是否完全独立需用户选择；不同函数和集合不等于独立环境、资源或账单。

## 验证与迁移

离线 Linux 验证：将 ZIP 解压，在包含 app 的目录运行 `PYTHONPATH=third_party:. python3 /path/to/APP/web-backend/deploy/cloudbase/smoke_test.py`。该脚本用测试访问凭证，不请求模型或云额度服务；通过仅说明本地运行兼容，不代表云部署可用。

部署后检查健康接口、合法来源 OPTIONS、无凭证 401、合法 Bearer 两步非 AI 转换、额度查询、重复 AI 请求、超时及进程清理；AI 和云额度需有授权后再实测。文件目录、旧文生图和旧 generate/bundle 路由应不可访问；PNG/PDF 导出接口需验证 Bearer 鉴权。Web 前端还未适配，因此不能称为完整 Web 应用上线。

普通 Python 服务器直接安装依赖后运行 `python run_api.py`；Docker 配置位于后端根目录。除所选的 CloudBase 额度实现外，FastAPI HTTP 契约和算法不依赖函数调用协议。迁离腾讯云时可保留 CloudBase 额度服务；完全取消它需另行实现具备原子扣额能力的持久后端，local 模式只能用于开发。

同目录 `UPDATE_2026-10-03*.md` 是复制基线的小程序历史记录，其中的目录、ZIP 和微信部署步骤不适用于 Web。

地域配置 PINDOU_TCB_REGION 默认 ap-shanghai；Web 专属集合配置禁止使用原小程序的 pindou_quota。AI 尝试扣额，失败不自动返还。


