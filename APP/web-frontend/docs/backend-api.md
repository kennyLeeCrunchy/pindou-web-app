# 小程序接口契约

本文对应小程序专用 FastAPI 入口 `APP/backend/app/miniprogram_main.py`，不描述 Web API。该入口只提供登录、额度查询、图像准备、转换和健康检查；每一步同步完成，不提供 job 创建或轮询接口。

## 登录

`POST /api/auth/login`

请求 JSON：

```json
{"code":"wx.login 返回的临时 code"}
```

成功响应：

```json
{"token":"服务端签名的会话令牌"}
```

小程序后续转换请求在 `X-Session-Token` header 中携带该 token。token 使用 HMAC 签名，有效期 48 小时；过期或签名无效返回 `401`，客户端重新静默登录后可重试一次。登录请求等待上限为 100 秒，为当前配置的 65 秒云函数冷启动、微信身份交换与网络传输留出余量；已有有效 token 时复用本地缓存。登录依赖服务端 `WX_APPID`、`WX_SECRET` 和至少 32 字节的 `PINDOU_TOKEN_SECRET`。微信登录服务异常返回 `502`，服务端配置缺失返回 `503`。

## 额度查询

`GET /api/auth/quota`，携带 `X-Session-Token`，只查询签名会话对应的账号，不接受客户端指定用户 ID。响应设置 `Cache-Control: no-store`，查询不会新建、重置或扣减额度记录。

普通账号示例：`{"day":"2026-10-03","limit":20,"used":3,"remaining":17,"unlimited":false}`。管理员已解除上限的账号返回 `remaining: null, unlimited: true`，界面显示“不限”；当天没有 AI 记录的普通账号剩余次数为上限值。日期按上海时间计算，接口与扣额使用同一配置上限。

“照片重绘使用说明”首次打开时查询额度，在当前页面内缓存查询结果，再次打开直接显示。AI 准备完成或失败后，以及手动点击“刷新额度”时更新；关闭弹窗不会中断查询，刷新时保留上次的数值，不进行定时轮询。无效会话返回 `401` 后仅重新登录重试一次；数据库不可用返回 `503`，无缓存时显示无法查询，有缓存时注明刷新失败，不能回退为假的 `20/20`。

## 转换

`POST /api/pattern/prepare` 和 `POST /api/pattern/convert`，`multipart/form-data`。两步都必须提供 `X-Session-Token` header。

| 字段 | 要求 |
| --- | --- |
| `image` | JPG、JPEG、PNG 或 WebP；文件非空且不超过 4 MB；解码尺寸不超过 12 MP |
| `request_id` | 必填，16–80 个 ASCII 字母、数字、下划线或连字符；每次新的生成使用新值，同一操作重试时沿用原值 |
| `mode` | `cartoon_direct`、`scene_direct`、`subject_cartoon` 之一 |
| `framing_mode` | 真人路线为 `flat`（默认）或 `pendant`；其他路线必须为 `flat` |
| `subject_target` | 可选，最多 300 字；真人路线使用 |
| `prompt` | 可选，最多 2000 字；真人路线使用 |
| `brand` | `Artkal`（默认）或 `Mard` |
| `preset` | 当前只支持 `221`，默认 `221` |
| `max_colors` | 可选，4–64；智能模式为起始预算，手动模式为硬上限；主体起始 12，场景起始 24 |
| `color_selection` | `auto` 或 `manual`。省略时：未提供 `max_colors` 则智能，提供则手动，兼容旧客户端 |

当前小程序先调用 `prepare`，展示重绘/提取结果，再调用 `convert`。`prepare` 返回 `phase=prepared`、阶段预览及完整分辨率的 `prepared_image_url`（PNG data URL），不计算图纸或智能色数。准备 PNG 不超过 4MB；展示预览最长边 512 像素，不用于第二步取色。

客户端把完整准备 PNG 保存为微信本地文件；第二步上传该文件。主体使用 `mode=cartoon_direct`，完整场景使用 `mode=scene_direct`，所以改色系、色数不构造模型客户端，也不消耗 AI 额度。客户端保留第一步的原路线、取景、AI 次数及过程图用于展示；第二步服务器响应 `ai_passes=0` 是本次调用的实际模型次数。服务端不保存跨步骤图片或引用记录；从预览返回可重复第二步，退出准备页面后的恢复尚未实现。旧客户端直接调用 `convert` 仍兼容一步转换。

智能选色与 Demo 共用 `app/core/color_budget.py`，对 52、78、104 三种尺寸比较完整色卡映射与限色结果：P90 ΔE ≤ 6、ΔE > 12 的格子比例 ≤ 2%、彩度增加 > 12 且 ΔE > 6 的格子比例 ≤ 0.5%。选择全部尺寸通过的最小候选上限；主体默认候选 12/16/24/32/48/64，场景默认 24/32/48/64。全部不通过时返回 64 并标记 `recommendation_acceptable=false`。手动模式计算建议但不覆盖用户上限。阈值是现有 Demo 实验默认值，没有人脸语义识别或质量保证；不包含沙箱取色实验。

平面版、挂饰版都只发送当前用户图片，无附加参考图和参考图使用规则追加。Prompt 的姿势/肤色要求属于模型语义引导，代码只保证输入图片数量及引用结构。

所有路线都上传图片。`subject_cartoon` 把原图发送给 DashScope 做一次白底像素风重绘，随后对重绘结果执行 `demo_pixel_grabcut`；不会在 AI 前抠图。`cartoon_direct` 不调用 AI：保留输入已有透明通道，否则使用 GrabCut。`scene_direct` 保留完整画面，不提取主体。小程序主路径不调用 BiRefNet；主体提取异常时允许白底算法回退，实际结果见 `mask_method`。

仅 `subject_cartoon`（AI 真人重绘）在图片校验和模型输入准备完成后、调用模型前写入 CloudBase `pindou_quota`。默认每个伪匿名用户每天 20 次 AI 尝试；占额后的失败也会占用额度。`cartoon_direct` 和 `scene_direct` 不调用模型，也不读写额度表。管理员可给指定账号的额度记录设置布尔值 `unlimited: true` 解除每日 AI 上限，客户端无法设置；该账号仍计数、仍拒绝当天重复的 `request_id`。AI 请求重复使用当天已提交的 `request_id` 返回 `429`，不会重放上次结果；配额服务不可用或凭证错误时 fail closed 并返回 `503`。非 AI 路线仍受登录、文件大小、处理期限和并发限制，且使用云计算与网络资源。

每一步由单个同步请求完成。每个请求的服务端总处理期限为 85 秒；云函数执行超时配置为 90 秒，小程序上传请求超时为 100 秒。云端模型等待默认最多 70 秒，并为下载和计算预留时间。实际请求还受冷启动、上传速度与网关超时限制影响。文件过大或响应超过 5 MB 返回 `413`，显式格式/参数错误返回 `400`，缺少必填 multipart 字段返回 FastAPI `422`，登录无效返回 `401`，日额度耗尽或请求 ID 已用返回 `429`，转换超时返回 `504`，上游或内部转换失败返回 `502`。调用端不应自动以新 `request_id` 重试失败请求，否则会创建新的计费尝试。

### 成功响应

```json
{
  "task_id": "随机转换 ID",
  "mode": "subject_cartoon",
  "framing_mode": "flat",
  "brand": "Artkal",
  "preset": "221",
  "max_colors": 16,
  "color_selection": "auto",
  "color_advice": {"requested_max_colors": 12, "recommended_max_colors": 16, "recommendation_acceptable": true},
  "ai_passes": 1,
  "algorithm_version": "manual_route_median_f_grabcut_ephemeral_v14_two_step_auto_no_references",
  "pipeline": "manual_route_median_f_grabcut_ephemeral_v14_two_step_auto_no_references",
  "mask_method": "demo_pixel_grabcut",
  "raw_image_url": "data:image/png;base64,...",
  "ai_image_url": "data:image/png;base64,...",
  "transparent_image_url": "data:image/png;base64,...",
  "style_reference_urls": [],
  "style_reference_color_mode": null,
  "model_input_image_count": 1,
  "variants": [
    {
      "width": 52,
      "height": 52,
      "cells": [["...", null]],
      "counts": [{"code":"...","name":"...","hex":"#...","count":1}],
      "preview_data_url": "data:image/png;base64,...",
      "quality": {"overall_score": 0.0,"passed": true,"recommendation":"..."}
    }
  ]
}
```

示例为真人平面路线，字段值仅示意。三条路线都会返回 `raw_image_url`，但其值是内嵌 PNG data URL，不是可再次请求的 HTTP 地址；无 AI 的路线中 `ai_image_url` 为 `null`，场景路线的 `transparent_image_url` 和 `mask_method` 为 `null`。平面版和挂饰版均为 `model_input_image_count=1`、`style_reference_urls=[]`、`style_reference_color_mode=null`。所有小程序风格参考图均已归档，参考图接口已删除。`variants` 固定包含 52、78、104 三项；每项都提供尺寸、网格 `cells`、色号统计 `counts`、PNG 预览 `preview_data_url` 和质量信息 `quality`。

三个阶段预览（原图、AI 重绘图、透明主体图）最长边缩至 512 像素后以内嵌 data URL 返回；三档图纸预览也以内嵌 data URL 返回。响应适配器将这些 data URL 写入微信本地文件，不请求服务端图片存储地址。适配后的 `ConversionResult` 字段见 `src/shared/types.ts`。

## 参考图与健康检查

- `GET /api/style-reference/{name}`：已删除，所有名称返回 `404`。
- `GET /api/health`：返回服务名与版本，用于部署健康检查。

## 图片处理与隐私边界

服务端不会把原图、重绘图、主体图或图纸写入 CloudBase 云存储；图像处理在转换请求期间执行，阶段预览和图纸数据随响应返回。CloudBase 额度表仅保存伪匿名用户 ID、当前日期、已用次数、请求 ID 和可选的不限额标志；活跃用户下次 AI 请求时会重置为新一天的数据，当前实现未给不再活跃用户的额度记录配置自动过期删除。真人原图会交给 DashScope 重绘，第三方服务的数据保留和删除期限不由本项目控制。小程序导出的相册图片不受应用内清理控制。

编辑后的 PNG 由小程序 Canvas 本地绘制并保存到相册，不调用服务端 `/api/export/png` 或 `/api/export/pdf`。当前没有 JSON/PDF 导出入口。

## 部署依赖

CloudBase Web 函数使用 Python 3.10 并监听 `0.0.0.0:9000`；HTTP 函数 body 上限为 6 MB，部署时应保留本契约中的更小上传和响应限制。[CloudBase Web 函数限制](https://cloud.tencent.com/document/product/583/56124) 配额通过腾讯云 CloudBase 文档型数据库 `RunCommands` 写入，需要相应云 API 凭证与权限。[RunCommands API](https://cloud.tencent.com/document/product/876/129012)

部署所需环境变量、bootstrap 和发布配置见 `APP/backend/deploy/cloudbase/`。真实 CloudBase 部署、数据库权限和微信真机联调尚待验证；本地契约测试不能证明这些云端行为可用。
