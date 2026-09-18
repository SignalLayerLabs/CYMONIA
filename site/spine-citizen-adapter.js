import {animationForCitizen} from './citizen-animation.js';

const DEFAULT_ANIMATIONS={
  idle:'idle',walk:'walk',observe:'observe',sleep:'sleep',eat:'eat',drink:'drink',
  gather:'gather',carry:'carry',cut:'cut',dig:'dig',work:'work',build:'build',
  care:'care',communicate:'communicate',experiment:'experiment',attack:'attack',defend:'defend',
};

export class SpineCitizenAdapter{
  constructor(PIXI,config=globalThis.CYMONIA_SPINE){
    this.PIXI=PIXI;this.config=config||null;this.Spine=this.config?.Spine||null;this.ready=false;
    this.animations={...DEFAULT_ANIMATIONS,...(this.config?.animations||{})};
  }
  get enabled(){
    return Boolean(this.PIXI&&this.Spine&&this.config?.skeletonAlias&&this.config?.atlasAlias);
  }
  async preload(){
    if(!this.enabled)return false;
    try{
      const {skeletonAlias,atlasAlias,skeletonUrl,atlasUrl}=this.config;
      if(skeletonUrl){try{this.PIXI.Assets.add({alias:skeletonAlias,src:skeletonUrl});}catch{}}
      if(atlasUrl){try{this.PIXI.Assets.add({alias:atlasAlias,src:atlasUrl});}catch{}}
      await this.PIXI.Assets.load([skeletonAlias,atlasAlias]);
      this.ready=true;return true;
    }catch(error){
      console.warn('Optional Spine Citizen assets unavailable; using native CYMONIA sprites.',error);
      this.ready=false;return false;
    }
  }
  create(citizen){
    if(!this.ready)return null;
    try{
      const PIXI=this.PIXI,container=new PIXI.Container(),shadow=new PIXI.Graphics();
      shadow.ellipse(1,1,6,2.8).fill({color:0x1d281c,alpha:.22});
      const body=new this.Spine({skeleton:this.config.skeletonAlias,atlas:this.config.atlasAlias,autoUpdate:true});
      const baseScale=Number(this.config.scale||.22);body.scale.set(baseScale);
      const task=new PIXI.Text({text:'',style:{fontFamily:'Georgia',fontSize:10,fill:0xf8e8b5,stroke:{color:0x283021,width:2}}});
      task.anchor.set(.5);task.position.set(0,-41);container.addChild(shadow,body,task);
      const entry={container,body,task,shadow,baseScale,spine:true,currentAnimation:null};
      this.update(entry,citizen,{flip:false});return entry;
    }catch(error){
      console.warn('Optional Spine Citizen instance failed; using native CYMONIA sprite.',error);return null;
    }
  }
  update(entry,citizen,{flip=false}={}){
    if(!entry?.spine)return;
    const body=entry.body,semantic=animationForCitizen(citizen),requested=this.animations[semantic]||this.animations.idle||'idle';
    const available=body?.skeleton?.data?.findAnimation?.(requested);
    if(available&&entry.currentAnimation!==requested){
      body.state?.setAnimation?.(0,requested,true);entry.currentAnimation=requested;
    }else if(!available&&entry.currentAnimation!==this.animations.idle){
      const idle=this.animations.idle||'idle';
      if(body?.skeleton?.data?.findAnimation?.(idle)){body.state?.setAnimation?.(0,idle,true);entry.currentAnimation=idle;}
    }
    const scale=Math.abs(Number(entry.baseScale)||.22);body.scale.x=(flip?-1:1)*scale;body.scale.y=scale;
  }
}
