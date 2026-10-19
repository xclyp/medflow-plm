# PLM 验证记录

日期：2026-10-19。验证范围：本地源码、隔离业务测试、本项目独立D1数据库和R2文件库，没有修改原六套系统代码。

| 检查 | 结果 |
| --- | --- |
| TypeScript严格检查 | 通过 |
| 生产构建 | 通过；RAYON_NUM_THREADS=1 |
| npm test | 29项通过，0失败；包含同级MES源码存在时的完整发布与制造反馈测试 |
| 真实浏览器 | 13项通过，覆盖全部15个业务区域及创建表单 |
| 桌面/移动布局 | 1440px与390px检查通过，无横向溢出 |
| 未捕获页面异常 | 0 |
| 真实供应商模型与外部MCP | 未提供密钥，未验收；协议使用模拟传输测试 |
| PLC/CAD/外部ERP/WMS | 未接入，不能据此声称已完成现场投产 |

## 自动化覆盖

Agent 11项检查URL和权限、配置版本、会话隔离、停止锁、确认卡、重复执行、审计、模型函数工具与HTTP MCP协议。存储4项使用真实SQLite迁移和SQL，检查事务、审计前后值、幂等、并发比较交换、角色禁写和停用及错误数据库绑定。

领域13项覆盖设计发布、签出冻结、BOM循环与回滚、独立签核、需求验证、拒绝退回、文档控制、ECO门禁与完整实施、未来生效、项目交付、上级引用和制造反馈。另1项隔离协同测试验证PLM发布到MES投产完工再反馈。

浏览器验证匿名及伪造头拒绝、登录、全部业务页面和表单、追溯检索、多角色权限、跨站保护、Agent规则摘要/查询/确认/失败不改变业务版本、配置页面以及布局。另真实上传QA文件，校验SHA-256、下载字节一致性，并拒绝伪造文件库对象。

## 本地验证数据

业务自动化测试在内存/内存SQLite中执行，不写入本地工作数据库。浏览器为新项目选择了演示初始化，新增名为“QA只读验证账号”的viewer成员，保存了Agent测试会话和未知业务编号的失败卡片。文件库保留明确命名的QA-validation.txt测试文档（草稿），演示设计已恢复签入。这些记录均为测试资料，不能用作实际生产或工程批准依据。

截图与详细浏览器报告在忽略目录 `.sites-runtime/browser-qa/`，包括overview-desktop.png、overview-mobile.png、trace-desktop.png、agent-settings.png、agent-mobile.png。实际API Key和服务通信密钥未输出或提交。

## 重跑

```powershell
npm run typecheck
npm test
npm run build
```

准备Playwright与Edge/Chrome后，设置PLAYWRIGHT_MODULE（可导入的模块地址）和可选AGENT_TEST_BROWSER（浏览器执行路径），再运行 `node --experimental-strip-types tests/browser.mjs`。浏览器脚本面向已初始化的演示数据；不要直接在真实生产数据库重跑。模型供应商及现场设备需另行验收。
