import { DEFAULT_CONFIG, ensure, type AgentConfig } from './agent-core.ts';
export interface AgentSession {id:string;actor:string;title:string;busy:string|null;at:string;}
export interface AgentMessage {id:string;session_id:string;role:string;content:string;at:string;}
export interface AgentAction {id:string;session_id:string;actor:string;kind:string;data:string;status:string;result:string|null;at:string;}
export function agentStore(db:D1Database){
 const now=()=>new Date().toISOString();const id=()=>crypto.randomUUID();
 return {
  async config(){const row=await db.prepare('SELECT data FROM agent_config WHERE id=?').bind('warehouse').first<{data:string}>();return row?JSON.parse(row.data) as AgentConfig:structuredClone(DEFAULT_CONFIG);},
  async saveConfig(config:AgentConfig,actor:string){const revision=config.revision+1;const value=JSON.stringify({...config,revision});const at=now();const token=id();const results=await db.batch([
   db.prepare('INSERT INTO agent_config(id,revision,data,actor,at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,actor=excluded.actor,at=excluded.at WHERE agent_config.revision=?').bind('warehouse',revision,value,actor,at,config.revision),
   db.prepare('INSERT INTO agent_config_history(id,revision,data,actor,at) SELECT ?,revision,data,actor,at FROM agent_config WHERE id=? AND data=? AND at=?').bind(token,'warehouse',value,at)
  ]);ensure(results[0].meta.changes===1,'配置已被其他人修改，请刷新','CONFIG_CONFLICT',409);return {...config,revision};},
  async history(){return (await db.prepare('SELECT id,revision,actor,at FROM agent_config_history ORDER BY revision DESC LIMIT 30').all()).results;},
  async historyConfig(historyId:string){const row=await db.prepare('SELECT data FROM agent_config_history WHERE id=?').bind(historyId).first<{data:string}>();ensure(row,'版本不存在','NOT_FOUND',404);return JSON.parse(row.data) as AgentConfig;},
  async sessions(actor:string){return (await db.prepare('SELECT * FROM agent_sessions WHERE actor=? ORDER BY at DESC LIMIT 40').bind(actor).all<AgentSession>()).results;},
  async session(sessionId:string,actor:string){const row=await db.prepare('SELECT * FROM agent_sessions WHERE id=? AND actor=?').bind(sessionId,actor).first<AgentSession>();ensure(row,'会话不存在','NOT_FOUND',404);return row;},
  async create(actor:string,title:string){const row={id:id(),actor,title:title.slice(0,70),busy:null,at:now()};await db.prepare('INSERT INTO agent_sessions(id,actor,title,at) VALUES(?,?,?,?)').bind(row.id,actor,row.title,row.at).run();return row;},
  async lock(sessionId:string,actor:string){const token=id();const r=await db.prepare('UPDATE agent_sessions SET busy=?,at=? WHERE id=? AND actor=? AND busy IS NULL').bind(token,now(),sessionId,actor).run();ensure(r.meta.changes===1,'会话正在执行，请等待或停止','AGENT_BUSY',409);return token;},
  async active(sessionId:string,token:string){return !!await db.prepare('SELECT id FROM agent_sessions WHERE id=? AND busy=?').bind(sessionId,token).first();},
  async unlock(sessionId:string,token:string){await db.prepare('UPDATE agent_sessions SET busy=NULL WHERE id=? AND busy=?').bind(sessionId,token).run();},
  async stop(sessionId:string,actor:string){await db.prepare('UPDATE agent_sessions SET busy=NULL WHERE id=? AND actor=?').bind(sessionId,actor).run();},
  async messages(sessionId:string){const rows=(await db.prepare('SELECT * FROM agent_messages WHERE session_id=? ORDER BY rowid DESC LIMIT 80').bind(sessionId).all<AgentMessage>()).results;return rows.reverse();},
  async message(sessionId:string,role:string,content:string){const row={id:id(),session_id:sessionId,role,content:content.slice(0,30000),at:now()};await db.prepare('INSERT INTO agent_messages(id,session_id,role,content,at) VALUES(?,?,?,?,?)').bind(row.id,sessionId,role,row.content,row.at).run();return row;},
  async propose(sessionId:string,actor:string,kind:string,data:unknown){const row={id:id(),session_id:sessionId,actor,kind,data:JSON.stringify(data),status:'pending',result:null,at:now()};await db.prepare('INSERT INTO agent_actions(id,session_id,actor,kind,data,status,at) VALUES(?,?,?,?,?,?,?)').bind(row.id,sessionId,actor,kind,row.data,row.status,row.at).run();return row;},
  async actions(sessionId:string,actor:string){return (await db.prepare('SELECT * FROM agent_actions WHERE session_id=? AND actor=? ORDER BY rowid DESC LIMIT 50').bind(sessionId,actor).all<AgentAction>()).results;},
  async action(actionId:string,actor:string){const row=await db.prepare('SELECT * FROM agent_actions WHERE id=? AND actor=?').bind(actionId,actor).first<AgentAction>();ensure(row,'执行卡不存在','NOT_FOUND',404);return row;},
  async claim(actionId:string,actor:string){const r=await db.prepare("UPDATE agent_actions SET status='running' WHERE id=? AND actor=? AND status='pending'").bind(actionId,actor).run();return r.meta.changes===1;},
  async finish(actionId:string,status:string,result:unknown){await db.prepare('UPDATE agent_actions SET status=?,result=? WHERE id=?').bind(status,JSON.stringify(result).slice(0,30000),actionId).run();},
  async reject(actionId:string,actor:string){const r=await db.prepare("UPDATE agent_actions SET status='rejected' WHERE id=? AND actor=? AND status='pending'").bind(actionId,actor).run();ensure(r.meta.changes===1,'该操作已处理','STATE_CONFLICT',409);},
  async audit(actor:string,sessionId:string|null,event:string,detail:unknown){await db.prepare('INSERT INTO agent_audit(id,actor,session_id,event,detail,at) VALUES(?,?,?,?,?,?)').bind(id(),actor,sessionId,event,JSON.stringify(detail).slice(0,16000),now()).run();},
  async audits(actor:string){return (await db.prepare('SELECT * FROM agent_audit WHERE actor=? ORDER BY rowid DESC LIMIT 100').bind(actor).all()).results;}
 };
}
