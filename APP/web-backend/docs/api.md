# Web API 契约（0.4.0）

状态：独立 Web 后端适配已实现；浏览器前端、公开注册登录和正式部署尚未实现。当前源码目录为 `APP/web-backend`，所有接口由标准 FastAPI 入口 `app.api_main:app` 提供。

## 认证与接口

当前采用受限单用户访问模式：服务端配置 `PINDOU_WEB_ACCESS_TOKEN`（至少 32 字符、不含空白），调用方发送 `Authorization: Bearer <token>`。凭据缺失或配置不合法返回 503，调用方凭据不匹配返回 401。所有使用同一凭据的请求共用一个额度身份；这不是多用户登录系统。凭据只能由受信任调用方输入或配置，不能嵌入公开前端构建包。微信 `code`、`X-Session-Token` 和小程序令牌不受支持；不存在 `/api/auth/login`。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 公开健康检查，service=`perlabo-web`，version=`0.4.0` |
| GET | `/api/auth/quota` | 今日额度：day、limit、used、remaining、unlimited |
| GET | `/api/palette?brand=Artkal或Mard` | 品牌色卡及 presets |
| POST | `/api/pattern/prepare` | 上传图片并准备主体/场景或 AI 重绘结果 |
| POST | `/api/pattern/convert` | 上传图片并生成三档图纸 |
| POST | `/api/export/png` | 根据客户端提交的编辑图纸生成 PNG |
| POST | `/api/export/pdf` | 根据客户端提交的编辑图纸生成 PDF |

除 health 外，表中业务接口均需要 Bearer 凭据。允许来源的 OPTIONS 跨域预检无需凭据；来源由 `PINDOU_CORS_ORIGINS` 配置。旧文生图、旧 generate/bundle 路由、微信登录、静态用户文件和在线 OpenAPI 文档不开放。

## 图片准备与转换

使用 multipart/form-data；图片字段为 `image`，文件名后缀须为 jpg/jpeg/png/webp，文件最大 4 MiB，解码最大 1200 万像素。

| 字段 | 取值与行为 |
| --- | --- |
| `mode` | cartoon_direct（主体直转）、scene_direct（场景直转）、subject_cartoon（AI 重绘） |
| `request_id` | 必填，16–80 位英文数字、下划线或短横线 |
| `framing_mode` | flat 或 pendant；仅 subject_cartoon 支持 pendant |
| `subject_target` | 最多 300 字符 |
| `prompt` | 最多 2000 字符 |
| `brand` | Artkal 或 Mard，默认 Artkal |
| `preset` | 仅 221 |
| `max_colors` | 4–64；场景默认 24，主体默认 12 |
| `color_selection` | auto 或 manual；未指定时，有 max_colors 则 manual，否则 auto |

prepare 返回 phase=`prepared`、prepared_image_url（完整 PNG data URL）、原图/AI图/主体预览、路线、算法版本及 AI 次数。convert 返回 variants，每项含 width/height、cells、counts、preview_data_url 和 quality；尺寸为 52、78、104，并返回品牌、选色预算和过程预览。

前端可把 prepared_image_url 转为上传文件，再以 scene_direct 或 cartoon_direct 调用 convert，避免再次 AI 重绘。当前后端不保存任务或准备图引用，不能根据 task_id 验证第二步是否确实沿用了第一步结果；task_id 是响应标识，不能当持久任务查询 ID。每次 subject_cartoon 请求均可能产生新的模型调用。

AI 请求在主进程完成参数、图片、模型密钥和并发检查后扣减额度，再启动工作子进程；重复 AI request_id 返回 429。额度按尝试预扣，模型失败、超时或结果超限不自动返还。直转不消耗 AI 额度。local 后端仅支持本地单进程开发，重启清空；CloudBase 后端负责跨实例持久化。调用来源和凭据不再是微信接口，图像模型提供方目前仍是 DashScope。

## 导出

JSON 输入 width、height、cells、colors；宽高范围 1–200，cells 尺寸必须一致，colors 最多 221 项，code 不得重复，cells 中所有非空色号都必须提供颜色定义。颜色项含 code、hex（6 位颜色值，可有 #）、name。pattern_id 可作兼容元数据，但不读取服务端旧图纸文件。结果是二进制图片/PDF，浏览器可读取 Content-Disposition 下载文件。

导出校验保证网格结构和颜色引用有效，不保证用户提交的颜色属于真实品牌色卡。图纸生成使用服务端色卡，人工编辑后的导出允许提交自定义颜色。

## 限制及保证范围

沿用来源版本的单实例转换锁，繁忙返回 429；转换期限为 85 秒，超时终止工作子进程。JSON 转换响应和导出文件上限 5 MiB。入口检查 Content-Length 不超过 4 MiB + 64 KiB；这是声明长度检查，不等于对无 Content-Length 的任意请求实现流式总大小限制。图片实际读取另外有 4 MiB 限制。生产入口应配合网关请求限制。

prompt 语义判断：输入原图、主体目标、用户描述和取景方式，输出模型重绘图片；依据提示词引导姿势、肤色、服装主色与轮廓。提示词无法保证视觉保真，需人工验收。

代码硬约束：请求结构、允许路线、上传/像素/色数限制、认证、额度、超时和导出结构。质量评分与主体抠图结果也不等于视觉质量保证。

待确定：公开用户登录方式、正式 Web 云环境、每日额度及失败返还政策是否调整、上线的并发/资源配置。当前阈值沿用来源版，不能视为已完成容量测试。
