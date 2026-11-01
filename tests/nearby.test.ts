import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NearbyTransport } from '../packages/network/NearbyTransport.ts';
import { SocketTransport } from '../packages/network/SocketTransport.ts';
import { FramedPeer } from '../packages/network/framing.ts';
import { webRandom } from '../packages/game-core/random.ts';
import { HostRuntime } from '../packages/game-core/runtime.ts';
import type { NearbyBridge, RadioEvent } from '../packages/network/NearbyBridge.ts';
import { defaults, type Command, type Snapshot } from '../packages/protocol/index.ts';
import { createGameServer } from '../apps/server/src/server.ts';
const wait=(ms=10)=>new Promise(r=>setTimeout(r,ms));
const request=(t:NearbyTransport|SocketTransport,command:Command,id=randomUUID())=>t.request({id,command});
class Radio implements NearbyBridge {
 static radios=new Map<string,Radio>();
 name='';scanning=false;listeners=new Set<(e:RadioEvent)=>void>();peers=new Set<string>();reject=false;
 constructor(readonly id:string){Radio.radios.set(id,this);}
 async prepare(){}
 subscribe(fn:(e:RadioEvent)=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 emit(e:RadioEvent){for(const l of this.listeners)l(e);}
 async advertise(name:string){this.name=name;for(const r of Radio.radios.values())if(r.scanning)r.emit({type:'found',endpointId:this.id,name});}
 async discover(){this.scanning=true;for(const r of Radio.radios.values())if(r.name&&r.id!==this.id)this.emit({type:'found',endpointId:r.id,name:r.name});}
 async stopDiscovery(){this.scanning=false;}
 async requestConnection(id:string){const remote=Radio.radios.get(id)!;if(this.reject||remote.reject){this.emit({type:'disconnected',endpointId:id});return;}this.peers.add(id);remote.peers.add(this.id);remote.emit({type:'connected',endpointId:this.id});this.emit({type:'connected',endpointId:id});}
 async send(id:string,data:string){if(!this.peers.has(id))throw Error('No peer');Radio.radios.get(id)!.emit({type:'payload',endpointId:this.id,data});}
 async disconnectEndpoint(id:string){this.peers.delete(id);const remote=Radio.radios.get(id);remote?.peers.delete(this.id);this.emit({type:'disconnected',endpointId:id});remote?.emit({type:'disconnected',endpointId:this.id});}
 async stop(){this.name='';this.scanning=false;for(const id of [...this.peers])await this.disconnectEndpoint(id);}
}
const localSettings={...defaults,maxPlayers:6,rounds:1};
test('Nearby: six players, private words, drawing + live drawer chat, scoring, reconnect, limits and closure',async()=>{
 Radio.radios.clear();const radios=Array.from({length:7},(_,i)=>new Radio(`device-${i}`));const transports=radios.map(r=>new NearbyTransport(r,webRandom));
 const [host,...guests]=transports;const received:Snapshot[]=[];host.subscribe(e=>{if(e.type==='state')received.push(e.state);});
 try{
  for(const t of transports)await t.connect();
  const created=await request(host,{type:'create',name:'Host',avatar:0,settings:localSettings});assert.ok(created.ok&&created.session);if(!created.ok||!created.session)throw Error();const code=created.session.code;
  for(let i=0;i<5;i++){const ack=await request(guests[i],{type:'join',code,name:`Guest ${i}`,avatar:i+1});assert.ok(ack.ok,JSON.stringify(ack));await request(guests[i],{type:'ready',ready:true});}
  assert.equal((await host.sync())?.players.length,6);
  assert.equal((await request(guests[5],{type:'join',code,name:'Extra',avatar:0})).ok,false);
  assert.equal((await request(guests[0],{type:'start'})).ok,false);
  assert.ok((await request(host,{type:'start'})).ok);const choosing=(await host.sync())!;
  assert.equal((await guests[0].sync())?.choices,undefined);
  await request(host,{type:'choose',index:0,turnId:choosing.turnId});const drawing=(await host.sync())!;assert.ok(drawing.word);assert.equal((await guests[0].sync())?.word,undefined);
  // >32 KiB full canvas, fragmented and reassembled over byte frames.
  const points=Array.from({length:1500},(_,i)=>({x:(i%100)/100,y:(i%80)/80}));
  for(let i=0;i<3;i++)await request(host,{type:'stroke',stroke:{id:`stroke-${i}`,color:'#20242D',width:7,points},turnId:drawing.turnId});
  assert.equal((await guests[0].sync())?.strokes.length,3);
  await request(guests[0],{type:'message',text:'hello drawer',mode:'chat',turnId:drawing.turnId});await wait();assert.equal(received.at(-1)?.messages.at(-1)?.text,'hello drawer');
  const id=randomUUID();const guess:Command={type:'message',text:drawing.word!,mode:'guess',turnId:drawing.turnId};await request(guests[1],guess,id);const score=(await guests[1].sync())!.players.find(p=>p.guessed)!.score;await request(guests[1],guess,id);assert.equal((await guests[1].sync())!.players.find(p=>p.guessed)!.score,score);
  const before=(await guests[2].sync())!;await radios[3].disconnectEndpoint(radios[0].id);await wait(1000);const resumed=(await guests[2].sync())!;assert.equal(resumed.me,before.me);assert.equal(resumed.strokes.length,3);
  await request(host,{type:'kick',playerId:resumed.me});await wait();assert.equal((await host.sync())?.players.length,5);
  await request(host,{type:'leave'});await wait();assert.equal(await guests[0].sync(),null);
 }finally{transports.forEach(t=>t.disconnect());await wait();Radio.radios.clear();}
});
test('Nearby rejected pairing and permission failures do not create seats',async()=>{
 Radio.radios.clear();const hr=new Radio('host'),gr=new Radio('guest');gr.reject=true;const h=new NearbyTransport(hr,webRandom),g=new NearbyTransport(gr,webRandom);
 try{await h.connect();await g.connect();const a=await request(h,{type:'create',name:'H',avatar:0,settings:localSettings});if(!a.ok||!a.session)throw Error();assert.equal((await request(g,{type:'join',name:'G',avatar:1,code:a.session.code})).ok,false);assert.equal((await h.sync())?.players.length,1);gr.prepare=async()=>{throw Error('Permission denied');};await assert.rejects(request(g,{type:'join',name:'G',avatar:1,code:a.session.code}),/Permission denied/);}finally{h.disconnect();g.disconnect();}
});
test('framing handles out-of-order chunks, duplicates, Unicode, gaps and malformed input',async()=>{
 const frames:string[]=[];const values:unknown[]=[];const errors:string[]=[];const a=new FramedPeer(async f=>{frames.push(f);},()=>{},s=>errors.push(s));const b=new FramedPeer(async()=>{},v=>values.push(v),s=>errors.push(s));
 const data={text:'🖌️'.repeat(15000)};await a.send(data);await a.send({next:1});for(const f of [...frames].reverse()){b.accept(f,100);b.accept(f,100);}assert.deepEqual(values,[data,{next:1}]);assert.equal(errors.length,0);
 const c=new FramedPeer(async()=>{},()=>{},s=>errors.push(s));c.accept(frames[1],100);c.tick(16000);assert.equal(errors.length,1);
 const d=new FramedPeer(async()=>{},()=>{},s=>errors.push(s));d.accept('{bad');assert.equal(errors.length,2);
 a.close();b.close();c.close();d.close();
});
test('phone authority rejects remote creation, enforces six players, freezes host deadlines',()=>{
 const r=new HostRuntime({owner:'host',maxPlayers:6});r.connect('host',()=>{});r.connect('guest',()=>{});const cmd=(id:string,command:Command,now=1000)=>r.request(id,{id:randomUUID(),command},now);
 assert.equal(cmd('guest',{type:'create',name:'X',avatar:0,settings:localSettings}).ok,false);
 assert.equal(cmd('host',{type:'create',name:'H',avatar:0,settings:defaults}).ok,false);
 const a=cmd('host',{type:'create',name:'H',avatar:0,settings:localSettings});if(!a.ok||!a.session)throw Error();cmd('guest',{type:'join',name:'G',avatar:1,code:a.session.code});cmd('guest',{type:'ready',ready:true});cmd('host',{type:'start'});const before=r.sync('host',1000)!;
 r.suspend(2000);r.tick(100000);assert.equal(cmd('guest',{type:'ready',ready:true},2001).ok,false);r.resume(12000);assert.equal(r.sync('host',12000)!.deadline,before.deadline+10000);assert.equal(r.sync('host')!.phase,'choosing');r.close();
});
test('SocketTransport preserves online commands and snapshots through GameTransport',async()=>{
 const server=createGameServer();await new Promise<void>(r=>server.http.listen(0,'127.0.0.1',r));const port=(server.http.address() as {port:number}).port;const t=new SocketTransport(`http://127.0.0.1:${port}`);
 try{const connected=new Promise<void>(resolve=>t.subscribe(e=>{if(e.type==='connection'&&e.connected)resolve();}));await t.connect();await connected;assert.ok((await request(t,{type:'create',name:'Online',avatar:0,settings:defaults})).ok);assert.equal((await t.sync())?.players[0].name,'Online');}finally{t.disconnect();await server.close();}
});
