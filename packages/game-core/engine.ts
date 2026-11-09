import { webRandom, randomHex, randomIndex, type RandomSource } from './random.ts';
import type { Command, Player, Settings, Snapshot, Stroke, Message, Phase, Session } from '../protocol/index.ts';
import { words } from './words.ts';
export const normalize = (s:string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export class GameError extends Error {}
const wordsOf = (s:string) => s.normalize('NFKC').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** True when the text contains the answer as whole word(s), even spaced out ("c a t"), but not inside other words ("category"). */
export function containsAnswer(text:string,secret:string){
 const target=wordsOf(secret).join('');if(!target)return false;const w=wordsOf(text);
 for(let i=0;i<w.length;i++){let acc='';for(let j=i;j<w.length;j++){acc+=w[j];if(acc===target)return true;if(acc.length>=target.length)break;}}
 return false;
}
type Member = Player & {token:string;disconnectedAt:number;lastMessage:number};
export class Room {
 code:string; hostId=''; ownerId=''; members:Member[]=[]; settings:Settings; phase:Phase='lobby';
 round=0; order:string[]=[]; turnIndex=-1; turnId=''; drawerId=''; deadline=0;
 secret=''; choices:string[]=[]; hintPositions:number[]=[]; strokes:Stroke[]=[]; undone:Stroke[]=[]; revision=0;
 messages:Message[]=[]; updatedAt:number; used = new Set<string>();
 pausedPhase:Phase='drawing'; remaining=0;
 constructor(code:string,settings:Settings,now:number,private random:RandomSource=webRandom){this.code=code;this.settings=settings;this.updatedAt=now;}
 add(name:string,avatar:number,now:number):Session {
  if(!['lobby','finished'].includes(this.phase)&&!this.settings.allowLateJoin)throw new GameError('This room is locked until the game ends.');
  if(this.members.length>=this.settings.maxPlayers) throw new GameError('This room is full.');
  const taken=(n:string)=>this.members.some(p=>p.name.toLowerCase()===n.toLowerCase());
  if(taken(name)){const base=name.slice(0,17);for(let i=2;i<100;i++){const n=`${base} ${i}`;if(!taken(n)){name=n;break;}}}
  const m:Member={id:randomHex(this.random),token:randomHex(this.random,32),name,avatar,score:0,connected:true,ready:false,guessed:false,spectator:!['lobby','finished'].includes(this.phase),disconnectedAt:0,lastMessage:-Infinity};
  this.members.push(m); if(!this.hostId)this.hostId=m.id; if(!this.ownerId)this.ownerId=m.id;
  this.system(`${name} joined the room.`,now);this.updatedAt=now;
  return {code:this.code,token:m.token,playerId:m.id};
 }
 member(id:string){const m=this.members.find(m=>m.id===id);if(!m)throw new GameError('You are no longer in this room.');return m;}
 resume(token:string,now:number){const m=this.members.find(m=>m.token===token);if(!m)throw new GameError('Your seat expired. Please join again.');m.connected=true;m.disconnectedAt=0;this.updatedAt=now;this.transferHost();return m.id;}
 disconnect(id:string,now:number){const m=this.member(id);m.connected=false;m.disconnectedAt=now;this.transferHost();this.checkAllGuessed(now);}
 /** The room creator gets the host role back whenever they are connected. */
 transferHost(){const owner=this.members.find(m=>m.id===this.ownerId);if(owner?.connected){this.hostId=owner.id;return;}
  if(!this.members.find(m=>m.id===this.hostId)?.connected)this.hostId=this.members.find(m=>m.connected)?.id??this.members.find(m=>m.id===this.hostId)?.id??this.members[0]?.id??'';}
 /** Ends the turn as soon as every remaining eligible guesser has guessed (also after someone leaves). */
 checkAllGuessed(now:number){if(this.phase!=='drawing')return;const guessers=this.connected().filter(p=>p.id!==this.drawerId);if(guessers.length&&guessers.every(p=>p.guessed))this.reveal(now);}
 remove(id:string,now:number){const m=this.member(id);this.members=this.members.filter(p=>p.id!==id);if(this.ownerId===id)this.ownerId='';this.transferHost();if(!this.ownerId)this.ownerId=this.hostId;this.system(`${m.name} left the room.`,now);if(id===this.drawerId&&['drawing','choosing','paused'].includes(this.phase))this.reveal(now);else this.checkAllGuessed(now);}
 system(text:string,now:number){this.pushMessage({id:randomHex(this.random),name:'Scribbles',text,kind:'system',at:now});}
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
  this.turnId=randomHex(this.random);this.secret='';this.strokes=[];this.undone=[];this.revision=0;
  for(const m of this.members)m.guessed=false;
  const pack=this.settings.mode==='custom'?this.settings.customWords:words[this.settings.pack];
  const unique=[...new Set(pack.map(w=>w.toLowerCase()))];let available=unique.filter(w=>!this.used.has(w));
  if(available.length<this.settings.wordChoices){this.used.clear();available=unique;}
  this.choices=[];while(this.choices.length<this.settings.wordChoices&&available.length)this.choices.push(available.splice(randomIndex(this.random,available.length),1)[0]);
  this.phase='choosing';this.deadline=now+this.settings.choiceSeconds*1000;this.system(`${this.member(this.drawerId).name} is choosing a word.`,now);
 }
 choose(id:string,index:number,turnId:string,now:number){
  if(this.phase!=='choosing'||id!==this.drawerId||turnId!==this.turnId)throw new GameError('Word selection has ended.');
  if(!this.choices[index])throw new GameError('Choose one of the offered words.');
  this.secret=this.choices[index];this.hintPositions=Array.from(this.secret).flatMap((c,i)=>/[a-z]/i.test(c)?[i]:[]);
  for(let i=this.hintPositions.length-1;i>0;i--){const j=randomIndex(this.random,i+1);[this.hintPositions[i],this.hintPositions[j]]=[this.hintPositions[j],this.hintPositions[i]];}
  this.used.add(this.secret);this.choices=[];this.phase='drawing';this.deadline=now+this.settings.seconds*1000;
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
    this.pushMessage({id:randomHex(this.random),playerId:id,name:m.name,avatar:m.avatar,text:`guessed it! +${points}`,kind:'correct',at:now});
    this.checkAllGuessed(now);return;
   }
   if(containsAnswer(text,this.secret))throw new GameError('Send just your guess on its own.');
  }
  if(live&&containsAnswer(text,this.secret))throw new GameError('Keep the answer secret until the turn ends.');
  // The drawer and players who already guessed chat among themselves until the turn ends.
  if(mode==='chat'&&live&&(id===this.drawerId||m.guessed)){this.pushMessage({id:randomHex(this.random),playerId:id,name:m.name,avatar:m.avatar,text,kind:'chat',at:now,secretTurn:this.turnId});return;}
  this.pushMessage({id:randomHex(this.random),playerId:id,name:m.name,avatar:m.avatar,text,kind:mode,at:now});
 }
 /** Without `from` the stroke replaces the whole line. With `from`, stroke.points are only the new points, appended at that index. */
 stroke(id:string,stroke:Stroke,turnId:string,from?:number){
  this.requireTurn(id,turnId);
  const existing=this.strokes.findIndex(s=>s.id===stroke.id);
  let points=stroke.points;
  if(from!==undefined){
   const prev=existing>=0?this.strokes[existing].points:[];
   if(from>prev.length)throw new GameError('Drawing is out of sync. Refreshing the canvas.');
   points=prev.slice(0,from).concat(stroke.points);
   if(points.length>1500)throw new GameError('That line is too long. Lift your finger and keep drawing.');
  }
  if(existing<0&&this.strokes.length>=500)throw new GameError('Canvas limit reached. Undo or clear to keep drawing.');
  const count=this.strokes.reduce((n,s)=>n+s.points.length,0)-(existing>=0?this.strokes[existing].points.length:0)+points.length;
  if(count>20000)throw new GameError('Canvas limit reached. Undo or clear to keep drawing.');
  const next={...stroke,points};
  if(existing>=0){const prev=this.strokes[existing];if(from===undefined&&points.length<prev.points.length)return;this.strokes[existing]=next;}
  else {this.strokes.push(next);this.undone=[];}
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
   case 'settings':this.requireHost(id);if(!['lobby','finished'].includes(this.phase))throw new GameError('Settings are locked during a game.');if(c.settings.maxPlayers<this.members.length)throw new GameError('Player limit is below current room size.');this.settings=c.settings;for(const m of this.members)m.ready=false;
    // Changing settings after a match returns everyone to the lobby to ready up again.
    if(this.phase==='finished'){this.phase='lobby';this.deadline=0;for(const m of this.members){m.spectator=false;m.guessed=false;}this.system('The host changed the settings. Ready up for the next game!',now);}
    break;
   case 'ready':if(this.phase!=='lobby')throw new GameError('The game has started.');this.member(id).ready=c.ready;break;
   case 'start':this.start(id,now);break;
   case 'choose':this.choose(id,c.index,c.turnId,now);break;
   case 'message':this.message(id,c.text,c.mode,c.turnId,now);break;
   case 'stroke':this.stroke(id,c.stroke,c.turnId,c.from);break;
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
  // A connected late joiner can keep the game alive: let them play this round instead of pausing.
  if(this.connected().length<2)for(const m of this.members)if(m.connected&&m.spectator){m.spectator=false;if(!this.order.includes(m.id))this.order.push(m.id);}
  if(this.phase!=='paused'&&this.connected().length<2){this.pausedPhase=this.phase;this.remaining=Math.max(0,this.deadline-now);this.phase='paused';this.deadline=now+60000;}
  if(this.phase==='paused'){
   if(this.connected().length>=2&&drawer.connected){this.phase=this.pausedPhase;this.deadline=now+this.remaining;}
   else if(now>=this.deadline){this.phase='lobby';this.deadline=0;this.secret='';this.choices=[];for(const m of this.members){m.ready=false;m.spectator=false;}this.system('Not enough players. Back to the lobby.',now);}
   return;
  }
  if(now>=this.deadline){if(this.phase==='choosing')this.choose(this.drawerId,0,this.turnId,now);else this.reveal(now);}
 }
 hint(now:number){
  if(!this.secret)return '';
  const remaining=this.phase==='paused'?this.remaining:Math.max(0,this.deadline-now);
  const elapsed=this.settings.seconds*1000-remaining;
  const count=this.phase==='drawing'||this.phase==='paused'?Math.min(this.settings.hints,Math.max(0,this.hintPositions.length-2),Math.floor(Math.max(0,elapsed)/(this.settings.seconds*1000)*(this.settings.hints+1))):0;
  const reveal=new Set(this.hintPositions.slice(0,count));
  return Array.from(this.secret).map((c,i)=>/[a-z]/i.test(c)&&!reveal.has(i)?'_':c).join('');
 }
 /** Secret chat (drawer + players who guessed) stays private until the turn ends. */
 canSeeSecret(id:string){return !['choosing','drawing','paused'].includes(this.phase)||id===this.drawerId||!!this.members.find(m=>m.id===id)?.guessed;}
 /** withCanvas=false omits strokes: clients keep their canvas and apply stroke events instead. */
 snapshot(id:string,now:number,withCanvas=true):Snapshot{
  this.member(id);const secret=this.canSeeSecret(id);
  const showWord=(id===this.drawerId&&['drawing','paused'].includes(this.phase))||['reveal','finished'].includes(this.phase);
  return {code:this.code,me:id,hostId:this.hostId,settings:{...this.settings,customWords:id===this.hostId?this.settings.customWords:[]},players:this.members.map(({token,disconnectedAt,lastMessage,...p})=>({...p})),phase:this.phase,round:Math.min(this.round,this.settings.rounds),turn:this.turnIndex+1,turnCount:this.order.length,turnId:this.turnId,drawerId:this.drawerId,deadline:this.deadline,serverNow:now,...(showWord&&this.secret?{word:this.secret}:{}),...(id===this.drawerId&&this.phase==='choosing'?{choices:[...this.choices]}:{}),...(this.secret?{hint:this.hint(now)}:{}),strokes:withCanvas?this.strokes.map(s=>({...s,points:s.points.map(p=>({...p}))})):[],...(withCanvas?{}:{canvasOmitted:true as const}),canvasRevision:this.revision,messages:this.messages.filter(m=>secret||!m.secretTurn||m.secretTurn!==this.turnId).map(m=>({...m}))};
 }
}
export class GameStore {
 rooms=new Map<string,Room>();
 constructor(private random:RandomSource=webRandom){}
 create(settings:Settings,name:string,avatar:number,now:number){
  if(this.rooms.size>=1000)throw new GameError('Server is busy. Try again shortly.');
  let code='';do{code=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomIndex(this.random,'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.length)]).join('');}while(this.rooms.has(code));
  const room=new Room(code,settings,now,this.random);const session=room.add(name,avatar,now);this.rooms.set(code,room);return {room,session};
 }
 get(code:string){const r=this.rooms.get(code);if(!r)throw new GameError('Room not found or expired.');return r;}
 sweep(now:number){for(const [code,r] of this.rooms){r.tick(now);if(!r.members.length||(!r.members.some(m=>m.connected)&&now-r.updatedAt>120000))this.rooms.delete(code);}}
}
