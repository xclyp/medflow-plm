# MES / PLM 接口与联调

## 独立边界

MES使用5179端口及自己的D1数据库；PLM使用5180端口、自己的D1数据库和R2文件库。禁止直接跨库写入。应用数据库会检查系统ID，误绑定到其他系统会拒绝访问。

已有六套系统保持原有协议。此次新增加的实际事件只有以下三种，不代表ERP/WMS等旧系统已经能识别它们。

| 方向 | 类型 | 业务含义 |
| --- | --- | --- |
| PLM → MES | plm.package.released | 发布已生效的产品、展开用料和工序快照 |
| MES → PLM | mes.package.accepted | 确认已经建成本地冻结工艺，返回MES工艺ID |
| MES → PLM | mes.production.completed | 反馈此设计版本工单的实际良品和报废 |

## 本地连接

两套源码放在同级目录，任一项目执行：

```powershell
node scripts/link-local.mjs
```

它生成/复用32字符以上的共享INTEGRATION_KEY，设置PEERS_JSON并保存在被Git忽略的.dev.vars。不会输出密钥；若已有不同密钥则拒绝覆盖。模型环境变量保持原样。修改配置后重启两套服务。

MES端需要：

```dotenv
INTEGRATION_KEY=本地生成的共享密钥
PEERS_JSON={"plm":{"url":"http://127.0.0.1:5180"}}
```

PLM端需要：

```dotenv
INTEGRATION_KEY=同一共享密钥
PEERS_JSON={"mes":{"url":"http://127.0.0.1:5179"}}
```

远程地址要求HTTPS。每个环境使用独立凭据；不要公开.dev.vars。

## HTTP契约

- GET /api/integration：登录用户查看对端配置、发件箱和收件回执。
- POST /api/integration/dispatch：所有者以同源请求发送/重试本系统待发消息，每批最多25条。
- POST /api/integration/inbox：对端携带Authorization: Bearer <INTEGRATION_KEY>接收事件，不使用浏览器会话。
- 两端先初始化，服务凭据正确后才能接收。

标准消息结构：

```json
{
  "id": "唯一UUID",
  "source": "plm",
  "target": "mes",
  "type": "plm.package.released",
  "correlationId": "PLM版本ID",
  "at": "2026-10-19T08:00:00.000Z",
  "payload": {
    "revisionId": "PLM版本ID",
    "reference": "FG-001-A",
    "code": "FG-001",
    "name": "通用微型泵",
    "unit": "台",
    "revision": "A",
    "effectiveDate": "2026-10-19",
    "components": [
      {
        "code": "RM-001",
        "name": "泵体组件",
        "unit": "件",
        "revision": "A",
        "quantity": 1
      }
    ],
    "operations": [
      {
        "seq": 10,
        "name": "装配",
        "centerCode": "ASSY",
        "cycleMinutes": 4,
        "requiresQC": false,
        "instruction": "按已发布作业指导书执行"
      }
    ]
  }
}
```

同一消息ID、相同内容重复投递返回duplicate:true；同一ID被不同内容复用会拒绝。MES还按PLM版本ID进行业务去重，内容冲突拒绝。工单生产反馈按MES工单ID防止重复归档。

## 操作式联调

1. 两套系统启动并初始化。MES先建立与PLM工艺一致的工作中心编码，例如ASSY和TEST。
2. PLM完成产品版本、BOM、工艺、批准文档和必要需求验证，签入后交独立评审人签核。
3. 所有者发布版本，生效日期不得晚于发送当天。点击“发送制造发布包”只产生本地待发消息。
4. PLM“接口与消息”点击发送，检查plm.package.released为sent，并在MES工艺列表确认source=plm及sourceRevisionId。
5. MES接口页发送mes.package.accepted；PLM版本显示accepted。
6. MES以该工艺建工单、领料、生产、检验、完工。生成mes.production.completed。
7. MES发送反馈，PLM“制造反馈”出现此工单良品和报废，设计基线不被修改。
8. 对端停机时消息保留失败状态。对端恢复后重试原消息，不要复制同一业务为另一张单据。

## 数量与版本解释

PLM多层BOM按用量×(1+损耗率/100)展开到叶组件，汇总相同物料/相同版本；相同物料出现不同组件版本会阻止发布。MES按展开后的单位产品需求进行领料，生产工单保存冻结工艺快照。

当前模型将整张工单的标准物料在开工前领齐，支持顺序整批工序与分批报工；不包含并行分流、替代料自动选择、联副产品、连续流程生产、按良品倒冲和复杂损耗结转。遇到这些工艺须先扩展模型，不能通过改提示词绕过。

PLM工艺工作中心编码必须在MES存在。物料相同编码要求单位一致；不自动进行跨单位换算。MES生产快照不会因PLM新版本发布而悄悄改动。在制/库存切换由变更影响评估和实际处置决定。

## 验证方式

npm test会执行各系统领域、事务、权限和Agent回归。PLM的tests/collaboration.test.mjs在MES项目存在于同级时执行完整隔离状态机联调；缺少MES源码则明确skip。该测试不会写入用户工作数据库。

tests/browser.mjs检查真实页面、登录权限、结构化表单、Agent与PLM真实文件上传下载；详细记录和截图放在忽略目录.sites-runtime/browser-qa。

真实PLC、ERP、WMS及模型供应商不在这个隔离业务联调的验证范围。
