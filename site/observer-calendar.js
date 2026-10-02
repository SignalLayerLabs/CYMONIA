// Play a small window of already committed time at the world's 1 minute/second
// rate. The upper bound is the server checkpoint, including during outages.
export class ObserverCalendar{
  constructor({nowFn=()=>performance.now(),bufferMinutes=60}={}){
    this.nowFn=nowFn;
    this.bufferMinutes=bufferMinutes;
    this.worldId=null;
    this.canonical=false;
    this.startMinute=0;
    this.targetMinute=0;
    this.anchorMs=nowFn();
  }
  accept(world,{canonical=true}={}){
    const minute=world?.clock?.worldMinute;
    if(!Number.isSafeInteger(minute)||minute<0)return;
    const now=this.nowFn();
    if(canonical&&this.canonical&&world.worldId===this.worldId){
      if(minute<this.targetMinute)return;
      this.startMinute=this.minute(now);
    }else{
      this.startMinute=canonical?Math.max(0,minute-this.bufferMinutes):minute;
    }
    this.worldId=world.worldId;
    this.canonical=canonical;
    this.targetMinute=minute;
    this.anchorMs=now;
  }
  minute(now=this.nowFn()){
    if(!this.canonical)return this.targetMinute;
    return Math.min(this.targetMinute,
      this.startMinute+Math.max(0,now-this.anchorMs)/1000);
  }
}
