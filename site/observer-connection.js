export const CONNECTION=Object.freeze({CONNECTING:'CONNECTING',LIVE:'LIVE',DEGRADED:'DEGRADED',REPLAY:'REPLAY',RECONNECTING:'RECONNECTING',STOPPED:'STOPPED'});

export class ObserverConnection{
  constructor({fetchState,loadReplay=null,createSocket=null,onWorld=()=>{},onMode=()=>{},onError=()=>{},setTimeoutFn=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeoutFn=(id)=>globalThis.clearTimeout(id),randomFn=Math.random,pollMs=12000,minBackoffMs=900,maxBackoffMs=15000}={}){
    if(typeof fetchState!=='function')throw new Error('fetchState_required');
    this.fetchState=fetchState;this.loadReplay=loadReplay;this.createSocket=createSocket;this.onWorld=onWorld;this.onMode=onMode;this.onError=onError;this.setTimeoutFn=setTimeoutFn;this.clearTimeoutFn=clearTimeoutFn;this.randomFn=randomFn;this.pollMs=pollMs;this.minBackoffMs=minBackoffMs;this.maxBackoffMs=maxBackoffMs;
    this.mode=CONNECTION.STOPPED;this.lastCanonical=null;this.replay=null;this.started=false;this.stopped=false;this.attempting=false;this.retryTimer=null;this.pollTimer=null;this.socketTimer=null;this.socket=null;this.backoff=minBackoffMs;
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
  stop(){this.stopped=true;this.started=false;for(const t of ['retryTimer','pollTimer','socketTimer']){if(this[t])this.clearTimeoutFn(this[t]);this[t]=null;}if(this.socket){try{this.socket.close?.();}catch{}this.socket=null;}this.setMode(CONNECTION.STOPPED);}
  nextBackoff(){const jitter=.82+this.randomFn()*.36,wait=Math.round(this.backoff*jitter);this.backoff=Math.min(this.maxBackoffMs,Math.max(this.minBackoffMs,this.backoff*1.8));return wait;}
  resetBackoff(){this.backoff=this.minBackoffMs;}
  scheduleRetry(){if(this.stopped||this.retryTimer)return;const wait=this.nextBackoff();if(this.lastCanonical)this.setMode(CONNECTION.DEGRADED,{retryInMs:wait});else if(!this.replay)this.setMode(CONNECTION.RECONNECTING,{retryInMs:wait});this.retryTimer=this.setTimeoutFn(async()=>{
      this.retryTimer=null;
      if(!this.lastCanonical&&!this.replay){
        this.setMode(CONNECTION.RECONNECTING);
      }
      await this.refreshNow();
    },wait);}
  schedulePoll(){if(this.stopped||this.pollTimer)return;this.pollTimer=this.setTimeoutFn(async()=>{this.pollTimer=null;await this.refreshNow({poll:true});},this.pollMs);}
  async ensureReplay(){if(this.lastCanonical||this.replay||!this.loadReplay)return;try{this.replay=await this.loadReplay();if(this.replay){this.onWorld(this.replay,{canonical:false,replay:true});this.setMode(CONNECTION.REPLAY);}}catch(error){this.onError(error,'replay');}}
  async refreshNow({initial=false,poll=false}={}){
    if(this.stopped||this.attempting)return this.lastCanonical;
    this.attempting=true;
    try{
      const world=await this.fetchState();if(!world||world.version!==2)throw new Error('canonical_state_invalid');
      this.lastCanonical=world;this.resetBackoff();if(this.retryTimer){this.clearTimeoutFn(this.retryTimer);this.retryTimer=null;}this.onWorld(world,{canonical:true});this.setMode(CONNECTION.LIVE);this.ensureSocket();this.schedulePoll();return world;
    }catch(error){this.onError(error,poll?'poll':'state');if(!this.lastCanonical)await this.ensureReplay();if(this.lastCanonical)this.setMode(CONNECTION.DEGRADED);else if(this.replay)this.setMode(CONNECTION.REPLAY);else this.setMode(initial?CONNECTION.CONNECTING:CONNECTION.RECONNECTING);this.scheduleRetry();return this.lastCanonical;
    }finally{this.attempting=false;}
  }
  ensureSocket(){
    if(this.stopped||!this.lastCanonical||typeof this.createSocket!=='function')return null;
    if(this.socket&&this.socket.readyState!==2&&this.socket.readyState!==3)return this.socket;
    try{
      const socket=this.createSocket({
        onWorld:(world)=>{if(!world||world.version!==2)return;this.lastCanonical=world;this.resetBackoff();this.onWorld(world,{canonical:true,stream:true});this.setMode(CONNECTION.LIVE);},
        onOpen:()=>{this.setMode(CONNECTION.LIVE);},
        onClose:()=>{if(this.socket===socket)this.socket=null;if(this.stopped)return;this.setMode(this.lastCanonical?CONNECTION.DEGRADED:CONNECTION.RECONNECTING);this.scheduleSocketReconnect();},
        onError:(error)=>{this.onError(error,'socket');}
      });
      this.socket=socket||null;return this.socket;
    }catch(error){this.onError(error,'socket_create');this.socket=null;this.scheduleSocketReconnect();return null;}
  }
  scheduleSocketReconnect(){if(this.stopped||this.socketTimer||typeof this.createSocket!=='function')return;const wait=Math.min(5000,this.nextBackoff());this.socketTimer=this.setTimeoutFn(()=>{this.socketTimer=null;if(this.lastCanonical)this.ensureSocket();else this.scheduleRetry();},wait);}
}
