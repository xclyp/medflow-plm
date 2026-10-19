import {env} from 'cloudflare:workers';
import {identity,error,executeBusiness} from './service-api';
import {appStore,readApp,executeApp} from './service-store';
import domain from './domain';
import {BusinessError,requireValue as ok} from './contracts';
const bucket=()=>{const b=(env as unknown as {FILES?:R2Bucket}).FILES;if(!b)throw new BusinessError('文件库未绑定','STORAGE_UNAVAILABLE',503);return b;};
export async function upload(request:Request){try{
 const actor=identity(request);ok(request.headers.get('origin')===new URL(request.url).origin,'文件上传必须来自当前系统页面','ORIGIN_REJECTED');
 ok(env.DB,'独立数据库未绑定');const store=appStore(env.DB,domain),view=await readApp(store,actor);ok(view.state.initialized,'请先初始化PLM');ok(view.me.role==='owner'||view.me.role==='engineer','当前角色无上传权限','FORBIDDEN');
 ok(request.headers.get('content-type')?.startsWith('multipart/form-data'),'使用文件上传表单');
 const reader=request.body?.getReader();ok(reader,'缺少上传内容');let length=0;const chunks:Uint8Array[]=[];for(;;){const p=await reader.read();if(p.done)break;length+=p.value.byteLength;if(length>12*1024*1024){await reader.cancel();throw new BusinessError('单次上传最大10MB','TOO_LARGE',413);}chunks.push(p.value);}
 const bytes=new Uint8Array(length);let offset=0;for(const ch of chunks){bytes.set(ch,offset);offset+=ch.byteLength;}
 const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData(),file=form.get('file');ok(file instanceof File&&file.size>0&&file.size<=10*1024*1024,'请选择1字节至10MB的文件');
 const body=await file.arrayBuffer(),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',body)),sha256=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
 const fileId='documents/'+crypto.randomUUID()+'/'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120);const b=bucket();
 await b.put(fileId,body,{httpMetadata:{contentType:file.type||'application/octet-stream'},customMetadata:{sha256,uploadedBy:actor}});
 try{const result=await executeBusiness(store,{action:'document.create',requestId:crypto.randomUUID(),revisionId:String(form.get('revisionId')||''),reference:String(form.get('reference')||''),name:file.name,documentVersion:String(form.get('documentVersion')||''),kind:String(form.get('kind')||'other'),fileId,sha256,url:''},actor);return Response.json({...result,sha256,size:file.size},{headers:{'Cache-Control':'no-store'}});}catch(e){await b.delete(fileId);throw e;}
 }catch(e){return error(e);}}
export async function download(request:Request){try{const actor=identity(request);ok(env.DB,'独立数据库未绑定');const view=await readApp(appStore(env.DB,domain),actor);const id=new URL(request.url).searchParams.get('id');const document=view.state.collections.documents.find(d=>d.fileId===id);ok(document,'受控文档不存在','NOT_FOUND');const object=await bucket().get(String(id));ok(object,'文件库对象不存在，请核对备份','NOT_FOUND');return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(String(document.name)),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});}catch(e){return error(e);}}
