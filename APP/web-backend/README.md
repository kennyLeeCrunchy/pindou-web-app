# Pindou Web 后端

`APP/web-backend` 是独立 FastAPI 服务，只使用本目录源码、色卡和依赖。小程序继续使用 `APP/backend`；本服务不引用该目录或 `versions`。启动入口为 `app.api_main:app`。

## 本地运行

在 `APP/web-backend` 下创建虚拟环境、安装 `requirements.txt`，复制 `.env.example` 为 `.env`。设置随机且至少 32 字符的 `PINDOU_WEB_ACCESS_TOKEN` 后执行 `python run_api.py`，默认监听 `127.0.0.1:8001`。局域网使用 `python run_lan.py`；监听地址和端口由 `PINDOU_HOST`、`PINDOU_PORT` 覆盖。系统环境变量优先于本目录 `.env`。

浏览器请求使用 `Authorization: Bearer <token>`。当前是一个受限单用户访问凭证的私有验证模式，没有注册、登录或独立用户账号；凭证不能打包到前端源码或作为公开网站密钥。生产公开访问前需确定真实用户身份方案。前端来源白名单由 `PINDOU_CORS_ORIGINS` 配置，CORS 仅控制浏览器跨域，不能替代鉴权。

保留两步处理契约：`POST /api/pattern/prepare` 准备图，`POST /api/pattern/convert` 生成图纸，以及只读额度接口 `GET /api/auth/quota`。`GET /api/health` 为健康检查。图片和响应以内存传输；不新增云存储、原图持久化或用户文件下载能力。

## 普通服务器 / Docker

在本目录执行：

```powershell
docker build -t pindou-web-backend .
docker run --rm --env-file .env -e PINDOU_HOST=0.0.0.0 -e PINDOU_QUOTA_BACKEND=cloudbase -p 8001:8001 pindou-web-backend
```

Docker 使用 Python 3.10 和已有锁定的部署依赖，单 worker。容器默认临时目录 `/tmp/pindou-web-runtime`，不挂载小程序运行目录；`.env` 不进入镜像。若未配置 CloudBase，请仅本地验证时使用 `PINDOU_QUOTA_BACKEND=local`。本轮未构建镜像或下载依赖。

## 额度与隔离

`PINDOU_QUOTA_BACKEND=local` 为单进程内存额度，重启清空，多个实例不共享，不能作为生产每日硬额度。`cloudbase` 使用腾讯云文档数据库；需填写独立 Web 凭证、环境和 `PINDOU_WEB_QUOTA_COLLECTION`，默认集合 `pindou_web_quota`。共享访问凭证下所有访客使用同一额度身份，不能称为每个真实用户独立限额。

代码目录独立不保证云账号、CloudBase 环境、数据库、额度、DashScope 账单独立。同一 CloudBase 环境内不同函数及集合可隔离服务和记录，但环境资源、账单仍共享；若要求资源和数据完整隔离，应创建独立环境并使用受限的 Web 专属凭证。当前没有创建、部署或变更任何云资源。

模型基于用户图和 prompt 做图像语义处理，效果由模型判断，不能由代码保证。代码负责验证文件类型、大小、像素数、参数、鉴权、期限、并发和额度；当前原有上传 4 MB、1200 万像素、总处理期限 85 秒及色数约束沿用，云端限制仍需实际验证。

接口字段、请求限制及保证范围见 [Web API 契约](docs/api.md)，CloudBase 代码包步骤见 [部署说明](deploy/cloudbase/README.md)。Web 前端浏览器适配、真实用户身份、公开发布和真实 AI 请求验证均待后续完成。

接口参数与响应以 [Web API 契约](docs/api.md) 为准。AI 尝试在调用前扣额，失败不自动返还；当前未验证真实模型调用。

