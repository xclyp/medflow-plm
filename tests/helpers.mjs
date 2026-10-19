import {executeApp,receiveApp} from '../lib/service-store.ts';
export function harness(domain,actor='email:owner@example.test'){
 let snapshot={state:domain.initial(),version:0,owner:'',token:'',inbox:[],requests:[],audit:[]};
 const store={async read(){return structuredClone(snapshot)},async commit(before,next){if(before.version!==snapshot.version)return false;snapshot={...structuredClone(next),version:before.version+1};return true;}};
 return {store,actor,get state(){return structuredClone(snapshot.state)},get version(){return snapshot.version},async run(action,data={},who=actor,requestId=crypto.randomUUID(),at='2026-10-19T01:00:00.000Z'){return executeApp(store,domain,{action,...data,requestId},who,at)},async receive(e){return receiveApp(store,domain,e,'2026-10-19T01:00:00.000Z')},last(k){return structuredClone(snapshot.state.collections[k].at(-1))},rows(k){return structuredClone(snapshot.state.collections[k])}};
}
export async function demo(domain){const h=harness(domain);await h.run('system.init',{demo:true});return h;}
export function envelope(source,target,type,payload,id=crypto.randomUUID()){return {id,source,target,type,payload,correlationId:String(payload.revisionId||''),at:'2026-10-19T01:00:00.000Z'};}
