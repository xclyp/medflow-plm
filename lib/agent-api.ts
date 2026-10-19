import {env} from 'cloudflare:workers';
import domain from './domain.ts';
import {BusinessError,type Command} from './contracts.ts';
import {identity,executeBusiness,dispatch as dispatchMessages} from './service-api.ts';
import {appStore,executeApp} from './service-store.ts';
import {agentStore} from './agent-store.ts';
import {ACTION_HELP,COLLECTIONS,SYSTEM_POLICY,builtinTools,ensure,object,queryRows,textField,validateCommand,validateConfig} from './agent-core.ts';
import {PROFILE,COLLECTION_LABELS} from './agent-profile.ts';
import {allowedNetwork,mcpClient,modelCompletion} from './agent-network.ts';
const bindings=()=>env as unknown as Record<string,unknown>;
const apiJson=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function failure(e:unknown){if(e instanceof BusinessError)return apiJson({error:e.message,code:e.code},e.status);console.error(PROFILE.system+' agent failed',e);return apiJson({error:'Agent操作未完成，请查看执行记录后再处理',code:'INTERNAL'},500);}
function requireOrigin(request:Request){ensure(request.headers.get('origin')===new URL(request.url).origin,'写操作必须来自当前系统页面','ORIGIN_REJECTED',403);}
async function bodyJson(request:Request){ensure(request.headers.get('content-type')?.startsWith('application/json'),'请使用JSON请求');const body=await request.text();ensure(new TextEncoder().encode(body).length<=131072,'请求过大','TOO_LARGE',413);try{return object(JSON.parse(body));}catch{throw new BusinessError('JSON对象格式无效','INVALID_JSON',400);}}
async function context(request:Request){const actor=identity(request);ensure(env.DB,'独立数据库未绑定','STORAGE_UNAVAILABLE',503);const store=appStore(env.DB,domain);const snap=await store.read();ensure(snap.state.initialized&&!!snap.owner,'请先在本系统主页初始化，再使用Agent','NOT_INITIALIZED',409);const admin=snap.owner===actor;ensure(admin||snap.state.collections.members?.some(r=>r.actor===actor&&r.status==='active'),'当前账号未被授权','FORBIDDEN',403);return {actor,store,snap,admin,agent:agentStore(env.DB)};}
type Context=Awaited<ReturnType<typeof context>>;
function localModel(request:Request){return ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)&&String(bindings().AGENT_ALLOW_LOCAL_MODEL)==='true';}
async function publicState(c:Context,sessionId?:string){const config=await c.agent.config();return {system:PROFILE.system,me:{id:c.actor,admin:c.admin},config:c.admin?config:{revision:config.revision,model:config.model,skills:config.skills.map(s=>({id:s.id,name:s.name,enabled:s.enabled}))},modelReady:!!(config.model&&(bindings().AGENT_MODEL_KEY||String(bindings().AGENT_ALLOW_LOCAL_MODEL)==='true')),sessions:await c.agent.sessions(c.actor),...(sessionId?{session:await c.agent.session(sessionId,c.actor),messages:await c.agent.messages(sessionId),actions:await c.agent.actions(sessionId,c.actor)}:{}),...(c.admin?{history:await c.agent.history()}:{}),audits:await c.agent.audits(c.actor)};}
export async function agentGet(request:Request){try{const c=await context(request);const sessionId=new URL(request.url).searchParams.get('session')||undefined;return apiJson(await publicState(c,sessionId));}catch(e){return failure(e);}}
function rows(c:Context,collection:string){ensure(COLLECTIONS.includes(collection),'查询范围不属于本系统','AGENT_COLLECTION_FORBIDDEN',403);if(collection==='outbox')return c.snap.state.outbox;if(collection==='inbox')return c.snap.inbox.map(({fingerprint,...row})=>row);if(collection==='audit')return c.snap.audit;return c.snap.state.collections[collection]||[];}
function query(c:Context,args:Record<string,unknown>){return queryRows(rows(c,String(args.collection)),String(args.query||'').slice(0,200),Number(args.offset||0),Number(args.limit||30));}
async function propose(c:Context,sessionId:string,args:Record<string,unknown>){const command=validateCommand(args);const card=await c.agent.propose(sessionId,c.actor,'business',{...command,reason:String(args.reason||'用户提出的业务操作').slice(0,1000),businessVersion:c.snap.version});await c.agent.audit(c.actor,sessionId,'action.proposed',{id:card.id,action:command.action});return {approvalRequired:true,actionId:card.id,action:command.action,message:'待用户确认；尚未执行'};}
async function localDiagnostic(c:Context,message:string){
 const lines=['模型尚未配置：以下是本系统规则摘要，不是大模型回复。','',PROFILE.system.toUpperCase()+' / '+PROFILE.title+' / 业务版本 '+c.snap.version];
 for(const collection of COLLECTIONS){if(collection==='audit'||collection==='inbox'||collection==='outbox')continue;const records=rows(c,collection);lines.push('• '+(COLLECTION_LABELS[collection]||collection)+'：'+records.length+'条');const matched=records.filter(raw=>{const row=raw as Record<string,unknown>;return ['id','reference','code','name','customer'].some(k=>typeof row[k]==='string'&&String(row[k]).length>=3&&message.includes(String(row[k])));});for(const raw of matched.slice(0,4)){const row=raw as Record<string,unknown>;lines.push('  '+['id','reference','name','status','quantity','amountCents'].filter(k=>row[k]!==undefined).map(k=>k+'='+String(row[k]).slice(0,100)).join(' / '));}}
 lines.push('','消息：待发送 '+c.snap.state.outbox.filter(m=>m.status==='pending').length+'条，失败 '+c.snap.state.outbox.filter(m=>m.status==='failed').length+'条。','下一步：在业务工具选择数据范围、按名称/编号搜索。需要修改时生成执行卡并确认。自然语言多步工具调用需要先连接模型。');return lines.join('\n');
}
async function chat(c:Context,request:Request,input:Record<string,unknown>){
 const message=textField(input.message,6000);const sessionId=typeof input.sessionId==='string'?input.sessionId:(await c.agent.create(c.actor,message)).id;await c.agent.session(sessionId,c.actor);const token=await c.agent.lock(sessionId,c.actor);
 try{
  await c.agent.message(sessionId,'user',message);const config=await c.agent.config();
  if(!config.model||!(bindings().AGENT_MODEL_KEY||localModel(request))){await c.agent.message(sessionId,'assistant',await localDiagnostic(c,message));return await publicState(c,sessionId);}
  const baseUrl=allowedNetwork(config.baseUrl,bindings(),localModel(request));
  const history=(await c.agent.messages(sessionId)).filter(m=>m.role==='user'||m.role==='assistant').slice(-12).map(m=>({role:m.role,content:m.content.slice(0,6000)}));
  const messages:Record<string,unknown>[]=[{role:'system',content:SYSTEM_POLICY+'\n管理员提示词：\n'+config.prompt+'\n已启用Skill：\n'+config.skills.filter(s=>s.enabled).map(s=>s.name+'\n'+s.instructions).join('\n\n')},...history];
  const tools=builtinTools();const external=new Map<string,{serverId:string;tool:string}>();
  for(const server of (c.admin?config.mcp:[]).filter(s=>s.enabled&&s.allowedTools.length)){
   let client;try{client=await mcpClient(server,bindings(),request.signal);for(const t of await client.list()){const name='mcp_'+external.size;external.set(name,{serverId:server.id,tool:t.name});tools.push({type:'function',function:{name,description:`外部MCP ${server.name} / ${t.name}（需要确认）：${t.description}`,parameters:t.inputSchema}} as ReturnType<typeof builtinTools>[number]);}}catch{await c.agent.audit(c.actor,sessionId,'mcp.discovery.failed',{server:server.id});}finally{await client?.close();}
  }
  for(let step=0;step<6;step++){
   ensure(await c.agent.active(sessionId,token),'任务已停止','AGENT_CANCELLED',409);request.signal.throwIfAborted();
   const reply=await modelCompletion(baseUrl,String(bindings().AGENT_MODEL_KEY||''),config.model,messages,tools,request.signal);ensure(await c.agent.active(sessionId,token),'任务已停止','AGENT_CANCELLED',409);
   const calls=reply.tool_calls as {id:string;type:string;function:{name:string;arguments:string}}[]|undefined;
   if(!calls?.length){await c.agent.message(sessionId,'assistant',typeof reply.content==='string'?reply.content:'模型没有生成文字回复。');break;}
   ensure(Array.isArray(calls)&&calls.length<=8,'单轮工具调用过多','AGENT_LIMIT',400);messages.push({...reply,role:'assistant'});let waiting=false;
   for(const call of calls){ensure(await c.agent.active(sessionId,token),'任务已停止','AGENT_CANCELLED',409);let result:unknown;const name=call.function.name;
    try{const args=object(JSON.parse(call.function.arguments));if(name==='business_query'){c.snap=await c.store.read();result=query(c,args);}else if(name==='business_action_help')result=ACTION_HELP;else if(name==='business_propose'){result=await propose(c,sessionId,args);waiting=true;}else if(external.has(name)){ensure(c.admin,'仅管理员可调用外部MCP','FORBIDDEN',403);const ref=external.get(name)!;const card=await c.agent.propose(sessionId,c.actor,'mcp',{...ref,args,configRevision:config.revision});result={approvalRequired:true,actionId:card.id,message:'外部MCP操作待确认；可能产生外部副作用'};waiting=true;}else throw Error('未知工具');}
    catch(e){result={error:e instanceof Error?e.message:'工具调用失败'};}
    const output=JSON.stringify(result);await c.agent.message(sessionId,'tool',JSON.stringify({tool:name,arguments:call.function.arguments,result}));await c.agent.audit(c.actor,sessionId,'tool.result',{tool:name,result});messages.push({role:'tool',tool_call_id:call.id,content:output.length>12000?JSON.stringify({truncated:true,message:'结果过长，请缩小查询或分页',preview:output.slice(0,11000)}):output});
   }
   if(waiting){await c.agent.message(sessionId,'assistant','已生成执行卡片，请核对下方完整参数后确认或拒绝。当前尚未执行。执行后可以继续对话检查结果。');break;}
   if(step===5)await c.agent.message(sessionId,'assistant','已达到本轮6步工具调用限制。请根据执行记录继续提问。');
  }
 }catch(e){await c.agent.message(sessionId,'assistant','本轮未完成：'+(e instanceof Error?e.message:'执行异常')+'。已确认的业务操作不会自动撤回，请查看执行记录。');await c.agent.audit(c.actor,sessionId,'run.error',{error:e instanceof Error?e.message:'unknown'});}
 finally{await c.agent.unlock(sessionId,token);}
 return await publicState(c,sessionId);
}
async function execute(c:Context,actionId:string,request:Request){
 const card=await c.agent.action(actionId,c.actor);if(card.status==='completed')return {duplicate:true,result:card.result};
 ensure(card.status==='pending','操作已处理或正在执行；不自动重试外部操作','STATE_CONFLICT',409);
 if(card.kind==='mcp')ensure(c.admin,'仅管理员可执行MCP','FORBIDDEN',403);
 ensure(await c.agent.claim(card.id,c.actor),'操作已被其他请求领取','STATE_CONFLICT',409);
 try{const data=object(JSON.parse(card.data));let result:unknown;
  if(card.kind==='business'){const command=validateCommand(data);if(command.action==='integration.dispatch'){const response=await dispatchMessages(request);const delivered=object(await response.json());ensure(response.ok,String(delivered.error||'消息投递失败'),String(delivered.code||'INTEGRATION_FAILED'),response.status);result={notice:delivered.notice,version:delivered.version};}else{const view=await executeBusiness(c.store,{...command.payload,action:command.action,requestId:'agent-'+card.id} as Command,c.actor);result={notice:view.notice,version:view.version};}}
  else{const config=await c.agent.config();ensure(config.revision===data.configRevision,'MCP配置已变更，请重新生成执行卡','CONFIG_CONFLICT',409);const server=config.mcp.find(s=>s.id===data.serverId&&s.enabled);ensure(server,'MCP服务器已停用');const client=await mcpClient(server,bindings(),request.signal);try{result=await client.call(String(data.tool),data.args);}finally{await client.close();}}
  await c.agent.finish(card.id,'completed',result);await c.agent.audit(c.actor,card.session_id,'action.completed',{id:card.id,result});await c.agent.message(card.session_id,'assistant','操作已执行：'+JSON.stringify(result));return result;
 }catch(e){const error=e instanceof Error?e.message:'执行失败';await c.agent.finish(card.id,'failed',{error,note:card.kind==='mcp'?'外部状态可能已改变，请核对外部系统，不自动重试':'请检查本系统业务条件；使用同一执行卡恢复可避免重复业务'});await c.agent.audit(c.actor,card.session_id,'action.failed',{id:card.id,error});throw e;}
}
export async function agentPost(request:Request){try{
 requireOrigin(request);const c=await context(request);const input=await bodyJson(request);const action=String(input.action||'');
 if(action==='chat')return apiJson(await chat(c,request,input));
 if(action==='session.create'){const session=await c.agent.create(c.actor,'新会话');return apiJson(await publicState(c,session.id));}
 if(action==='session.stop'){const sessionId=textField(input.sessionId,100);await c.agent.session(sessionId,c.actor);await c.agent.stop(sessionId,c.actor);await c.agent.audit(c.actor,sessionId,'run.stopped',{});return apiJson(await publicState(c,sessionId));}
 if(action==='query'){const result=query(c,input);await c.agent.audit(c.actor,null,'query.executed',{collection:input.collection,query:input.query,total:result.total});return apiJson(result);}
 if(action==='propose'){const sessionId=textField(input.sessionId,100);await c.agent.session(sessionId,c.actor);await propose(c,sessionId,{...input,action:input.commandAction});return apiJson(await publicState(c,sessionId));}
 if(action==='action.confirm'||action==='action.reject'){const card=await c.agent.action(textField(input.id,100),c.actor);if(action==='action.confirm')await execute(c,card.id,request);else{await c.agent.reject(card.id,c.actor);await c.agent.audit(c.actor,card.session_id,'action.rejected',{id:card.id});}return apiJson(await publicState(c,card.session_id));}
 ensure(c.admin,'仅系统管理员可以配置Agent','FORBIDDEN',403);
 if(action==='config.save'){const config=validateConfig(input.config,localModel(request));await c.agent.saveConfig(config,c.actor);await c.agent.audit(c.actor,null,'config.saved',{revision:config.revision+1});return apiJson(await publicState(c));}
 if(action==='config.restore'){const old=await c.agent.historyConfig(textField(input.id,100));const current=await c.agent.config();await c.agent.saveConfig({...old,revision:current.revision},c.actor);await c.agent.audit(c.actor,null,'config.restored',{id:input.id});return apiJson(await publicState(c));}
 if(action==='mcp.test'){const config=await c.agent.config();const server=config.mcp.find(s=>s.id===input.id&&s.enabled);ensure(server,'请先保存并启用MCP配置');const client=await mcpClient(server,bindings(),request.signal);try{return apiJson({tools:await client.list()});}finally{await client.close();}}
 ensure(false,'未知Agent操作');
 }catch(e){return failure(e);}}
