import {
  AUTH_COOKIE_NAMES,
  clearOauthStateCookie,
  clearSessionCookie,
  createOpaqueToken,
  hashSecretToken,
  oauthStateCookie,
  parseCookies,
  sessionCookie,
} from '../../_lib/auth.js';
import {errorResponse,json,readJson,redirect,safeReturnTo} from '../../_lib/http.js';
import {consumeOauthState,createSession,deleteSession,saveOauthState,upsertHumanFromGitHub} from '../../_lib/identity.js';

function db(env){
  if(!env?.CYMONIA_DB)throw new Error('CYMONIA_DB_not_bound');
  return env.CYMONIA_DB;
}
function sqlTimestamp(ms){return new Date(ms).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'');}

async function start(request,env){
  if(!env.GITHUB_CLIENT_ID)throw new Error('GITHUB_CLIENT_ID_not_configured');
  const url=new URL(request.url),rawState=createOpaqueToken(24);
  const stateHash=await hashSecretToken(rawState,String(env.SESSION_HASH_SECRET||''));
  await saveOauthState(db(env),stateHash,safeReturnTo(url.searchParams.get('return_to')),sqlTimestamp(Date.now()+600000));
  const callback=new URL('/api/auth/callback',request.url).href,authorize=new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id',env.GITHUB_CLIENT_ID);authorize.searchParams.set('redirect_uri',callback);authorize.searchParams.set('state',rawState);
  const headers=new Headers();headers.append('set-cookie',oauthStateCookie(rawState));return redirect(authorize.href,302,headers);
}

async function callback(request,env){
  const url=new URL(request.url),code=url.searchParams.get('code')||'',state=url.searchParams.get('state')||'',cookies=parseCookies(request.headers.get('cookie')||'');
  if(!code||!state||cookies[AUTH_COOKIE_NAMES.oauthState]!==state){const error=new Error('oauth_state_invalid');error.status=400;throw error;}
  const stateHash=await hashSecretToken(state,String(env.SESSION_HASH_SECRET||'')),saved=await consumeOauthState(db(env),stateHash);
  if(!saved){const error=new Error('oauth_state_expired');error.status=400;throw error;}
  if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)throw new Error('github_oauth_not_configured');
  const tokenResponse=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded','user-agent':'CYMONIA'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:new URL('/api/auth/callback',request.url).href})});
  if(!tokenResponse.ok)throw new Error('github_token_exchange_failed');
  const tokenData=await tokenResponse.json();if(!tokenData.access_token)throw new Error('github_access_token_missing');
  const userResponse=await fetch('https://api.github.com/user',{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${tokenData.access_token}`,'user-agent':'CYMONIA'}});
  if(!userResponse.ok)throw new Error('github_identity_lookup_failed');
  const human=await upsertHumanFromGitHub(db(env),await userResponse.json()),rawSession=createOpaqueToken(32),sessionHash=await hashSecretToken(rawSession,String(env.SESSION_HASH_SECRET||''));
  await createSession(db(env),human.actor.id,sessionHash,sqlTimestamp(Date.now()+7*24*60*60*1000));
  const headers=new Headers();headers.append('set-cookie',sessionCookie(rawSession));headers.append('set-cookie',clearOauthStateCookie());return redirect(saved.return_to||'/',302,headers);
}

async function logout(request,env){
  const cookies=parseCookies(request.headers.get('cookie')||''),raw=cookies[AUTH_COOKIE_NAMES.session];
  if(raw&&env.SESSION_HASH_SECRET)await deleteSession(db(env),await hashSecretToken(raw,String(env.SESSION_HASH_SECRET)));
  return json({ok:true},200,{'set-cookie':clearSessionCookie()});
}

export async function onRequest({request,env}){
  try{
    const path=new URL(request.url).pathname.replace(/^\/api\/auth/,'')||'/';
    if(request.method==='GET'&&path==='/github')return start(request,env);
    if(request.method==='GET'&&path==='/callback')return callback(request,env);
    if(request.method==='POST'&&path==='/logout'){await readJson(request);return logout(request,env);}
    return json({ok:false,error:'not_found'},404);
  }catch(error){return errorResponse(error);}
}
