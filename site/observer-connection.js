export const CONNECTION=Object.freeze({CONNECTING:'CONNECTING',LIVE:'LIVE',DEGRADED:'DEGRADED',REPLAY:'REPLAY',RECONNECTING:'RECONNECTING',STOPPED:'STOPPED'});

export class ObserverConnection{
  constructor({fetchState,loadReplay=null,createSocket=null,onWorld=()=>{},onMode=()=>{},onError=()=>{},setTimeoutFn=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeoutFn=(id)=>globalThis.clearTimeout(id),randomFn=Math.random,nowFn=()=>Date.now(),pollMs=12000,requestTimeoutMs=20000,minBackoffMs=900,maxBackoffMs=15000,minSocketBackoffMs=1500,maxSocketBackoffMs=30000}={}){
    if(typeof fetchState!=='function')throw new Error('fetchState_required');
    this.fetchState=fetchState;this.loadReplay=loadReplay;this.createSocket=createSocket;this.onWorld=onWorld;this.onMode=onMode;this.onError=onError;this.setTimeoutFn=setTimeoutFn;this.clearTimeoutFn=clearTimeoutFn;this.randomFn=randomFn;this.nowFn=nowFn;this.pollMs=pollMs;this.minBackoffMs=minBackoffMs;this.maxBackoffMs=maxBackoffMs;this.minSocketBackoffMs=minSocketBackoffMs;this.maxSocketBackoffMs=maxSocketBackoffMs;
    this.mode=CONNECTION.STOPPED;this.lastCanonical=null;this.lastAdvanceRealMs=null;this.replay=null;this.started=false;this.stopped=false;this.attempting=false;this.retryTimer=null;this.pollTimer=null;this.socketTimer=null;this.socket=null;this.backoff=minBackoffMs;this.socketBackoff=minSocketBackoffMs;
    this.requestTimeoutMs=requestTimeoutMs;this.requestController=null;
  }
  setMode(mode,detail=null){
    if(
      mode===CONNECTION.RECONNECTING &&
      this.replay &&
      !this.lastCanonical
    ){
      mode=CONNECTION.REPLAY;
    }

    if(this.mode===mode&&detail==null)return;

    this.mode=mode;
    this.onMode(mode,detail);
  }
  async start(){if(this.started&&!this.stopped)return;this.started=true;this.stopped=false;this.setMode(CONNECTION.CONNECTING);await this.refreshNow({initial:true});}
  acceptCanonical(world){
    if(!world||world.version!==2||!world.worldId||!Number.isSafeInteger(world.clock?.worldMinute)||world.clock.worldMinute<0)throw new Error('canonical_state_invalid');
    if(this.lastCanonical){
      if(world.worldId!==this.lastCanonical.worldId)throw new Error('canonical_world_identity_changed');
      if(world.clock.worldMinute<this.lastCanonical.clock.worldMinute)throw new Error('canonical_clock_regression');
    }
    if(!this.lastCanonical||world.clock.worldMinute>this.lastCanonical.clock.worldMinute)this.lastAdvanceRealMs=this.nowFn();
    this.lastCanonical=world;
  }
  updateCanonicalMode(){
    const stalled=this.lastAdvanceRealMs!==null&&this.nowFn()-this.lastAdvanceRealMs>=120000;
    this.setMode(stalled?CONNECTION.DEGRADED:CONNECTION.LIVE,stalled?{reason:'world_clock_stalled'}:null);
  }
  stop(){this.stopped=true;this.started=false;this.requestController?.abort(new Error('canonical_state_cancelled'));for(const t of ['retryTimer','pollTimer','socketTimer']){if(this[t])this.clearTimeoutFn(this[t]);this[t]=null;}if(this.socket){try{this.socket.close?.();}catch{}this.socket=null;}this.setMode(CONNECTION.STOPPED);}
  nextBackoff(){const jitter=.82+this.randomFn()*.36,wait=Math.round(this.backoff*jitter);this.backoff=Math.min(this.maxBackoffMs,Math.max(this.minBackoffMs,this.backoff*1.8));return wait;}
  resetBackoff(){this.backoff=this.minBackoffMs;}
  nextSocketBackoff(){const jitter=.9+this.randomFn()*.2,wait=Math.round(this.socketBackoff*jitter);this.socketBackoff=Math.min(this.maxSocketBackoffMs,Math.max(this.minSocketBackoffMs,this.socketBackoff*1.8));return wait;}
  resetSocketBackoff(){this.socketBackoff=this.minSocketBackoffMs;}
  scheduleRetry(){if(this.stopped||this.retryTimer)return;const wait=this.nextBackoff();if(this.lastCanonical)this.setMode(CONNECTION.DEGRADED,{retryInMs:wait});else if(!this.replay)this.setMode(CONNECTION.RECONNECTING,{retryInMs:wait});this.retryTimer=this.setTimeoutFn(async()=>{
      this.retryTimer=null;
      if(!this.lastCanonical&&!this.replay){
        this.setMode(CONNECTION.RECONNECTING);
      }
      await this.refreshNow();
    },wait);}
  schedulePoll(){if(this.stopped||this.pollTimer)return;this.pollTimer=this.setTimeoutFn(async()=>{this.pollTimer=null;await this.refreshNow({poll:true});},this.pollMs);}
  async ensureReplay(){if(this.lastCanonical||this.replay||!this.loadReplay)return;try{const replay=await this.loadReplay();if(this.stopped)return;this.replay=replay;if(this.replay){this.onWorld(this.replay,{canonical:false,replay:true});this.setMode(CONNECTION.REPLAY);}}catch(error){if(!this.stopped)this.onError(error,'replay');}}
  async fetchCanonicalState(){
    const controller=new AbortController();this.requestController=controller;let timer;
    const expiration=new Promise((resolve,reject)=>{
      controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});
      timer=this.setTimeoutFn(()=>controller.abort(new Error('canonical_state_timeout')),this.requestTimeoutMs);
    });
    try{
      // Release the poll lock even if a transport ignores cancellation. The
      // rejected race also prevents a late response from replacing newer data.
      return await Promise.race([this.fetchState({signal:controller.signal}),expiration]);
    }finally{
      this.clearTimeoutFn(timer);
      if(this.requestController===controller)this.requestController=null;
    }
  }
  async refreshNow({initial=false,poll=false}={}){
    if(this.stopped||this.attempting)return this.lastCanonical;
    this.attempting=true;
    try{
      const world=await this.fetchCanonicalState();if(this.stopped)return this.lastCanonical;
      this.acceptCanonical(world);this.resetBackoff();if(this.retryTimer){this.clearTimeoutFn(this.retryTimer);this.retryTimer=null;}this.onWorld(world,{canonical:true});this.updateCanonicalMode();this.ensureSocket();this.schedulePoll();return world;
    }catch(error){if(this.stopped)return this.lastCanonical;this.onError(error,poll?'poll':'state');if(!this.lastCanonical)await this.ensureReplay();if(this.stopped)return this.lastCanonical;if(this.lastCanonical)this.setMode(CONNECTION.DEGRADED);else if(this.replay)this.setMode(CONNECTION.REPLAY);else this.setMode(initial?CONNECTION.CONNECTING:CONNECTION.RECONNECTING);this.scheduleRetry();return this.lastCanonical;
    }finally{this.attempting=false;}
  }
  ensureSocket(){
    if(this.stopped||!this.lastCanonical||typeof this.createSocket!=='function'||this.socketTimer)return null;
    if(this.socket&&this.socket.readyState!==2&&this.socket.readyState!==3)return this.socket;
    try{
      let openedAt=0;
      const socket=this.createSocket({
        onWorld:(world)=>{
          if(this.stopped)return;
          try{this.acceptCanonical(world);}
          catch(error){this.onError(error,'socket_state');this.setMode(CONNECTION.DEGRADED);this.scheduleRetry();return;}
          this.resetBackoff();if(openedAt&&this.nowFn()-openedAt>=30_000)this.resetSocketBackoff();this.onWorld(world,{canonical:true,stream:true});this.updateCanonicalMode();
        },
        onSignal:(signal)=>{
          if(this.stopped)return;
          const minute=Number(signal?.worldMinute);
          if(Number.isSafeInteger(minute)&&this.lastCanonical&&minute<this.lastCanonical.clock.worldMinute)return;
          void this.refreshNow({poll:true});
        },
        onOpen:()=>{openedAt=this.nowFn();this.updateCanonicalMode();},
        onClose:()=>{if(this.socket===socket)this.socket=null;if(this.stopped)return;if(openedAt&&this.nowFn()-openedAt>=30_000)this.resetSocketBackoff();if(!this.lastCanonical)this.setMode(CONNECTION.RECONNECTING);this.scheduleSocketReconnect();},
        onError:(error)=>{this.onError(error,'socket');}
      });
      this.socket=socket||null;return this.socket;
    }catch(error){this.onError(error,'socket_create');this.socket=null;this.scheduleSocketReconnect();return null;}
  }
  scheduleSocketReconnect(){if(this.stopped||this.socketTimer||typeof this.createSocket!=='function')return;const wait=this.nextSocketBackoff();this.socketTimer=this.setTimeoutFn(()=>{this.socketTimer=null;if(this.lastCanonical)this.ensureSocket();else this.scheduleRetry();},wait);}
}
