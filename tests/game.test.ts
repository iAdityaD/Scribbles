import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, GameStore, normalize } from '../packages/game-core/engine.ts';
import { HostRuntime } from '../packages/game-core/runtime.ts';
import { defaults, commandSchema } from '../packages/protocol/index.ts';
function setup(count=3){const room=new Room('ABC234',{...defaults,rounds:1},0);const sessions=Array.from({length:count},(_,i)=>room.add(`Player ${i}`,i,0));for(const s of sessions)room.act(s.playerId,{type:'ready',ready:true},0);room.start(sessions[0].playerId,0);room.choose(sessions[0].playerId,0,room.turnId,100);return {room,sessions,ids:sessions.map(s=>s.playerId)};}
test('secret word and choices never reach guessers, nor do session tokens',()=>{
 const r=new Room('ABC234',defaults,0),a=r.add('Alice',0,0),b=r.add('Bob',1,0);r.act(b.playerId,{type:'ready',ready:true},0);r.start(a.playerId,0);
 assert.equal(r.snapshot(b.playerId,0).choices,undefined);assert.equal(r.snapshot(a.playerId,0).choices?.length,3);
 r.choose(a.playerId,0,r.turnId,0);assert.equal(r.snapshot(b.playerId,0).word,undefined);assert.ok(r.snapshot(a.playerId,0).word);
 assert.ok(!JSON.stringify(r.snapshot(b.playerId,0)).includes(a.token));
});
test('scoring is server-owned; duplicate and stale guesses cannot score',()=>{
 const {room:r,ids}=setup();r.message(ids[1],r.secret,'guess',r.turnId,1100);assert.equal(r.member(ids[1]).score,495);assert.equal(r.member(ids[0]).score,50);
 assert.throws(()=>r.message(ids[1],r.secret,'guess',r.turnId,2100));assert.equal(r.member(ids[1]).score,495);
 assert.throws(()=>r.message(ids[2],r.secret,'guess','stale',3100));
 r.message(ids[2],r.secret,'guess',r.turnId,4100);assert.equal(r.phase,'reveal');assert.equal(r.snapshot(ids[2],4100).word,r.secret);
});
test('only drawer can draw; canvas undo redo clear remain authoritative',()=>{
 const {room:r,ids}=setup();const s={id:'stroke-1',color:'#20242D',width:7,points:[{x:.1,y:.2}]};
 assert.throws(()=>r.stroke(ids[1],s,r.turnId));r.stroke(ids[0],s,r.turnId);r.stroke(ids[0],{...s,points:[...s.points,{x:.3,y:.4}]},r.turnId);assert.equal(r.strokes.length,1);
 r.canvas(ids[0],'undo',r.turnId);assert.equal(r.strokes.length,0);r.canvas(ids[0],'redo',r.turnId);assert.equal(r.strokes.length,1);r.canvas(ids[0],'clear',r.turnId);assert.equal(r.strokes.length,0);
});
test('chat hides answer spoilers and normalizes exact guesses',()=>{
 const {room:r,ids}=setup();r.secret='Birthday Cake';assert.equal(normalize(' birthday-cake! '),'birthdaycake');
 assert.throws(()=>r.message(ids[0],'it is birthday cake','chat',r.turnId,1000));
 r.message(ids[1],'BIRTHDAY-CAKE!','guess',r.turnId,1000);assert.ok(r.member(ids[1]).guessed);
 assert.ok(!r.messages.some(m=>normalize(m.text).includes('birthdaycake')));
 r.message(ids[1],'nice drawing','chat',r.turnId,2000);assert.equal(r.messages.at(-1)?.text,'nice drawing');
});
test('host migration, reconnect seat, timeout and invalid tokens',()=>{
 const {room:r,sessions,ids}=setup();r.disconnect(ids[0],1000);assert.equal(r.hostId,ids[1]);assert.throws(()=>r.resume('wrong',1500));
 assert.equal(r.resume(sessions[0].token,2000),ids[0]);assert.equal(r.member(ids[0]).connected,true);
 r.disconnect(ids[0],3000);r.tick(23001);assert.equal(r.phase,'reveal');r.tick(64000);assert.ok(!r.members.some(m=>m.id===ids[0]));
});
test('late joiners spectate until next round; one round includes every drawer',()=>{
 const {room:r,ids}=setup(2);r.settings.rounds=2;const late=r.add('Late',3,1000);assert.equal(r.member(late.playerId).spectator,true);
 r.reveal(2000);r.tick(7000);assert.equal(r.drawerId,ids[1]);assert.equal(r.round,1);
 r.reveal(8000);r.tick(13000);assert.equal(r.round,2);assert.equal(r.order.length,3);assert.equal(r.member(late.playerId).spectator,false);
});
test('full match finishes, then rematch resets scores and preserves room',()=>{
 const {room:r,ids}=setup(2);r.message(ids[1],r.secret,'guess',r.turnId,1000);r.tick(6000);assert.equal(r.phase,'choosing');assert.equal(r.drawerId,ids[1]);
 r.choose(ids[1],0,r.turnId,6100);r.message(ids[0],r.secret,'guess',r.turnId,7000);r.tick(12000);assert.equal(r.phase,'finished');
 r.start(ids[0],13000);assert.equal(r.phase,'choosing');assert.ok(r.members.every(m=>m.score===0));assert.equal(r.code,'ABC234');
});
test('pause and resume preserve remaining turn time',()=>{
 const {room:r,sessions,ids}=setup(2);r.disconnect(ids[1],10100);r.tick(10100);assert.equal(r.phase,'paused');assert.equal(r.remaining,70000);
 r.resume(sessions[1].token,15100);r.tick(15100);assert.equal(r.phase,'drawing');assert.equal(r.deadline,85100);
});
test('host-only settings/start, ready requirements and custom word validation',()=>{
 const r=new Room('ABC234',defaults,0);const a=r.add('Alice',0,0),b=r.add('Bob',1,0);
 assert.throws(()=>r.start(b.playerId,1));assert.throws(()=>r.start(a.playerId,1));assert.throws(()=>r.act(b.playerId,{type:'settings',settings:defaults},1));
 assert.equal(commandSchema.safeParse({type:'create',name:'A',avatar:0,settings:{...defaults,pack:'Custom',customWords:['cat','cat','dog']}}).success,false);
 assert.equal(commandSchema.safeParse({type:'stroke',turnId:'x',stroke:{id:'x',color:'red',width:7,points:[{x:2,y:0}]}}).success,false);
});
test('rooms are isolated and empty rooms expire',()=>{
 const store=new GameStore();const a=store.create(defaults,'A',0,0),b=store.create(defaults,'B',1,0);assert.notEqual(a.room.code,b.room.code);assert.throws(()=>a.room.member(b.session.playerId));
 a.room.remove(a.session.playerId,100);store.sweep(101);assert.equal(store.rooms.has(a.room.code),false);assert.equal(store.rooms.size,1);
});

test('custom sets require 20–100 canonical unique words in both room and set schemas',async()=>{
 const {wordSetSchema,wordListSchema,parseWordText}=await import('../packages/protocol/index.ts');
 const {words}=await import('../packages/game-core/words.ts');const twenty=words.Classic.slice(0,20);
 assert.ok(wordSetSchema.safeParse({id:'set-1',name:'Game night',words:twenty}).success);
 assert.equal(wordListSchema.safeParse(twenty.slice(0,19)).success,false);
 assert.equal(wordListSchema.safeParse([...twenty,'Mountain']).success,false);
 assert.equal(wordListSchema.safeParse([...twenty,'birthday cake','birthday-cake']).success,false);
 assert.equal(wordListSchema.safeParse([...twenty,...Array(81).fill('extra')]).success,false);
 assert.deepEqual(parseWordText(' mountain, rainbow\n birthday cake;castle '),['mountain','rainbow','birthday cake','castle']);
 const c={type:'create',name:'Host',avatar:0,settings:{...defaults,mode:'custom',wordSetName:'Game night',customWords:twenty}};
 assert.ok(commandSchema.safeParse(c).success);assert.equal(commandSchema.safeParse({...c,settings:{...c.settings,customWords:twenty.slice(0,19)}}).success,false);
});
test('custom mode offers only words from its selected set and respects word-choice count',async()=>{
 const {words}=await import('../packages/game-core/words.ts');const chosen=words.Animals.slice(0,20);
 const r=new Room('ABC234',{...defaults,mode:'custom',wordSetName:'Animal night',customWords:chosen,wordChoices:2,choiceSeconds:20},0);
 const a=r.add('Alice',0,0),b=r.add('Bob',1,0);r.act(b.playerId,{type:'ready',ready:true},0);r.start(a.playerId,100);
 assert.equal(r.choices.length,2);assert.ok(r.choices.every(w=>chosen.includes(w)));assert.equal(r.deadline,20100);
 assert.equal(r.snapshot(b.playerId,100).settings.wordSetName,'Animal night');assert.deepEqual(r.snapshot(b.playerId,100).settings.customWords,[]);
 assert.throws(()=>r.choose(a.playerId,2,r.turnId,200));r.choose(a.playerId,0,r.turnId,200);assert.ok(chosen.includes(r.secret));
});
test('scheduled hints reveal only configured letters and stop when paused',()=>{
 const {room:r,ids}=setup(2);r.secret='mountain';r.hintPositions=[0,1,2,3,4,5,6,7];r.settings.hints=2;
 assert.equal(r.hint(100),'________');assert.equal(r.hint(30100),'m_______');assert.equal(r.hint(60100),'mo______');
 r.disconnect(ids[1],30100);r.tick(30100);assert.equal(r.hint(50100),'m_______');
 r.settings.hints=0;assert.equal(r.hint(50100),'________');
});
test('host may lock mid-game joining while keeping reconnect available',()=>{
 const {room:r,sessions,ids}=setup(2);r.settings.allowLateJoin=false;assert.throws(()=>r.add('Late',2,1000));
 r.disconnect(ids[1],1000);assert.equal(r.resume(sessions[1].token,1500),ids[1]);
});

test('spoiler filter matches whole words only; near-miss guesses count as wrong guesses',async()=>{
 const {containsAnswer}=await import('../packages/game-core/engine.ts');
 assert.equal(containsAnswer('this is a category thing','cat'),false);assert.equal(containsAnswer('the CAT!','cat'),true);
 assert.equal(containsAnswer('c a t','cat'),true);assert.equal(containsAnswer('a birthday-cake please','birthday cake'),true);
 const {room:r,ids}=setup();r.secret='cat';
 r.message(ids[1],'this is a category thing','chat',r.turnId,1000);assert.equal(r.messages.at(-1)?.text,'this is a category thing');
 r.message(ids[2],'cats','guess',r.turnId,2000);assert.equal(r.messages.at(-1)?.kind,'guess');assert.equal(r.member(ids[2]).guessed,false);
 assert.throws(()=>r.message(ids[2],'is it a cat','guess',r.turnId,3000),/on its own/);assert.equal(r.member(ids[2]).guessed,false);
});
test('turn ends when the last player who has not guessed leaves or disconnects',()=>{
 const left=setup(3);left.room.message(left.ids[1],left.room.secret,'guess',left.room.turnId,1000);left.room.remove(left.ids[2],2000);assert.equal(left.room.phase,'reveal');
 const dropped=setup(3);dropped.room.message(dropped.ids[1],dropped.room.secret,'guess',dropped.room.turnId,1000);dropped.room.disconnect(dropped.ids[2],2000);assert.equal(dropped.room.phase,'reveal');
 const nobody=setup(3);nobody.room.remove(nobody.ids[2],2000);assert.equal(nobody.room.phase,'drawing');
});
test('room creator gets the host role back after reconnecting; leaving hands it on for good',()=>{
 const {room:r,sessions,ids}=setup(3);r.disconnect(ids[0],1000);assert.equal(r.hostId,ids[1]);
 r.resume(sessions[0].token,2000);assert.equal(r.hostId,ids[0]);
 r.remove(ids[0],3000);assert.equal(r.hostId,ids[1]);r.disconnect(ids[1],4000);assert.equal(r.hostId,ids[2]);r.resume(sessions[1].token,5000);assert.equal(r.hostId,ids[1]);
});
test('a connected late joiner keeps a two-player game alive instead of pausing',()=>{
 const {room:r,ids}=setup(2);const late=r.add('Late',3,1000);r.remove(ids[1],2000);r.tick(2000);
 assert.equal(r.phase,'drawing');assert.equal(r.member(late.playerId).spectator,false);assert.ok(r.order.includes(late.playerId));
 r.message(late.playerId,r.secret,'guess',r.turnId,3000);assert.equal(r.member(late.playerId).guessed,true);
});
test('drawer and successful guessers chat privately until the turn ends',()=>{
 const {room:r,ids}=setup(3);r.message(ids[1],r.secret,'guess',r.turnId,1000);r.message(ids[1],'that was easy','chat',r.turnId,2000);
 const has=(id:string)=>r.snapshot(id,2000).messages.some(m=>m.text==='that was easy');
 assert.equal(has(ids[0]),true);assert.equal(has(ids[1]),true);assert.equal(has(ids[2]),false);
 r.message(ids[2],'hello all','chat',r.turnId,3000);assert.ok(r.snapshot(ids[0],3000).messages.some(m=>m.text==='hello all'));
 r.reveal(4000);assert.equal(has(ids[2]),true);
});
test('stroke deltas append points; out-of-sync deltas are rejected; snapshots can omit the canvas',()=>{
 const {room:r,ids}=setup();const base={id:'line',color:'#20242D',width:7};
 r.stroke(ids[0],{...base,points:[{x:.1,y:.1}]},r.turnId,0);r.stroke(ids[0],{...base,points:[{x:.2,y:.2},{x:.3,y:.3}]},r.turnId,1);
 assert.deepEqual(r.strokes[0].points.map(p=>p.x),[.1,.2,.3]);
 r.stroke(ids[0],{...base,points:[{x:.25,y:.25}]},r.turnId,2);assert.deepEqual(r.strokes[0].points.map(p=>p.x),[.1,.2,.25]);
 assert.throws(()=>r.stroke(ids[0],{...base,points:[{x:.5,y:.5}]},r.turnId,9),/out of sync/);
 assert.throws(()=>r.stroke(ids[0],{...base,id:'new',points:[{x:.5,y:.5}]},r.turnId,4),/out of sync/);
 r.stroke(ids[0],{...base,points:[{x:.9,y:.9}]},r.turnId,0);assert.equal(r.strokes[0].points.length,1);
 const light=r.snapshot(ids[1],1000,false);assert.equal(light.canvasOmitted,true);assert.deepEqual(light.strokes,[]);assert.equal(r.snapshot(ids[1],1000).strokes.length,1);
});
test('host can change settings after a match, which returns the room to the lobby; duplicate names get a number',()=>{
 const {room:r,ids}=setup(2);r.phase='finished';r.act(ids[0],{type:'settings',settings:{...defaults,rounds:2}},1000);
 assert.equal(r.phase,'lobby');assert.equal(r.settings.rounds,2);assert.ok(r.members.every(m=>!m.ready));
 const dup=r.add('player 0',4,2000);assert.equal(r.member(dup.playerId).name,'player 0 2');
});
test('runtime sends canvas strokes only when the canvas is rebuilt; stroke events carry only new points',()=>{
 const rt=new HostRuntime();const seen:any[]=[];rt.connect('a',()=>{});rt.connect('b',e=>seen.push(e));
 const created=rt.request('a',{id:'req-create-1',command:{type:'create',name:'A',avatar:0,settings:defaults}});const code=(created as any).session.code;
 rt.request('b',{id:'req-join-001',command:{type:'join',code,name:'B',avatar:1}});rt.request('b',{id:'req-ready-01',command:{type:'ready',ready:true}});
 assert.equal(seen.filter(e=>e.type==='state').at(0).state.canvasOmitted,undefined);
 rt.request('a',{id:'req-start-01',command:{type:'start'}});const turnId=rt.store.get(code).turnId;rt.request('a',{id:'req-choose-1',command:{type:'choose',index:0,turnId}});
 assert.equal(seen.filter(e=>e.type==='state').at(-1).state.canvasOmitted,true);
 rt.request('a',{id:'req-stroke-1',command:{type:'stroke',turnId,from:0,stroke:{id:'s1',color:'#20242D',width:5,points:[{x:.1,y:.1}]}}});
 rt.request('a',{id:'req-stroke-2',command:{type:'stroke',turnId,from:1,stroke:{id:'s1',color:'#20242D',width:5,points:[{x:.2,y:.2}]}}});
 const ev=seen.filter(e=>e.type==='stroke').at(-1).event;assert.equal(ev.from,1);assert.equal(ev.stroke.points.length,1);assert.equal(rt.store.get(code).strokes[0].points.length,2);
 rt.request('a',{id:'req-undo-001',command:{type:'canvas',action:'undo',turnId}});assert.equal(seen.filter(e=>e.type==='state').at(-1).state.canvasOmitted,undefined);
});
