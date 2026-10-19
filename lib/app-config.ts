import type {AppConfig} from './contracts.ts';
import {t,num,dt,memo,sel,opts,line,check,op,pg,memberPage} from './ui-schema.ts';
const reviewers=line('reviewers','指定独立评审人',[sel('actor','评审账号','members','actor')]);
export default {system:'plm',name:'MedFlow PLM',tagline:'产品数据 · 版本基线 · 工程变更 · 研发协同',accent:'#6250a4',pages:[
 pg('items','物料与产品','统一产品、装配件、自制件、采购件和原料编码及单位。','code:物料编码|name:名称|kind:类型|category:分类|unit:单位|status:状态:status',[
 op('item.create','新增物料',[t('code','物料编码'),t('name','名称'),opts('kind','类型','product:产品|assembly:装配件|manufactured:自制件|purchased:采购件|raw:原料'),t('category','分类'),t('unit','基本单位')]),
 op('item.status','启停主档',[opts('status','状态','active:启用|inactive:停用'),memo('reason','变更原因')],true)]),
 pg('revisions','设计版本与发布','签出编辑 → 签入 → 独立评审 → 批准 → 发布。已发布版本保留冻结基线。','itemId:物料|version:版本|name:名称|checkedOutBy:签出人|effectiveDate:生效日|mesStatus:MES同步|status:状态:status',[
 op('revision.create','创建版本',[sel('itemId','物料','items'),t('version','版本号'),t('name','版本名称'),memo('description','设计说明'),{...sel('baseId','从已发布版本派生（可不选）','revisions'),required:false}]),
 op('revision.checkout','签出',[],true),op('revision.edit','编辑说明',[t('name','版本名称'),memo('description','设计说明'),memo('spec','规格',false)],true),op('revision.checkin','签入',[memo('note','签入说明')],true),
 op('revision.submit','提交评审',[reviewers],true),op('revision.release','正式发布',[dt('effectiveDate','生效日期')],true),op('package.publish','发送制造发布包',[],true),op('revision.obsolete','作废版本',[memo('reason','作废原因')],true)]),
 pg('bomLines','工程BOM','多层BOM引用精确组件版本；防循环、重复位号，支持用量与损耗。','revisionId:父版本|position:位号|componentRevisionId:组件版本|quantity:单位用量|scrapPercent:损耗%|note:备注',[
 op('bom.add','新增BOM行',[sel('revisionId','已签出父版本','revisions'),sel('componentRevisionId','组件版本','revisions'),t('position','位号/行号'),num('quantity','单位用量'),num('scrapPercent','损耗率（%）',0),memo('note','备注',false)]),
 op('bom.edit','修改用量',[num('quantity','单位用量'),num('scrapPercent','损耗率（%）',0),memo('note','备注',false)],true),op('bom.remove','移除BOM行',[],true)]),
 pg('routes','工艺路线','按工序号编制作业指导、工作中心、标准工时和过程检验要求。','revisionId:产品版本|seq:工序号|name:工序|centerCode:工作中心|cycleMinutes:单件分钟|requiresQC:过程检验',[
 op('route.add','新增工序',[sel('revisionId','已签出版本','revisions'),num('seq','工序号',1),t('name','工序名称'),t('centerCode','MES工作中心编码'),num('cycleMinutes','单件标准分钟'),check('requiresQC','必须过程检验'),memo('instruction','作业指导')]),op('route.remove','移除工序',[],true)]),
 pg('documents','受控文档','可上传真实文件至独立文件库并自动计算SHA-256，也可登记企业HTTPS文档。','reference:文档编号|name:文件名|revisionId:设计版本|documentVersion:文件版本|kind:类型|sha256:指纹|url:文件|status:状态:status',[
 op('document.create','登记受控文件',[sel('revisionId','已签出版本','revisions'),t('reference','唯一文档编号'),t('name','文件名'),t('documentVersion','文件版本'),opts('kind','类型','drawing:图纸|instruction:作业指导书|specification:规格书|test:试验记录|other:其他'),t('url','HTTPS文档地址'),t('sha256','实际文件SHA-256（64位）')]),
 op('document.approve','批准文件',[memo('evidence','文档审核依据')],true)]),
 pg('reviews','评审签核','必须由作者以外的已授权评审人签核；全部通过才批准，拒绝则退回草稿。','kind:评审类型|targetId:对象|reviewers:指定评审人:json|round:轮次|status:状态:status',[
 op('review.vote','提交签核意见',[opts('decision','意见','approve:批准|reject:退回'),memo('comment','评审意见及依据')],true)]),
 pg('votes','签核历史','保留每轮、每人的意见与时间，禁止重复或冒用身份签核。','reviewId:评审单|actor:签核人|decision:结论|comment:意见|at:签核时间:time'),
 pg('changes','工程变更ECR/ECO','旧版 → 派生新版 → 影响评估 → 变更评审 → 新版发布 → 实施确认。','reference:变更号|fromRevisionId:旧版|toRevisionId:新版|risk:风险|status:状态:status',[
 op('change.create','创建工程变更',[t('reference','变更编号'),sel('fromRevisionId','已发布旧版','revisions'),sel('toRevisionId','派生新版草稿','revisions'),memo('reason','变更原因'),memo('impact','对库存、在制、客户、图纸的影响及处置'),opts('risk','风险','low:低|medium:中|high:高')]),
 op('change.submit','提交变更评审',[reviewers],true),op('change.apply','确认变更实施',[memo('evidence','实际切换和处置依据')],true)]),
 pg('requirements','需求与验收','将需求、风险与可验证的验收标准关联到设计版本。','reference:需求号|revisionId:版本|name:需求|risk:风险|acceptance:验收标准|status:验证状态:status',[
 op('requirement.create','新增需求',[sel('revisionId','已签出版本','revisions'),t('reference','需求编号'),t('name','需求名称'),memo('acceptance','验收标准'),opts('risk','风险','low:低|medium:中|high:高')])]),
 pg('validations','设计验证','追加真实试验结论与依据；存在未验证需求时阻止版本评审。','reference:试验记录号|requirementId:需求|revisionId:版本|result:结论|createdBy:验证人|at:时间:time',[
 op('validation.create','登记验证结果',[sel('requirementId','需求','requirements'),t('reference','验证记录号'),opts('result','验证结论','passed:通过|failed:未通过'),memo('evidence','试验方法、实测结果与凭证')])]),
 pg('baselines','发布基线','发布时冻结产品、版本、BOM、工艺、已批准文档及需求快照；独立于后续变更。','revisionId:设计版本|status:状态|createdBy:发布人|at:发布时间:time'),
 pg('projects','研发项目','维护项目负责人和交期，任务全部交付后才能关闭项目。','code:项目号|name:项目名称|owner:负责人|dueDate:目标交期|status:状态:status',[
 op('project.create','新建研发项目',[t('code','项目号'),t('name','项目名称'),t('owner','负责人'),dt('dueDate','目标交期')]),op('project.close','关闭项目',[],true)]),
 pg('tasks','任务与里程碑','跟踪研发交付，关联产品版本并保留交付依据。','projectId:项目|name:任务|owner:负责人|dueDate:期限|revisionId:关联版本|status:状态:status',[
 op('task.create','新建任务',[sel('projectId','项目','projects'),t('name','任务/里程碑'),t('owner','负责人'),dt('dueDate','到期日期'),{...sel('revisionId','关联版本','revisions'),required:false}]),op('task.complete','完成交付',[memo('evidence','交付内容及依据')],true)]),
 pg('receipts','制造反馈','MES接收回执和实际完工反馈按设计版本归档；发出消息不等于已投产。','revisionId:设计版本|type:反馈类型|reference:工单号|sourceId:MES对象|good:良品|scrap:报废|status:状态:status'),
 memberPage('engineer:设计工程师|reviewer:独立评审人|viewer:只读')
]} satisfies AppConfig;
