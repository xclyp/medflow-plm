import { ensure, object, safeUrl, textField, type McpServer } from './agent-core.ts';

export async function boundedJson(response:Response,max=500000):Promise<Record<string,unknown>>{
 ensure(response.ok,`远程服务返回HTTP ${response.status}`,'AGENT_REMOTE',502);
 const reader=response.body?.getReader();ensure(reader,'远程响应为空','AGENT_REMOTE',502);let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;ensure(size<=max,'远程响应超过限制','AGENT_REMOTE_SIZE',502);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const text=new TextDecoder().decode(bytes);
 if(response.headers.get('content-type')?.includes('text/event-stream')){
  const events=text.split(/\r?\n\r?\n/).map(e=>e.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n')).filter(Boolean);
  for(const event of events.reverse()){try{const x=object(JSON.parse(event));if('result' in x||'error' in x)return x;}catch{}}
  throw new Error('MCP SSE响应中没有JSON-RPC结果');
 }
 return object(JSON.parse(text));
}
function signal(parent?:AbortSignal){return parent?AbortSignal.any([parent,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);}
export async function modelCompletion(baseUrl:string,key:string,model:string,messages:unknown[],tools:unknown[],parent?:AbortSignal){
 const response=await fetch(baseUrl+'/chat/completions',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model,messages,tools,tool_choice:'auto',stream:false,max_tokens:1800}),signal:signal(parent)});
 const body=await boundedJson(response);const choices=body.choices as {message?:Record<string,unknown>}[]|undefined;
 ensure(choices?.[0]?.message,'模型响应缺少message','AGENT_MODEL_FORMAT',502);return choices[0].message;
}
export function allowedNetwork(url:string,bindings:Record<string,unknown>,local=false){
 const normalized=safeUrl(url,local);const host=new URL(normalized).hostname;
 const allowed=String(bindings.AGENT_ALLOWED_HOSTS||'api.openai.com').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 ensure(allowed.includes(host),'此服务主机未列入AGENT_ALLOWED_HOSTS，请由服务器管理员授权','AGENT_HOST_FORBIDDEN',403);return normalized;
}
export async function mcpClient(server:McpServer,bindings:Record<string,unknown>,parent?:AbortSignal){
 const url=allowedNetwork(server.url,bindings);let session='';let version='2025-03-26';
 const headers=()=>({'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':version,...(session?{'Mcp-Session-Id':session}:{}),...(server.tokenEnv&&bindings[server.tokenEnv]?{Authorization:`Bearer ${String(bindings[server.tokenEnv])}`}:{})});
 async function rpc(method:string,params:unknown,notification=false){const r=await fetch(url,{method:'POST',redirect:'manual',headers:headers(),body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:crypto.randomUUID()}),method,params}),signal:signal(parent)});if(r.headers.get('mcp-session-id'))session=r.headers.get('mcp-session-id')!;if(notification){ensure(r.ok,'MCP初始化通知失败','MCP_ERROR',502);await r.body?.cancel();return {};}
  const body=await boundedJson(r);ensure(!body.error,'MCP返回错误，请检查服务日志与工具配置','MCP_ERROR',502);return object(body.result??{});
 }
 try{const init=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'medflow-wms-agent',version:'0.1.0'}});version=String(init.protocolVersion||version);await rpc('notifications/initialized',{},true);}catch(e){await close();throw e;}
 async function close(){if(session)await fetch(url,{method:'DELETE',redirect:'manual',headers:headers(),signal:AbortSignal.timeout(5000)}).then(r=>r.body?.cancel()).catch(()=>{});}
 return {close,async list(){const r=await rpc('tools/list',{});ensure(Array.isArray(r.tools),'MCP工具列表无效');return (r.tools as Record<string,unknown>[]).filter(t=>server.allowedTools.includes(String(t.name))).slice(0,40).map(t=>({name:textField(t.name,100),description:String(t.description||'').slice(0,1000),inputSchema:object(t.inputSchema??{type:'object',properties:{}})}));},async call(name:string,args:unknown){ensure(server.allowedTools.includes(name),'MCP工具不在白名单','MCP_TOOL_FORBIDDEN',403);const result=await rpc('tools/call',{name,arguments:object(args)});ensure(result.isError!==true,'MCP工具返回执行错误；请核对外部状态','MCP_TOOL_ERROR',502);return result;}};
}
