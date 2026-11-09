import { z } from 'zod';
import { commandSchema, type Ack, type Session, type Snapshot, type CanvasEvent } from '../protocol/index.ts';
import { GameStore, GameError, type Room } from './engine.ts';
import { type RandomSource, webRandom } from './random.ts';
export type GameEvent={type:'state';state:Snapshot}|{type:'stroke';event:CanvasEvent}|{type:'removed';reason:string};
type Peer={emit:(event:GameEvent)=>void;session?:Session;cache:Map<string,Ack>;window:number;count:number};
const requestSchema=z.object({id:z.string().min(8).max(100),command:commandSchema});
/** Authority and sessions are independent of any socket/radio implementation. */
export class HostRuntime {
 readonly store:GameStore;
 private peers=new Map<string,Peer>();
 private signatures=new Map<string,string>();
 private suspendedAt:number|null=null;
 constructor(private options:{random?:RandomSource;owner?:string;maxPlayers?:number}={}){this.store=new GameStore(options.random??webRandom);}
 connect(id:string,emit:Peer['emit']){this.disconnect(id);this.peers.set(id,{emit,cache:new Map(),window:0,count:0});}
 sync(id:string,now=Date.now()){const s=this.peers.get(id)?.session;try{return s?this.store.get(s.code).snapshot(s.playerId,now):null;}catch{return null;}}
 /** Canvas strokes are only included when the canvas itself was rebuilt (join, undo/redo/clear); live lines travel as stroke events. */
 private publish(room:Room,now:number,withCanvas=false){for(const p of this.peers.values())if(p.session?.code===room.code&&room.members.some(m=>m.id===p.session!.playerId))p.emit({type:'state',state:room.snapshot(p.session.playerId,now,withCanvas)});}
 private unseat(p:Peer,reason:string){p.session=undefined;p.emit({type:'removed',reason});}
 request(id:string,raw:unknown,now=Date.now()):Ack {
  const peer=this.peers.get(id);if(!peer)return {ok:false,error:'Connection is closed.'};
  if(now-peer.window>=1000){peer.window=now;peer.count=0;}
  if(++peer.count>60)return {ok:false,error:'Too many requests. Please slow down.'};
  const parsed=requestSchema.safeParse(raw);if(!parsed.success)return {ok:false,error:parsed.error.issues[0]?.message??'Invalid request.'};
  const {id:requestId,command:c}=parsed.data;const cached=peer.cache.get(requestId);if(cached)return cached;
  let result:Ack;
  try{
   if(this.suspendedAt!==null)throw new GameError('The host has paused the room. Wait for them to return.');
   let session=peer.session;let room:Room;
   if(c.type==='create'||c.type==='join'||c.type==='resume'){
    if(session)throw new GameError('Leave your current room first.');
    if(c.type==='create'){
     if(this.options.owner&&id!==this.options.owner)throw new GameError('Only this device can create the local room.');
     if(this.options.owner&&this.store.rooms.size)throw new GameError('A local room is already open.');
     if(this.options.maxPlayers&&c.settings.maxPlayers>this.options.maxPlayers)throw new GameError(`Nearby rooms support up to ${this.options.maxPlayers} players.`);
     const created=this.store.create(c.settings,c.name,c.avatar,now);room=created.room;session=created.session;
    }else if(c.type==='join'){room=this.store.get(c.code);session=room.add(c.name,c.avatar,now);}
    else {room=this.store.get(c.code);const playerId=room.resume(c.token,now);session={code:c.code,token:c.token,playerId};for(const [otherId,other]of this.peers)if(otherId!==id&&other.session?.playerId===playerId)this.unseat(other,'This seat was opened on another device.');}
    peer.session=session;room.tick(now);result={ok:true,session};this.publish(room,now,true);
   }else{
    if(!session)throw new GameError('Join a room first.');room=this.store.get(session.code);room.tick(now);
    if(c.type==='leave'){room.remove(session.playerId,now);peer.session=undefined;}
    else if(c.type==='kick'){
     room.requireHost(session.playerId);if(c.playerId===session.playerId)throw new GameError('Use Leave Room to leave.');
     room.remove(c.playerId,now);for(const other of this.peers.values())if(other.session?.playerId===c.playerId)this.unseat(other,'The host removed you from the room.');
    }else {
     if(c.type==='settings'&&this.options.maxPlayers&&c.settings.maxPlayers>this.options.maxPlayers)throw new GameError(`Nearby rooms support up to ${this.options.maxPlayers} players.`);
     room.act(session.playerId,c,now);
    }
    result={ok:true};
    if(c.type==='stroke'){for(const p of this.peers.values())if(p.session?.code===room.code)p.emit({type:'stroke',event:{turnId:room.turnId,revision:room.revision,stroke:c.stroke,...(c.from!==undefined?{from:c.from}:{})}});}
    else this.publish(room,now,c.type==='canvas');
   }
  }catch(e){result={ok:false,error:e instanceof GameError?e.message:'Unable to process that action.'};}
  peer.cache.set(requestId,result);if(peer.cache.size>256)peer.cache.delete(peer.cache.keys().next().value!);return result;
 }
 disconnect(id:string,now=Date.now()){
  const s=this.peers.get(id)?.session;this.peers.delete(id);if(!s)return;
  try{const room=this.store.get(s.code);room.disconnect(s.playerId,now);if(this.suspendedAt===null)room.tick(now);this.publish(room,now);}catch{}
 }
 tick(now=Date.now()){
  if(this.suspendedAt!==null)return;this.store.sweep(now);
  for(const r of this.store.rooms.values()){
   const key=JSON.stringify([r.phase,r.turnId,r.deadline,r.hint(now),r.members.map(p=>[p.id,p.connected]),r.hostId]);
   if(this.signatures.get(r.code)!==key){this.signatures.set(r.code,key);this.publish(r,now);}
  }
  for(const code of this.signatures.keys())if(!this.store.rooms.has(code))this.signatures.delete(code);
 }
 /** Freeze deadlines while the phone host is backgrounded; no background service required. */
 suspend(now=Date.now()){if(this.suspendedAt===null)this.suspendedAt=now;}
 resume(now=Date.now()){
  if(this.suspendedAt===null)return;const delta=Math.max(0,now-this.suspendedAt);this.suspendedAt=null;
  for(const r of this.store.rooms.values()){if(r.deadline)r.deadline+=delta;for(const p of r.members)if(!p.connected)p.disconnectedAt+=delta;r.updatedAt+=delta;this.publish(r,now);}
 }
 close(reason='The host closed the room.') {for(const p of this.peers.values())this.unseat(p,reason);this.peers.clear();this.store.rooms.clear();}
}
