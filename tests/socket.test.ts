import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { createGameServer } from '../apps/server/src/server.ts';
import { defaults, type Ack, type Command, type Snapshot } from '../packages/protocol/index.ts';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function connect(url:string){const s=io(url,{transports:['websocket'],forceNew:true});await new Promise<void>((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
async function cmd(s:Socket,command:Command,id=randomUUID()):Promise<Ack>{return new Promise((resolve,reject)=>s.timeout(2000).emit('command',{id,command},(e:Error|null,a:Ack)=>e?reject(e):resolve(a)));}
async function state(s:Socket):Promise<Snapshot>{return new Promise(resolve=>s.emit('sync',resolve));}
test('real sockets: create/join, ready/start, private words, live strokes, chat, duplicate delivery, reconnect and kick',async()=>{
 const server=createGameServer();await new Promise<void>(r=>server.http.listen(0,'127.0.0.1',r));const address=server.http.address() as {port:number};const url=`http://127.0.0.1:${address.port}`;const clients:Socket[]=[];
 try{
  const a=await connect(url),b=await connect(url),c=await connect(url);clients.push(a,b,c);
  const created=await cmd(a,{type:'create',name:'Alice',avatar:0,settings:defaults});assert.ok(created.ok&&created.session);if(!created.ok||!created.session)throw Error('No session');const code=created.session.code;
  const joined=await cmd(b,{type:'join',code,name:'Bob',avatar:1});assert.ok(joined.ok&&joined.session);if(!joined.ok||!joined.session)throw Error('No session');
  assert.equal((await cmd(b,{type:'start'})).ok,false);await cmd(b,{type:'ready',ready:true});assert.equal((await cmd(a,{type:'start'})).ok,true);
  const before=await state(a);assert.equal(before.choices?.length,3);assert.equal((await state(b)).choices,undefined);
  await cmd(a,{type:'choose',index:0,turnId:before.turnId});const drawing=await state(a);assert.ok(drawing.word);assert.equal((await state(b)).word,undefined);
  const event=new Promise<any>(resolve=>b.once('stroke',resolve));const stroke={id:'stroke',color:'#20242D',width:5,points:[{x:.2,y:.4}]};
  assert.equal((await cmd(b,{type:'stroke',stroke,turnId:drawing.turnId})).ok,false);await cmd(a,{type:'stroke',stroke,turnId:drawing.turnId});assert.deepEqual((await event).stroke,stroke);
  await cmd(b,{type:'message',text:'hello','mode':'chat',turnId:drawing.turnId});assert.equal((await state(a)).messages.at(-1)?.text,'hello');
  await wait(650);const requestId=randomUUID();const guess:Command={type:'message',text:drawing.word!,mode:'guess',turnId:drawing.turnId};await cmd(b,guess,requestId);const score=(await state(b)).players.find(p=>p.id===joined.session!.playerId)!.score;
  await cmd(b,guess,requestId);assert.equal((await state(b)).players.find(p=>p.id===joined.session!.playerId)!.score,score);
  b.disconnect();await wait(50);const resumed=await cmd(c,{type:'resume',code,token:joined.session.token});assert.equal(resumed.ok,true);assert.equal((await state(c)).me,joined.session.playerId);assert.equal((await state(c)).strokes.length,1);
  await cmd(a,{type:'kick',playerId:joined.session.playerId});assert.equal(server.store.get(code).members.length,1);assert.equal((await cmd(c,{type:'resume',code,token:joined.session.token})).ok,false);
 }finally{clients.forEach(s=>s.disconnect());await server.close();}
});
test('malformed payloads and membership isolation are rejected',async()=>{
 const server=createGameServer();await new Promise<void>(r=>server.http.listen(0,'127.0.0.1',r));const address=server.http.address() as {port:number};const a=await connect(`http://127.0.0.1:${address.port}`);
 try{assert.equal((await cmd(a,{type:'start'})).ok,false);const bad=await new Promise<Ack>(r=>a.emit('command',{id:'valid-id',command:{type:'message',text:'x'.repeat(201),mode:'chat'}},r));assert.equal(bad.ok,false);}finally{a.disconnect();await server.close();}
});
