import config from './app-config.ts';
import type {AppConfig,Operation} from './contracts.ts';
export const PROFILE={
  "title": "产品生命周期",
  "accent": "#6250a4",
  "port": 5180,
  "query": "revisions",
  "action": "revision.checkout",
  "heading": "让产品定义、工程变更与发布有据可查。",
  "suggestions": [
    "检查待评审版本和未验证需求",
    "查询BOM组件和版本使用关系",
    "检查工程变更及MES接收回执"
  ],
  "skills": [
    {
      "id": "engineering-release",
      "name": "工程发布检查",
      "instructions": "核对精确组件版本、BOM循环、工序、批准文档、验证结论和独立签核。不得绕过签出人、评审人和作者分离规则。发布成功不等于MES已接收。",
      "enabled": true
    },
    {
      "id": "change-impact",
      "name": "工程变更影响",
      "instructions": "查询旧版与派生新版的BOM、工艺、文档、需求及制造反馈。说明库存、在制与客户影响，执行前要求实际变更批准和切换依据。不能伪造文档指纹、验证数据或签核身份。",
      "enabled": true
    }
  ],
  "system": "plm",
  "prompt": "准确协助产品生命周期人员操作本系统。所有事实从工具查询，缺失数据先询问；修改生成确认卡。尊重成员、签出和签核权限，不能编造现场或工程依据。"
} as const;
const pages=(config as AppConfig).pages;
export const OPERATIONS:Operation[]=pages.flatMap(p=>p.operations??[]);
export const ACTIONS=[...new Set(OPERATIONS.map(o=>o.action).filter(a=>!a.startsWith('system.')&&!a.startsWith('member.'))),'integration.dispatch'];
export const COLLECTION_NAMES=[...new Set([...pages.map(p=>p.collection),'outbox','inbox','audit'])];
export const ACTION_FIELDS:Record<string,unknown>=Object.fromEntries(OPERATIONS.map(o=>[o.action,{label:o.label,description:o.description||'',fields:[...(o.row?[{name:'id',label:'本系统真实记录ID',required:true,type:'text'}]:[]),...o.fields]}]));
ACTION_FIELDS['integration.dispatch']={label:'发送或重试本系统待发消息',description:'经确认后通过现有接口投递，可能影响其他系统。目标系统必须运行并配置服务凭据。',fields:[]};
export const COLLECTION_LABELS:Record<string,string>=Object.fromEntries(pages.map(p=>[p.collection,p.title]));
COLLECTION_LABELS.outbox='发件箱';COLLECTION_LABELS.inbox='收件箱';COLLECTION_LABELS.audit='业务审计';
