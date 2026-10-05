> 历史冻结参考：以下为复制基线的小程序部署记录，不代表当前 Web 后端部署、环境或验证结果。Web 请以本目录 README.md 为准。

# 小程序两步流程与智能选色更新

修改前已提交当前全部相关改动，快照为 `58c3ea2`。本次保留照片隐私/额度提示、首页、设置、相册权限处理和仅 AI 扣额度的现有改动。

## 已实现

- 第一步准备图：照片只发送本次用户图片，平面/挂饰均不加风格参考图；已有卡通提取主体、场景保留整图。
- 第一步展示原图、AI 重绘（照片路线）、透明主体（主体路线），另保存完整分辨率准备 PNG。
- 第二步智能选色与 Demo 共用规则：三尺寸全部通过才选最小候选颜色上限，最多 64 色。手动颜色数仍是硬上限。
- 第二步复用微信本地准备 PNG，不调用 AI、不扣重绘额度。从图纸预览返回可更改色数或品牌再生成。
- 小程序风格参考图均移入 backup；旧参考图 HTTP 接口全部 404。
- 服务端只在请求中处理图片，不持久保存跨步骤素材；完整准备图保存在微信本地目录，可由“清除本地数据”清除。

## 更新 CloudBase

使用 `releases/2026-10-03-two-step/perlabo-cloudbase-python310-20261003-two-step.zip`，替换现有 `pindou-api` HTTP/Web 函数代码并部署。保留现有环境变量、入口 `scf_bootstrap`、端口 9000、函数超时与数据库配置；本次不需要新增集合。

部署后 `/api/health` 应正常，`/api/style-reference/qpixel-comparison.png` 应 404。新接口 `/api/pattern/prepare` 需要微信登录 token，不能用未登录请求是否 200 来判断可用。

## 更新微信开发者工具

解压 `releases/2026-10-03-two-step/perlabo-miniprogram-weapp-20261003-two-step.zip` 到一个独立目录，导入包含 `project.config.json` 的目录；其中 `miniprogramRoot` 指向 `dist/`。或将仓库本次构建的 `APP/miniprogram/dist` 更新到现有工程。AppID、正式 API 地址沿用当前项目配置。

先部署后端，再编译新的前端。新前端依赖 `/api/pattern/prepare`；仅替换前端而后端仍为旧版本会导致第一步失败。

## 联调检查

1. 照片挂饰第一步：显示重绘和透明主体；响应 `phase=prepared`、`model_input_image_count=1`、`style_reference_urls=[]`，版本 `manual_route_median_f_grabcut_ephemeral_v14_two_step_auto_no_references`。
2. 第二步：默认智能色数，返回三种尺寸；`max_colors` 是选定上限，各尺寸实际色数可以更少。
3. 从预览返回，改成手动 24/32 色或切换品牌；Network 中只出现 `/api/pattern/convert`，上传 `mode=cartoon_direct`（主体）或 `scene_direct`（场景），响应 `ai_passes=0`。页面保留第一步“AI 重绘 1 次”的过程信息。
4. 检查第二步未增加 AI 额度；平面版、卡通和场景路线、编辑保存、相册权限恢复仍正常。

## 保证范围与待验证

代码限制输入引用、真实色卡、颜色预算、调用路线与额度边界；prompt 只能引导模型保留姿势、肤色等内容，不能保证视觉效果。智能规则阈值沿用 Demo 实验默认值，不能识别脸或判断五官好看；沙箱取色实验没有接入。

本地检查与构建不代表 CloudBase 已更新。本次真实云端部署、微信工具/真机网络和最终视觉效果仍待验证。退出准备页面后的跨会话恢复未实现；原页面从预览返回可以继续调整第二步。

已完成本地验证：后端转换/安全 15 项、Demo 37 项、小程序契约 16 项均通过，TypeScript 类型检查和 preview 构建通过。Linux Python 3.10.12 使用包内原生依赖检查了两步子进程、第一步白衣抠图、第二步 RGBA 逐像素不变、智能预算、硬超时和工作进程清理；模型和云端额度调用模拟。两张已保存样本（Artkal/Mard）与 Demo 的智能建议及三种尺寸网格逐格一致。此验证没有新的付费生图调用。

