import {json,errorResponse,readJson,sessionActor,requireActor} from '../../_lib/http.js';

function routePath(request){return new URL(request.url).pathname.replace(/^\/api\/v2/,'')||'/state';}
async function proxy(request,env,{body=null,path=null}={}){
  if(!env.WORLD_SERVICE?.fetch)throw new Error('WORLD_SERVICE_not_bound');
  const u=new URL(request.url);u.pathname=path||routePath(request);u.search='';
  const init={method:request.method,headers:new Headers(request.headers)};
  if(body!==null){init.body=JSON.stringify(body);init.headers.set('content-type','application/json');}
  else if(!['GET','HEAD'].includes(request.method))init.body=request.body;
  return env.WORLD_SERVICE.fetch(new Request(u,init));
}

export async function onRequest({request,env}){
  try{
    const p=routePath(request);
    if(request.method==='GET'&&p==='/health')return proxy(request,env,{path:'/health'});
    if(request.method==='GET'&&['/state','/history'].includes(p))return proxy(request,env);
    if(request.method==='GET'&&p.startsWith('/why/'))return proxy(request,env);
    if(request.method==='GET'&&p==='/stream')return proxy(request,env);
    if(request.method==='POST'&&p==='/avatar'){
      await readJson(request).catch(()=>({}));const actor=await requireActor(request,env);return proxy(request,env,{body:{actor},path:'/avatar'});
    }
    if(request.method==='POST'&&p==='/intent'){
      const actor=await requireActor(request,env);const body=await readJson(request);const avatar=await proxy(new Request(request.url,{method:'POST'}),env,{body:{actor},path:'/avatar'});const av=await avatar.json();if(!av.ok)return json(av,avatar.status);return proxy(request,env,{body:{citizenId:av.citizenId,intent:body.intent},path:'/intent'});
    }
    return json({ok:false,error:'not_found'},404);
  }catch(error){return errorResponse(error);}
}
