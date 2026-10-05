# Pindou Web 应用

此仓库拥有独立的 APP/web-frontend 和 APP/web-backend，不依赖其他三个项目，不使用跨项目软链接或共享源码目录。

已实现：独立 FastAPI Web 后端、Bearer 鉴权、两步图片转换、三档图纸、额度适配及独立配置。后端启动、接口和验证见 [后端说明](APP/web-backend/README.md) 与 [验证记录](APP/web-backend/VALIDATION.md)。从 APP/web-backend 运行 python run_api.py，默认端口 8001；需要配置本目录 .env。

待实现：APP/web-frontend 仍保留 Taro/微信 API 和小程序构建目标，尚未完成浏览器端适配。它是独立保留的 Web 前端迁移基线，不能称为可发布的浏览器应用。身份方案、公开发布、真实 AI 与云数据库联调仍待确定或验证。

每份项目各自维护算法、色卡与素材副本。源码目录独立不等同于 CloudBase 环境、DashScope 账单或真实用户额度独立。服务端密钥只能在本地环境中配置，不进入 Git 或浏览器包。

docs 中历史重构、PRD 和技术报告用于对照，不覆盖当前代码和验证记录。模型根据图片与 prompt 做语义处理；代码仅约束引用、参数、预算、鉴权、并发和结构，不能保证视觉效果。
