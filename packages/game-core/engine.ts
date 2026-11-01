import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import type { Command, Player, Settings, Snapshot, Stroke, Message, Phase, Session } from '../protocol/index.ts';
import { words } from './words.ts';
export const normalize = (s:string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export class GameError extends Error {}
type Member = Player & {token:string;disconnectedAt:number;lastMessage:number};
export class Room {
 code:string; hostId=''; members:Member[]=[]; settings:Settings; phase:Phase='lobby';
 round=0; order:string[]=[]; turnIndex=-1; turnId=''; drawerId=''; deadline=0;
 secret=''; choices:string[]=[]; strokes:Stroke[]=[]; undone:Stroke[]=[]; revision=0;
 messages:Message[]=[]; updatedAt:number; used = new Set<string>();
 pausedPhase:Phase='drawing'; remaining=0;
 constructor(code:string,settings:Settings,now:number){this.code=code;this.settings=settings;this.updatedAt=now;}
 add(name:string,avatar:number,now:number):Session {
  if(this.members.length>=this.settings.maxPlayers) throw new GameError('This room is full.');
  const m:Member={id:randomUUID(),token:randomBytes(32).toString('hex'),name,avatar,score:0,connected:true,ready:false,guessed:false,spectator:!['lobby','finished'].includes(this.phase),disconnectedAt:0,lastMessage:-Infinity};
  this.members.push(m); if(!this.hostId)this.hostId=m.id;
  this.system(`${name} joined the room.`,now);this.updatedAt=now;
  return {code:this.code,token:m.token,playerId:m.id};
 }
 member(id:string){const m=this.members.find(m=>m.id===id);if(!m)throw new GameError('You are no longer in this room.');return m;}
 resume(token:string,now:number){const m=this.members.find(m=>m.token===token);if(!m)throw new GameError('Your seat expired. Please join again.');m.connected=true;m.disconnectedAt=0;this.updatedAt=now;return m.id;}
 disconnect(id:string,now:number){const m=this.member(id);m.connected=false;m.disconnectedAt=now;this.transferHost();}
 transferHost(){if(!this.members.find(m=>m.id===this.hostId)?.connected)this.hostId=this.members.find(m=>m.connected)?.id??this.members[0]?.id??'';}
 remove(id:string,now:number){const m=this.member(id);this.members=this.members.filter(p=>p.id!==id);this.transferHost();this.system(`${m.name} left the room.`,now);if(id===this.drawerId&&['drawing','choosing','paused'].includes(this.phase))this.reveal(now);}
 system(text:string,now:number){this.pushMessage({id:randomUUID(),name:'Scribbles',text,kind:'system',at:now});}
 pushMessage(m:Message){this.messages.push(m);if(this.messages.length>100)this.messages.shift();}
 connected(){return this.members.filter(m=>m.connected&&!m.spectator);}
 requireHost(id:string){if(id!==this.hostId)throw new GameError('Only the host can do that.');}
 requireTurn(id:string,turnId:string){if(this.phase!=='drawing'||this.drawerId!==id||turnId!==this.turnId)throw new GameError('It is not your drawing turn.');}
 start(id:string,now:number){
  this.requireHost(id);if(!['lobby','finished'].includes(this.phase))throw new GameError('A game is already running.');
  const players=this.members.filter(m=>m.connected);if(players.length<2)throw new GameError('At least two connected players are needed.');
  if(this.phase==='lobby'&&players.some(m=>m.id!==id&&!m.ready))throw new GameError('Wait for everyone to be ready.');
  for(const m of this.members){m.score=0;m.guessed=false;m.spectator=!m.connected;}
  this.round=1;this.order=players.map(p=>p.id);this.turnIndex=-1;this.used.clear();this.messages=[];this.nextTurn(now);
 }
 nextTurn(now:number){
  this.turnIndex++;
  if(this.turnIndex>=this.order.length){
   this.round++;
   if(this.round>this.settings.rounds){this.phase='finished';this.deadline=0;this.system('Game over! Play again to keep the room.',now);return;}
   for(const p of this.members)if(p.connected)p.spectator=false;
   this.order=this.connected().map(m=>m.id);this.turnIndex=0;
  }
  this.drawerId=this.order[this.turnIndex]??'';
  if(!this.members.some(p=>p.id===this.drawerId&&p.connected)){
   // Finite recursion: each call advances a turn, eventually ending the match.
   this.nextTurn(now);return;
  }
  this.turnId=randomUUID();this.secret='';this.strokes=[];this.undone=[];this.revision=0;
  for(const m of this.members)m.guessed=false;
  const pack=this.settings.pack==='Custom'?this.settings.customWords:words[this.settings.pack];
  const unique=[...new Set(pack.map(w=>w.toLowerCase()))];let available=unique.filter(w=>!this.used.has(w));
  if(available.length<3){this.used.clear();available=unique;}
  this.choices=[];while(this.choices.length<3&&available.length)this.choices.push(available.splice(randomInt(available.length),1)[0]);
  this.phase='choosing';this.deadline=now+15000;this.system(`${this.member(this.drawerId).name} is choosing a word.`,now);
 }
 choose(id:string,index:number,turnId:string,now:number){
  if(this.phase!=='choosing'||id!==this.drawerId||turnId!==this.turnId)throw new GameError('Word selection has ended.');
  this.secret=this.choices[index]??this.choices[0];this.used.add(this.secret);this.choices=[];this.phase='drawing';this.deadline=now+this.settings.seconds*1000;
 }
 reveal(now:number){this.phase='reveal';this.deadline=now+5000;this.choices=[];}
 message(id:string,text:string,mode:'guess'|'chat',turnId:string|undefined,now:number){
  const m=this.member(id);if(now-m.lastMessage<600)throw new GameError('Slow down a little.');m.lastMessage=now;
  const live=['drawing','paused'].includes(this.phase);
  const normalized=normalize(text), answer=normalize(this.secret);
  if(mode==='guess'){
   if(this.phase!=='drawing'||turnId!==this.turnId||m.spectator||m.guessed||id===this.drawerId)throw new GameError('You cannot guess right now.');
   if(normalized===answer){
    const points=100+Math.round(400*Math.max(0,this.deadline-now)/(this.settings.seconds*1000));
    m.guessed=true;m.score+=points;const drawer=this.members.find(p=>p.id===this.drawerId);if(drawer)drawer.score+=50;
    this.pushMessage({id:randomUUID(),playerId:id,name:m.name,avatar:m.avatar,text:`guessed it! +${points}`,kind:'correct',at:now});
    if(this.connected().filter(p=>p.id!==this.drawerId).every(p=>p.guessed))this.reveal(now);return;
   }
  }
  if(live&&answer&&normalized.includes(answer))throw new GameError('Keep the answer secret until the turn ends.');
  this.pushMessage({id:randomUUID(),playerId:id,name:m.name,avatar:m.avatar,text,kind:mode,at:now});
 }
 stroke(id:string,stroke:Stroke,turnId:string){
  this.requireTurn(id,turnId);
  const existing=this.strokes.findIndex(s=>s.id===stroke.id);
  if(existing<0&&this.strokes.length>=500)throw new GameError('Canvas limit reached. Undo or clear to keep drawing.');
  const count=this.strokes.reduce((n,s)=>n+s.points.length,0)-(existing>=0?this.strokes[existing].points.length:0)+stroke.points.length;
  if(count>20000)throw new GameError('Canvas limit reached. Undo or clear to keep drawing.');
  if(existing>=0){const prev=this.strokes[existing];if(stroke.points.length<prev.points.length)return;this.strokes[existing]=stroke;}
  else {this.strokes.push(stroke);this.undone=[];}
  this.revision++;
 }
 canvas(id:string,action:'undo'|'redo'|'clear',turnId:string){
  this.requireTurn(id,turnId);
  if(action==='undo'){const s=this.strokes.pop();if(s)this.undone.push(s);}
  if(action==='redo'){const s=this.undone.pop();if(s)this.strokes.push(s);}
  if(action==='clear'){this.strokes=[];this.undone=[];}
  this.revision++;
 }
 act(id:string,c:Command,now:number){
  this.member(id);this.updatedAt=now;
  switch(c.type){
   case 'settings':this.requireHost(id);if(this.phase!=='lobby')throw new GameError('Settings are locked during a game.');if(c.settings.maxPlayers<this.members.length)throw new GameError('Player limit is below current room size.');this.settings=c.settings;for(const m of this.members)m.ready=false;break;
   case 'ready':if(this.phase!=='lobby')throw new GameError('The game has started.');this.member(id).ready=c.ready;break;
   case 'start':this.start(id,now);break;
   case 'choose':this.choose(id,c.index,c.turnId,now);break;
   case 'message':this.message(id,c.text,c.mode,c.turnId,now);break;
   case 'stroke':this.stroke(id,c.stroke,c.turnId);break;
   case 'canvas':this.canvas(id,c.action,c.turnId);break;
   default:throw new GameError('Unsupported room action.');
  }
 }
 tick(now:number){
  for(const m of [...this.members])if(!m.connected&&now-m.disconnectedAt>=60000)this.remove(m.id,now);
  if(!['choosing','drawing','paused'].includes(this.phase)){
   if(this.phase==='reveal'&&now>=this.deadline)this.nextTurn(now);return;
  }
  const drawer=this.members.find(m=>m.id===this.drawerId);
  if(!drawer||(!drawer.connected&&now-drawer.disconnectedAt>=20000)){this.reveal(now);return;}
  if(this.phase!=='paused'&&this.connected().length<2){this.pausedPhase=this.phase;this.remaining=Math.max(0,this.deadline-now);this.phase='paused';this.deadline=now+60000;}
  if(this.phase==='paused'){
   if(this.connected().length>=2&&drawer.connected){this.phase=this.pausedPhase;this.deadline=now+this.remaining;}
   else if(now>=this.deadline){this.phase='lobby';this.deadline=0;this.secret='';this.choices=[];for(const m of this.members){m.ready=false;m.spectator=false;}this.system('Not enough players. Back to the lobby.',now);}
   return;
  }
  if(now>=this.deadline){if(this.phase==='choosing')this.choose(this.drawerId,0,this.turnId,now);else this.reveal(now);}
 }
 snapshot(id:string,now:number):Snapshot{
  this.member(id);
  const showWord=(id===this.drawerId&&['drawing','paused'].includes(this.phase))||['reveal','finished'].includes(this.phase);
  return {code:this.code,me:id,hostId:this.hostId,settings:{...this.settings,customWords:id===this.hostId?this.settings.customWords:[]},players:this.members.map(({token,disconnectedAt,lastMessage,...p})=>({...p})),phase:this.phase,round:Math.min(this.round,this.settings.rounds),turn:this.turnIndex+1,turnCount:this.order.length,turnId:this.turnId,drawerId:this.drawerId,deadline:this.deadline,serverNow:now,...(showWord&&this.secret?{word:this.secret}:{}),...(id===this.drawerId&&this.phase==='choosing'?{choices:[...this.choices]}:{}),...(this.secret?{hint:this.secret.replace(/[a-z]/gi,'_')}:{}),strokes:this.strokes.map(s=>({...s,points:s.points.map(p=>({...p}))})),canvasRevision:this.revision,messages:this.messages.map(m=>({...m}))};
 }
}
export class GameStore {
 rooms=new Map<string,Room>();
 create(settings:Settings,name:string,avatar:number,now:number){
  if(this.rooms.size>=1000)throw new GameError('Server is busy. Try again shortly.');
  let code='';do{code=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.length)]).join('');}while(this.rooms.has(code));
  const room=new Room(code,settings,now);const session=room.add(name,avatar,now);this.rooms.set(code,room);return {room,session};
 }
 get(code:string){const r=this.rooms.get(code);if(!r)throw new GameError('Room not found or expired.');return r;}
 sweep(now:number){for(const [code,r] of this.rooms){r.tick(now);if(!r.members.length||(!r.members.some(m=>m.connected)&&now-r.updatedAt>120000))this.rooms.delete(code);}}
}
