import type {Domain,DomainState,Command,Context,Envelope,Row} from './contracts.ts';
import {ok,text,integer,number,round,array,date,choice,rows,get,unique,add,initState,memberCommand,safeUrl,BusinessError} from './domain-helpers.ts';
export const COLLECTIONS=['items','revisions','bomLines','routes','documents','reviews','votes','changes','requirements','validations','projects','tasks','baselines','receipts'];
const initial=()=>initState(COLLECTIONS);
const n=(r:Row,k:string)=>Number(r[k]||0);
function editable(s:DomainState,id:unknown,x:Context){const r=get(s,'revisions',id);ok(r.status==='draft','版本不是草稿，已冻结资料不可编辑');ok(r.checkedOutBy===x.actor,'请先签出本版本；只有签出人可以修改');return r;}
function lines(s:DomainState,id:string){return rows(s,'bomLines').filter(l=>l.revisionId===id);}
function route(s:DomainState,id:string){return rows(s,'routes').filter(l=>l.revisionId===id).sort((a,b)=>n(a,'seq')-n(b,'seq'));}
function walk(s:DomainState,id:string,ancestors=new Set<string>(),factor=1):Map<string,number>{
 ok(!ancestors.has(id),'检测到BOM循环引用');ok(ancestors.size<25,'BOM超过25层上限');const next=new Set(ancestors);next.add(id);const result=new Map<string,number>();
 for(const l of lines(s,id)){const child=get(s,'revisions',l.componentRevisionId);const childLines=lines(s,child.id);const q=round(factor*n(l,'quantity')*(1+n(l,'scrapPercent')/100));ok(q>0&&q<=1e9,'展开用量超出范围');
  if(childLines.length){for(const [key,value]of walk(s,child.id,next,q))result.set(key,round((result.get(key)||0)+value));}else result.set(child.id,round((result.get(child.id)||0)+q));
 }return result;
}
function review(s:DomainState,kind:string,target:Row,c:Command,x:Context){
 const reviewers=array(c.reviewers,'评审人').map(v=>text(v.actor,'评审人身份',254).toLowerCase());ok(new Set(reviewers).size===reviewers.length,'评审人不可重复');ok(reviewers.every(a=>a!==target.createdBy),'作者不能独立签核自己的内容');
 for(const actor of reviewers)ok(rows(s,'members').some(m=>m.actor===actor&&m.status==='active'&&m.role==='reviewer'),'评审人必须是已授权且启用的reviewer');
 add(s,'reviews',{kind,targetId:target.id,reviewers,status:'open',round:rows(s,'reviews').filter(v=>v.targetId===target.id&&v.kind===kind).length+1},x);target.status='in_review';
}
function revision(s:DomainState,c:Command,x:Context){
 const item=get(s,'items',c.itemId);ok(item.status==='active','物料已停用');const version=text(c.version,'版本',40);ok(!rows(s,'revisions').some(r=>r.itemId===item.id&&r.version===version),'物料版本已存在');
 let base:Row|undefined;if(c.baseId){base=get(s,'revisions',c.baseId);ok(base.itemId===item.id&&['released','obsolete'].includes(String(base.status)),'派生版本必须来自同一物料的已发布或作废版本');}
 const rev=add(s,'revisions',{itemId:item.id,version,name:text(c.name||item.name,'版本名称'),description:text(c.description,'设计说明',3000),baseId:base?.id||'',status:'draft',checkedOutBy:'',effectiveDate:'',mesStatus:'not_sent',spec:typeof c.spec==='string'?c.spec:''},x);
 if(base){for(const l of lines(s,base.id))add(s,'bomLines',{revisionId:rev.id,componentRevisionId:l.componentRevisionId,quantity:l.quantity,scrapPercent:l.scrapPercent,position:l.position,note:l.note},x);for(const op of route(s,base.id))add(s,'routes',{revisionId:rev.id,seq:op.seq,name:op.name,centerCode:op.centerCode,cycleMinutes:op.cycleMinutes,requiresQC:op.requiresQC,instruction:op.instruction},x);}
 return rev;
}
function initialize(s:DomainState,c:Command,x:Context){ok(!s.initialized,'已初始化，禁止覆盖');s.initialized=true;s.mode=c.demo===true?'demo':'empty';if(c.demo===true){
 rows(s,'items').push({id:'ITEM-PUMP',code:'FG-001',name:'通用微型泵',kind:'product',unit:'台',status:'active'},{id:'ITEM-HOUSING',code:'RM-001',name:'泵体组件',kind:'purchased',unit:'件',status:'active'},{id:'ITEM-SEAL',code:'RM-002',name:'密封圈',kind:'purchased',unit:'件',status:'active'});
 for(const [id,itemId]of [['REV-HOUSING-A','ITEM-HOUSING'],['REV-SEAL-A','ITEM-SEAL']])rows(s,'revisions').push({id,itemId,version:'A',name:get(s,'items',itemId).name,description:'演示采购件规格',status:'released',checkedOutBy:'',createdBy:x.actor,effectiveDate:'2026-01-01',mesStatus:'not_sent',baseId:''});
 const r=revision(s,{action:'revision.create',requestId:'seed-revision',itemId:'ITEM-PUMP',version:'A',name:'微型泵设计A版',description:'适用于离散制造的标准装配示例'},x);r.id='REV-PUMP-A';
 rows(s,'bomLines').push({id:'BOM-1',revisionId:r.id,componentRevisionId:'REV-HOUSING-A',quantity:1,scrapPercent:0,position:'10',note:''},{id:'BOM-2',revisionId:r.id,componentRevisionId:'REV-SEAL-A',quantity:2,scrapPercent:0,position:'20',note:''});
 rows(s,'routes').push({id:'ROUTE-1',revisionId:r.id,seq:10,name:'组件装配',centerCode:'ASSY',cycleMinutes:4,requiresQC:false,instruction:'按作业指导书装配'},{id:'ROUTE-2',revisionId:r.id,seq:20,name:'性能测试',centerCode:'TEST',cycleMinutes:2,requiresQC:true,instruction:'按性能规范检验'});
 }return 'PLM已初始化，演示产品设计仍需正式评审后发布';}
function apply(s:DomainState,c:Command,x:Context):string{
 if(c.action==='system.init')return initialize(s,c,x);ok(s.initialized,'请先初始化PLM');
 const member=memberCommand(s,c,x,['engineer','reviewer','viewer']);if(member)return member;
 if(c.action==='item.create'){const code=text(c.code,'物料编码',80);unique(s,'items','code',code);add(s,'items',{code,name:text(c.name,'名称'),kind:choice(c.kind,'类型',['product','assembly','manufactured','purchased','raw']),unit:text(c.unit,'单位',20),category:text(c.category||'通用','分类'),status:'active'},x);return '物料主档已创建';}
 if(c.action==='item.status'){const item=get(s,'items',c.id);item.status=choice(c.status,'状态',['active','inactive']);item.reason=text(c.reason,'变更原因');return '主档状态已更新，既有版本与基线保留';}
 if(c.action==='revision.create'){revision(s,c,x);return '设计草稿版本已创建；派生版本复制BOM与工艺，文件和验证需重新核对';}
 if(c.action==='revision.checkout'){const r=get(s,'revisions',c.id);ok(r.status==='draft','只有草稿可签出');ok(!r.checkedOutBy||r.checkedOutBy===x.actor,'版本已由其他人签出');r.checkedOutBy=x.actor;return '版本已签出';}
 if(c.action==='revision.checkin'){const r=editable(s,c.id,x);r.checkedOutBy='';r.checkinNote=text(c.note,'签入说明',2000);r.checkedInAt=x.now;return '版本已签入';}
 if(c.action==='revision.edit'){const r=editable(s,c.id,x);r.name=text(c.name,'版本名称');r.description=text(c.description,'设计说明',3000);r.spec=typeof c.spec==='string'?text(c.spec,'规格',2000):r.spec;return '草稿设计说明已更新';}
 if(c.action==='bom.add'){
  const r=editable(s,c.revisionId,x),child=get(s,'revisions',c.componentRevisionId);ok(r.id!==child.id,'BOM不能包含自己');const item=get(s,'items',child.itemId);ok(item.status==='active','组件物料已停用');ok(!lines(s,r.id).some(l=>l.componentRevisionId===child.id),'组件版本重复，请编辑用量');const position=text(c.position,'位号/行号',80);ok(!lines(s,r.id).some(l=>l.position===position),'位号重复');add(s,'bomLines',{revisionId:r.id,componentRevisionId:child.id,quantity:number(c.quantity,'用量'),scrapPercent:number(c.scrapPercent??0,'损耗率（%）',0,100),position,note:typeof c.note==='string'?c.note:''},x);walk(s,r.id);return 'BOM行已添加并通过循环检查';
 }
 if(c.action==='bom.edit'){const l=get(s,'bomLines',c.id);editable(s,l.revisionId,x);l.quantity=number(c.quantity,'用量');l.scrapPercent=number(c.scrapPercent??0,'损耗率',0,100);l.note=typeof c.note==='string'?c.note:'';return 'BOM用量已更新';}
 if(c.action==='bom.remove'){const l=get(s,'bomLines',c.id);editable(s,l.revisionId,x);s.collections.bomLines=rows(s,'bomLines').filter(v=>v.id!==l.id);return '草稿BOM行已移除';}
 if(c.action==='route.add'){
  const r=editable(s,c.revisionId,x),seq=integer(c.seq,'工序号');ok(!route(s,r.id).some(v=>v.seq===seq),'工序号重复');add(s,'routes',{revisionId:r.id,seq,name:text(c.name,'工序名称'),centerCode:text(c.centerCode,'工作中心编码',80),cycleMinutes:number(c.cycleMinutes,'单件标准分钟'),requiresQC:c.requiresQC===true,instruction:text(c.instruction,'作业指导',3000)},x);return '工艺工序已添加';
 }
 if(c.action==='route.remove'){const op=get(s,'routes',c.id);editable(s,op.revisionId,x);s.collections.routes=rows(s,'routes').filter(v=>v.id!==op.id);return '草稿工序已移除';}
 if(c.action==='document.create'){
  const r=editable(s,c.revisionId,x),reference=text(c.reference,'文档编号',100);unique(s,'documents','reference',reference);const sha256=text(c.sha256,'文件SHA-256',64);ok(/^[a-f0-9]{64}$/i.test(sha256),'SHA-256需要64位十六进制值');
  const fileId=typeof c.fileId==='string'?c.fileId:'';if(fileId)ok(/^documents\/[a-f0-9-]{36}\/[a-zA-Z0-9._-]{1,120}$/.test(fileId),'文件库ID格式无效');add(s,'documents',{revisionId:r.id,reference,name:text(c.name,'文件名'),documentVersion:text(c.documentVersion,'文档版本',40),url:fileId?'/api/documents/file?id='+encodeURIComponent(fileId):safeUrl(c.url),sha256:sha256.toLowerCase(),kind:choice(c.kind,'文档类型',['drawing','instruction','specification','test','other']),status:'draft',fileId},x);return '文档受控登记已保存，需审核后才能支持发布';
 }
 if(c.action==='document.approve'){const d=get(s,'documents',c.id);ok(get(s,'revisions',d.revisionId).status==='draft'&&d.status==='draft','文档不是可审核草稿');d.status='approved';d.approvedBy=x.actor;d.approvalEvidence=text(c.evidence,'文档审核依据',2000);return '文档已批准并冻结指纹';}
 if(c.action==='requirement.create'){const r=editable(s,c.revisionId,x);const reference=text(c.reference,'需求号');unique(s,'requirements','reference',reference);add(s,'requirements',{revisionId:r.id,reference,name:text(c.name,'需求'),acceptance:text(c.acceptance,'验收标准',3000),risk:choice(c.risk,'风险等级',['low','medium','high']),status:'open'},x);return '需求及验收标准已登记';}
 if(c.action==='validation.create'){
  const req=get(s,'requirements',c.requirementId),r=get(s,'revisions',req.revisionId);ok(r.status==='draft','只允许验证草稿版本');const result=choice(c.result,'验证结论',['passed','failed']);add(s,'validations',{requirementId:req.id,revisionId:r.id,result,evidence:text(c.evidence,'试验方法与实测依据',4000),reference:text(c.reference,'验证记录号')},x);req.status=result==='passed'?'verified':'failed';return '验证记录已追加；历史记录不可覆盖';
 }
 if(c.action==='revision.submit'){
  const r=get(s,'revisions',c.id);ok(r.status==='draft'&&!r.checkedOutBy,'需先签入草稿');const item=get(s,'items',r.itemId);if(['product','assembly','manufactured'].includes(String(item.kind))){ok(lines(s,r.id).length>0,'制造件必须有BOM');ok(route(s,r.id).length>0,'制造件必须有工艺路线');}
  walk(s,r.id);ok(lines(s,r.id).every(l=>get(s,'revisions',l.componentRevisionId).status==='released'),'所有直接组件版本须已发布');ok(rows(s,'documents').some(d=>d.revisionId===r.id&&d.status==='approved'),'至少需要一份已批准文档');
  ok(rows(s,'requirements').filter(q=>q.revisionId===r.id).every(q=>q.status==='verified'),'需求尚未全部验证通过');review(s,'revision',r,c,x);return '版本已提交评审并冻结；所有指定评审人同意后才能批准';
 }
 if(c.action==='review.vote'){
  const rev=get(s,'reviews',c.id);ok(rev.status==='open','评审已结束');ok((rev.reviewers as string[]).includes(x.actor),'当前用户不是指定评审人');ok(!rows(s,'votes').some(v=>v.reviewId===rev.id&&v.actor===x.actor),'同一评审轮次不可重复投票');const decision=choice(c.decision,'签核意见',['approve','reject']);add(s,'votes',{reviewId:rev.id,actor:x.actor,decision,comment:text(c.comment,'签核意见',2000)},x);
  const target=get(s,rev.kind==='revision'?'revisions':'changes',rev.targetId);if(decision==='reject'){rev.status='rejected';target.status='draft';}else if((rev.reviewers as string[]).every(a=>rows(s,'votes').some(v=>v.reviewId===rev.id&&v.actor===a&&v.decision==='approve'))){rev.status='approved';target.status='approved';target.approvedAt=x.now;}return '签核意见已保存';
 }
 if(c.action==='revision.release'){
  const r=get(s,'revisions',c.id);ok(r.status==='approved','版本未完成评审批准');const effectiveDate=date(c.effectiveDate,'生效日期');if(r.baseId)ok(rows(s,'changes').some(ch=>ch.toRevisionId===r.id&&ch.fromRevisionId===r.baseId&&ch.status==='approved'),'派生版本必须关联已批准工程变更');ok(lines(s,r.id).every(l=>get(s,'revisions',l.componentRevisionId).status==='released'),'组件版本不再处于发布状态');walk(s,r.id);r.status='released';r.effectiveDate=effectiveDate;r.releasedBy=x.actor;r.releasedAt=x.now;
  add(s,'baselines',{revisionId:r.id,item:structuredClone(get(s,'items',r.itemId)),revision:structuredClone(r),bom:structuredClone(lines(s,r.id)),operations:structuredClone(route(s,r.id)),documents:structuredClone(rows(s,'documents').filter(d=>d.revisionId===r.id&&d.status==='approved')),requirements:structuredClone(rows(s,'requirements').filter(q=>q.revisionId===r.id)),status:'frozen'},x);return '版本已发布，BOM、工艺、文档和需求形成冻结基线';
 }
 if(c.action==='revision.obsolete'){const r=get(s,'revisions',c.id);ok(r.status==='released','只有发布版本可作废');ok(!rows(s,'bomLines').some(l=>l.componentRevisionId===r.id&&['in_review','approved','released'].includes(String(get(s,'revisions',l.revisionId).status))),'仍被有效上级BOM引用，需先工程变更');r.status='obsolete';r.obsoleteReason=text(c.reason,'作废原因');return '版本已作废，既有生产快照不会自动更改';}
 if(c.action==='change.create'){
  const reference=text(c.reference,'工程变更号');unique(s,'changes','reference',reference);const from=get(s,'revisions',c.fromRevisionId),to=get(s,'revisions',c.toRevisionId);ok(from.status==='released'&&to.status==='draft'&&to.baseId===from.id,'变更需关联已发布旧版及其派生草稿');add(s,'changes',{reference,fromRevisionId:from.id,toRevisionId:to.id,reason:text(c.reason,'变更原因',3000),impact:text(c.impact,'库存/在制/客户影响及处置',4000),risk:choice(c.risk,'风险',['low','medium','high']),status:'draft'},x);return '工程变更申请已创建';
 }
 if(c.action==='change.submit'){const ch=get(s,'changes',c.id);ok(ch.status==='draft','变更不是草稿');review(s,'change',ch,c,x);return '工程变更已提交独立评审';}
 if(c.action==='change.apply'){const ch=get(s,'changes',c.id);ok(ch.status==='approved','工程变更未批准');const to=get(s,'revisions',ch.toRevisionId);ok(to.status==='released'&&String(to.effectiveDate)<=x.now.slice(0,10),'新版尚未发布生效');ch.implementationEvidence=text(c.evidence,'实际切换依据',3000);ch.status='implemented';ch.implementedAt=x.now;const from=get(s,'revisions',ch.fromRevisionId);from.supersededBy=to.id;return '变更实施已记录，旧版保留历史；请按影响评估处置旧库存与在制品';}
 if(c.action==='package.publish'){
  const r=get(s,'revisions',c.id),item=get(s,'items',r.itemId);ok(r.status==='released'&&String(r.effectiveDate)<=x.now.slice(0,10),'版本尚未发布生效');ok(['product','assembly','manufactured'].includes(String(item.kind)),'采购原料不能直接下发制造');
  ok(!s.outbox.some(m=>m.type==='plm.package.released'&&m.correlationId===r.id),'该版本已排入发件箱，请重试原消息');
  const flattened=walk(s,r.id);const components=[...flattened].map(([id,quantity])=>{const cr=get(s,'revisions',id),ci=get(s,'items',cr.itemId);ok(cr.status==='released','展开后的组件未发布');return {code:ci.code,name:ci.name,unit:ci.unit,revision:cr.version,quantity};});
  const merged=new Map<string,Record<string,unknown>>();for(const comp of components){const key=String(comp.code);const old=merged.get(key);if(old){ok(old.revision===comp.revision,'同一物料存在混用组件版本，需先修正BOM');old.quantity=round(Number(old.quantity)+comp.quantity);}else merged.set(key,{...comp});}
  const operations=route(s,r.id).map(({seq,name,centerCode,cycleMinutes,requiresQC,instruction})=>({seq,name,centerCode,cycleMinutes,requiresQC,instruction}));
  ok(merged.size>0&&operations.length>0,'制造发布包缺少BOM或工艺');x.emit('mes','plm.package.released',{revisionId:r.id,reference:item.code+'-'+r.version,code:item.code,name:item.name,unit:item.unit,revision:r.version,effectiveDate:r.effectiveDate,components:[...merged.values()],operations},r.id);r.mesStatus='queued';return '冻结工程发布包已入发件箱，等待MES实际接收确认';
 }
 if(c.action==='project.create'){const code=text(c.code,'项目号');unique(s,'projects','code',code);add(s,'projects',{code,name:text(c.name,'项目名称'),owner:text(c.owner,'负责人'),dueDate:date(c.dueDate,'目标日期'),status:'active'},x);return '研发项目已建立';}
 if(c.action==='task.create'){const project=get(s,'projects',c.projectId);ok(project.status==='active','项目已关闭');add(s,'tasks',{projectId:project.id,name:text(c.name,'任务/里程碑'),owner:text(c.owner,'负责人'),dueDate:date(c.dueDate,'到期日期'),status:'open',revisionId:typeof c.revisionId==='string'?c.revisionId:''},x);if(c.revisionId)get(s,'revisions',c.revisionId);return '项目任务已建立';}
 if(c.action==='task.complete'){const t=get(s,'tasks',c.id);ok(t.status==='open','任务已关闭');t.evidence=text(c.evidence,'交付依据',2000);t.status='completed';t.completedAt=x.now;return '任务交付已登记';}
 if(c.action==='project.close'){const p=get(s,'projects',c.id);ok(p.status==='active','项目已关闭');ok(rows(s,'tasks').some(t=>t.projectId===p.id)&&rows(s,'tasks').filter(t=>t.projectId===p.id).every(t=>t.status==='completed'),'项目任务未全部完成');p.status='completed';return '项目已关闭';}
 throw new BusinessError('不支持的PLM业务动作：'+c.action,'UNSUPPORTED_ACTION',400);
}
function receive(s:DomainState,e:Envelope,x:Context){ok(e.source==='mes','PLM仅接受定义的MES回执');const p=e.payload,r=get(s,'revisions',p.revisionId);
 if(e.type==='mes.package.accepted'){r.mesStatus='accepted';r.mesRecipeId=text(p.recipeId,'MES工艺ID');add(s,'receipts',{revisionId:r.id,type:e.type,sourceId:p.recipeId,status:'accepted'},x);return 'MES已确认接收此版本';}
 if(e.type==='mes.production.completed'){const orderId=text(p.orderId,'MES工单ID');const prior=rows(s,'receipts').find(v=>v.type===e.type&&v.sourceId===orderId);if(prior){ok(prior.good===p.good&&prior.scrap===p.scrap,'生产回执内容冲突');return '工单回执已保存';}add(s,'receipts',{revisionId:r.id,type:e.type,sourceId:orderId,reference:text(p.reference,'工单号'),good:number(p.good,'良品数量',0),scrap:number(p.scrap,'报废数量',0),status:'completed'},x);return '已归档此设计版本的生产质量反馈';}
 ok(false,'未定义的PLM接口事件');return '';
}
export {walk as explodeBOM};
export default {system:'plm',initial,apply,receive} satisfies Domain;
