import { z } from 'zod';
import type { Ack, Request, Snapshot, Session } from '../protocol/index.ts';
import { HostRuntime, type GameEvent } from '../game-core/runtime.ts';
import { randomHex, type RandomSource } from '../game-core/random.ts';
import { ObservableTransport, type GameTransport } from './transport.ts';
import type { NearbyBridge, RadioEvent } from './NearbyBridge.ts';
import { FramedPeer } from './framing.ts';
const OWNER='local-owner';
const envelope=z.object({v:z.literal(1),type:z.enum(['request','reply','sync','snapshot','event','ping','pong','paused','active','closed']),id:z.string().max(100).optional(),body:z.unknown().optional()});
type Pending={resolve:(value:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
/** One device owns the authority. Guests never receive secrets or other seat tokens. */
export class NearbyTransport extends ObservableTransport implements GameTransport {
 readonly kind='nearby' as const;
 private runtime:HostRuntime|null=null;private frames=new Map<string,FramedPeer>();private pending=new Map<string,Pending>();
 private unlisten:(()=>void)|null=null;private timer:ReturnType<typeof setInterval>|null=null;
 private target='';private code='';private name='';private session:Session|null=null;
 private joining:Request|null=null;private joiningResolve:((ack:Ack)=>void)|null=null;private joinTimer:ReturnType<typeof setTimeout>|null=null;
 private live=false;private active=true;private lastSeen=0;private lastPing=0;private disconnectedAt=0;
 private attempts=new Set<string>();private nextDiscovery=0;private generation=0;
 constructor(private bridge:NearbyBridge,private random:RandomSource){super();}
 async connect(){if(this.live)return;this.live=true;this.unlisten=this.bridge.subscribe(e=>this.onRadio(e));this.timer=setInterval(()=>this.tick(),250);this.emit({type:'connection',connected:true,message:'Nearby ready. No internet needed.'});}
 private packet(type:string,body?:unknown,id?:string){return {v:1,type,body,id};}
 private async transmit(endpoint:string,type:string,body?:unknown,id?:string){const frame=this.frames.get(endpoint);if(!frame)throw Error('Nearby connection is not ready.');await frame.send(this.packet(type,body,id));}
 private wire(endpoint:string){
  this.frames.get(endpoint)?.close();
  const frame=new FramedPeer(data=>this.bridge.send(endpoint,data),value=>this.receive(endpoint,value),reason=>{this.emit({type:'error',message:reason});void this.bridge.disconnectEndpoint(endpoint).catch(()=>{});this.lost(endpoint);});this.frames.set(endpoint,frame);
 }
 private onRadio(e:RadioEvent){
  if(!this.live)return;
  if(e.type==='found'){if(!this.runtime&&e.name===`Scribbles:${this.code}`&&!this.target&&!this.attempts.has(e.endpointId)){
   this.attempts.add(e.endpointId);this.target=e.endpointId;void this.bridge.requestConnection(e.endpointId,this.name).catch(error=>{this.target='';this.attempts.delete(e.endpointId);this.emit({type:'error',message:String(error)});});
  }}
  else if(e.type==='lost'){this.attempts.delete(e.endpointId);}
  else if(e.type==='connected'){
   if(this.runtime){if(this.frames.size>=5){void this.bridge.disconnectEndpoint(e.endpointId);return;}this.wire(e.endpointId);this.runtime.connect(e.endpointId,event=>{void this.transmit(e.endpointId,'event',event).catch(()=>{});});}
   else if(e.endpointId===this.target){
    this.wire(e.endpointId);this.lastSeen=Date.now();void this.bridge.stopDiscovery().catch(()=>{});
    const request=this.session?{id:randomHex(this.random),command:{type:'resume' as const,...this.session}}:this.joining;
    if(request)void this.remoteRequest(request).then(ack=>{
     if(ack.ok){if(ack.session)this.session=ack.session;this.disconnectedAt=0;this.emit({type:'connection',connected:true});}
     else {this.emit({type:'error',message:ack.error});this.resetGuest();}
     this.finishJoin(ack);
    }).catch(error=>{this.finishJoin({ok:false,error:String(error)});this.resetGuest();});
   }else void this.bridge.disconnectEndpoint(e.endpointId).catch(()=>{});
  }
  else if(e.type==='disconnected')this.lost(e.endpointId);
  else if(e.type==='payload')this.frames.get(e.endpointId)?.accept(e.data);
  else if(e.type==='error'){this.emit({type:'error',message:e.message});if(e.endpointId){void this.bridge.disconnectEndpoint(e.endpointId).catch(()=>{});this.lost(e.endpointId);}}
 }
 private receive(endpoint:string,raw:unknown){
  const parsed=envelope.safeParse(raw);if(!parsed.success){void this.bridge.disconnectEndpoint(endpoint).catch(()=>{});this.lost(endpoint);return;}
  const m=parsed.data;
  if(this.runtime){
   if(m.type==='request'&&m.id){const ack=this.runtime.request(endpoint,m.body);void this.transmit(endpoint,'reply',ack,m.id).catch(()=>{});}
   else if(m.type==='sync'&&m.id)void this.transmit(endpoint,'snapshot',this.runtime.sync(endpoint),m.id).catch(()=>{});
   else if(m.type==='ping')void this.transmit(endpoint,this.active?'pong':'paused').catch(()=>{});
   return;
  }
  if(endpoint!==this.target)return;this.lastSeen=Date.now();
  if((m.type==='reply'||m.type==='snapshot')&&m.id){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);p.resolve(m.body);}return;}
  if(m.type==='event'){
   const e=m.body as GameEvent;if(!e||!['state','stroke','removed'].includes(e.type))return;
   this.emit(e);if(e.type==='removed'){this.resetGuest();this.emit({type:'connection',connected:true,message:'Nearby ready.'});}
  }else if(m.type==='closed'){this.emit({type:'removed',reason:'The host closed this room. Create or join a new room.'});this.resetGuest();this.emit({type:'connection',connected:true});}
  else if(m.type==='paused')this.emit({type:'connection',connected:false,message:'Host paused the game. Waiting for them to return…'});
  else if((m.type==='active'||m.type==='pong')&&this.session)this.emit({type:'connection',connected:true});
 }
 private query(type:'request'|'sync',body?:unknown):Promise<any>{
  const id=randomHex(this.random);return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Nearby response timed out. Return to the host and reconnect.'));},10000);
   this.pending.set(id,{resolve,reject,timer});void this.transmit(this.target,type,body,id).catch(e=>{clearTimeout(timer);this.pending.delete(id);reject(e);});
  });
 }
 private remoteRequest(request:Request):Promise<Ack>{return this.query('request',request);}
 async request(request:Request):Promise<Ack>{
  const c=request.command;const generation=this.generation;
  if(c.type==='create'){
   await this.bridge.prepare();if(!this.live||generation!==this.generation)throw Error('Connection closed.');
   if(this.runtime||this.session)throw Error('Leave your current room first.');
   const runtime=new HostRuntime({random:this.random,owner:OWNER,maxPlayers:6});this.runtime=runtime;runtime.connect(OWNER,e=>{if(this.runtime===runtime)this.emit(e);});
   const ack=runtime.request(OWNER,request);
   if(!ack.ok){this.runtime=null;return ack;}
   this.code=ack.session!.code;
   try{await this.bridge.advertise(`Scribbles:${this.code}`);}catch(e){runtime.close('Could not open Nearby room. Check Bluetooth, Wi-Fi and permissions.');this.runtime=null;throw e;}
   return ack;
  }
  if(c.type==='join'&&!this.runtime){
   if(this.session||this.joining)throw Error('Leave your current room first.');await this.bridge.prepare();if(!this.live||generation!==this.generation)throw Error('Connection closed.');
   this.code=c.code;this.name=c.name;this.joining=request;this.attempts.clear();
   const result=new Promise<Ack>(resolve=>{this.joiningResolve=resolve;this.joinTimer=setTimeout(()=>{this.finishJoin({ok:false,error:'Room not found or pairing timed out. Keep both phones nearby with Wi-Fi and Bluetooth on; confirm the matching code on both phones.'});this.resetGuest();},45000);});
   try{await this.bridge.discover();}catch(e){this.finishJoin({ok:false,error:String(e)});this.resetGuest();}return result;
  }
  if(this.runtime){
   if(c.type==='leave'){const r=this.runtime;this.runtime=null;await Promise.all([...this.frames.keys()].map(endpoint=>this.transmit(endpoint,'closed').catch(()=>{})));r.close();await this.stopRadio();this.emit({type:'connection',connected:true});return {ok:true};}
   return this.runtime.request(OWNER,request);
  }
  if(c.type==='leave'){
   try{if(this.frames.has(this.target))await this.remoteRequest(request);}finally{this.resetGuest();this.emit({type:'connection',connected:true});}return {ok:true};
  }
  return this.remoteRequest(request);
 }
 async sync():Promise<Snapshot|null>{if(this.runtime)return this.runtime.sync(OWNER);if(!this.frames.has(this.target))return null;return this.query('sync');}
 private finishJoin(ack:Ack){if(this.joinTimer)clearTimeout(this.joinTimer);this.joinTimer=null;const resolve=this.joiningResolve;this.joiningResolve=null;this.joining=null;resolve?.(ack);}
 private lost(endpoint:string){
  this.frames.get(endpoint)?.close();this.frames.delete(endpoint);
  if(this.runtime){this.runtime.disconnect(endpoint);return;}
  if(this.target!==endpoint)return;this.target='';this.attempts.delete(endpoint);
  if(!this.session){this.finishJoin({ok:false,error:'Connection rejected or interrupted. Try joining again and confirm the code on both phones.'});this.resetGuest();return;}
  this.disconnectedAt ||= Date.now();this.emit({type:'connection',connected:false,message:'Host disconnected. Searching nearby for up to 60 seconds…'});
  this.nextDiscovery=Date.now()+500;
 }
 private tick(){
  const now=Date.now();this.runtime?.tick(now);
  if(this.session&&!this.target&&now>=this.nextDiscovery){this.nextDiscovery=now+3000;void this.bridge.discover().catch(e=>this.emit({type:'error',message:String(e)}));}for(const frame of this.frames.values())frame.tick(now);
  if(!this.runtime&&this.target&&this.frames.has(this.target)&&now-this.lastPing>3000){this.lastPing=now;void this.transmit(this.target,'ping').catch(()=>{});}
  if(this.session&&this.target&&this.lastSeen&&now-this.lastSeen>12000){const id=this.target;void this.bridge.disconnectEndpoint(id).catch(()=>{});this.lost(id);}
  if(this.disconnectedAt&&now-this.disconnectedAt>=60000){this.emit({type:'removed',reason:'The host did not return. This local room is no longer reachable.'});this.resetGuest();this.emit({type:'connection',connected:true});}
 }
 setActive(active:boolean){
  this.active=active;if(this.runtime){if(active)this.runtime.resume();else this.runtime.suspend();for(const endpoint of this.frames.keys())void this.transmit(endpoint,active?'active':'paused').catch(()=>{});}
  else if(active&&this.session&&!this.target)void this.bridge.discover().catch(()=>{});
 }
 private resetGuest(){this.session=null;this.code='';this.target='';this.disconnectedAt=0;this.attempts.clear();void this.stopRadio();}
 private async stopRadio(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Connection closed.'));}this.pending.clear();for(const f of this.frames.values())f.close();this.frames.clear();await this.bridge.stop().catch(()=>{});}
 disconnect(){this.generation++;this.live=false;this.unlisten?.();this.unlisten=null;if(this.timer)clearInterval(this.timer);this.timer=null;this.finishJoin({ok:false,error:'Connection closed.'});this.runtime?.close();this.runtime=null;this.session=null;void this.stopRadio();}
}
