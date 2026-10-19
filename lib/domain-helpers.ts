import {BusinessError,requireValue as ok,textValue,integer,find,uid,type DomainState,type Row,type Context} from './contracts.ts';
export {ok,uid,integer,BusinessError};
export const text=(v:unknown,label:string,max=240)=>textValue(v,label,max);
export const rows=(s:DomainState,k:string):Row[]=>s.collections[k]??=[];
export const get=(s:DomainState,k:string,id:unknown)=>find(s,k,id);
export function unique(s:DomainState,k:string,field:string,value:unknown,except?:string){ok(!rows(s,k).some(r=>r[field]===value&&r.id!==except),label(field)+'已存在','DUPLICATE_REFERENCE');}
function label(f:string){return ({code:'编码',reference:'参考号',serial:'序列号'} as Record<string,string>)[f]||f;}
export function number(v:unknown,label:string,min=0.000001,max=1e9){const n=typeof v==='number'?v:Number(v);ok(Number.isFinite(n)&&n>=min&&n<=max&&Math.abs(n*1e6-Math.round(n*1e6))<0.001,label+'须为有效数字，最多6位小数');return n;}
export const round=(n:number)=>Math.round(n*1e6)/1e6;
export function array(v:unknown,label:string,min=1,max=200):Record<string,unknown>[]{let a=v;if(typeof a==='string'){try{a=JSON.parse(a);}catch{throw new BusinessError(label+'格式无效');}}ok(Array.isArray(a)&&a.length>=min&&a.length<=max,label+'需要'+min+'至'+max+'行');return a.map(r=>{ok(r&&typeof r==='object'&&!Array.isArray(r),label+'明细无效');return r as Record<string,unknown>;});}
export function date(v:unknown,label:string){const d=text(v,label,10);ok(/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,label+'格式无效');return d;}
export function choice(v:unknown,label:string,allowed:string[]){const t=text(v,label);ok(allowed.includes(t),label+'不在允许范围');return t;}
export function add(s:DomainState,k:string,data:Record<string,unknown>,x:Context,prefix=k.toUpperCase()+'-'):Row{const row:Row={id:uid(prefix),...data,createdBy:x.actor,at:x.now};rows(s,k).push(row);return row;}
export const initState=(collections:string[]):DomainState=>({initialized:false,mode:'empty',outbox:[],collections:Object.fromEntries([...collections,'members'].map(k=>[k,[]]))});
export function memberCommand(s:DomainState,c:Record<string,unknown>,x:Context,roles:string[]){if(c.action==='member.create'){const actor=text(c.actor,'登录身份',254).toLowerCase();ok(actor!==x.actor,'不可覆盖当前所有者');unique(s,'members','actor',actor);add(s,'members',{actor,name:text(c.name,'姓名'),role:choice(c.role,'角色',roles),status:'active'},x);return '成员已授权';}if(c.action==='member.status'){get(s,'members',c.id).status=choice(c.status,'状态',['active','inactive']);return '成员状态已更新';}return '';}
export function safeUrl(v:unknown){const t=text(v,'文档地址',2000);let u:URL;try{u=new URL(t);}catch{throw new BusinessError('文档地址不是有效URL');}ok(u.protocol==='https:'&&!u.username&&!u.password,'文档使用不含凭据的HTTPS地址');return t;}
