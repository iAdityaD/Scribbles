// Three independent browser contexts, real WebRTC data channels, no signaling service.
const { chromium }=require('playwright');
const { build }=require('esbuild');
const http=require('node:http');
const assert=require('node:assert/strict');
const path=require('node:path');
async function main(){
 const root=path.resolve(__dirname,'..');
 const bundle=await build({bundle:true,platform:'browser',write:false,stdin:{resolveDir:root,contents:`
 import {MeshBridge} from './apps/mobile/src/mesh/MeshBridge';
 import {NearbyTransport} from './packages/network/NearbyTransport';
 import {defaults} from './packages/protocol';
 window.pcs=[];window.typingCount=0;
 const bridge=new MeshBridge(()=>{
   const pc=new RTCPeerConnection({iceServers:[]});window.pcs.push(pc);return pc;
 },()=>crypto.randomUUID());
 bridge.onTyping(()=>window.typingCount++);
 const t=new NearbyTransport(bridge,{bytes:n=>crypto.getRandomValues(new Uint8Array(n))},'mesh');
 window.bridge=bridge;window.t=t;window.cmd=c=>t.request({id:crypto.randomUUID(),command:c});
 window.makeRoom=()=>window.cmd({type:'create',name:'Host',avatar:0,settings:{...defaults,maxPlayers:6}});
 `},format:'iife'});
 const httpServer=http.createServer((_,res)=>res.end('<!doctype html><title>Peer test</title>'));
 await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));
 const args=process.env.PLAYWRIGHT_SERVERLESS_MODULE?require(process.env.PLAYWRIGHT_SERVERLESS_MODULE).default.args:['--no-sandbox'];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,headless:true,args:[...args,'--allow-loopback-in-peer-connection','--disable-features=WebRtcHideLocalIpsWithMdns']});
 try{
  const pages=[];for(let i=0;i<3;i++){
   const context=await browser.newContext();const p=await context.newPage();pages.push(p);
   await p.goto('http://127.0.0.1:'+httpServer.address().port);
   await p.addScriptTag({content:bundle.outputFiles[0].text});await p.evaluate(()=>t.connect());
  }
  const [host,a,b]=pages;const created=await host.evaluate(()=>makeRoom());assert.ok(created.ok);const code=created.session.code;
  for(const [index,guest] of [a,b].entries()){
   const offer=await host.evaluate(()=>bridge.invite());
   const reply=await guest.evaluate(text=>bridge.answer(text),offer);
   await host.evaluate(text=>bridge.finish(text),reply);
   const joined=await guest.evaluate(({code,index})=>cmd({type:'join',code,name:'Guest '+index,avatar:index+1}),{code,index});
   assert.ok(joined.ok,JSON.stringify(joined));
   assert.ok((await guest.evaluate(()=>cmd({type:'ready',ready:true}))).ok);
  }
  for(const page of pages)await page.waitForFunction(()=>pcs.filter(pc=>pc.connectionState==='connected').length===2);
  const command=(p,c)=>p.evaluate(x=>cmd(x),c);
  assert.equal((await command(b,{type:'start'})).ok,false);
  assert.ok((await command(host,{type:'start'})).ok);
  const choosing=await host.evaluate(()=>t.sync());assert.equal((await a.evaluate(()=>t.sync())).choices,undefined);
  await command(host,{type:'choose',turnId:choosing.turnId,index:0});const draw=await host.evaluate(()=>t.sync());
  assert.equal((await b.evaluate(()=>t.sync())).word,undefined);
  await command(host,{type:'stroke',turnId:draw.turnId,stroke:{id:'pencil',width:5,color:'#20242D',points:[{x:.1,y:.1},{x:.2,y:.2}]}});
  assert.equal((await a.evaluate(()=>t.sync())).strokes.length,1);
  await command(a,{type:'message',mode:'chat',text:'Can the drawer see me?',turnId:draw.turnId});
  assert.equal((await host.evaluate(()=>t.sync())).messages.at(-1).text,'Can the drawer see me?');
  // Suppress the host route briefly to prove that publication travels directly between guests.
  await a.evaluate(()=>{const route=pcs[0];const original=RTCDataChannel.prototype.send;
   RTCDataChannel.prototype.send=function(data){if(JSON.parse(data).topic==='typing'&&this===bridge.edges.get(bridge.host).channel)return;return original.call(this,data);};
   bridge.publishTyping();RTCDataChannel.prototype.send=original;});
  await b.waitForFunction(()=>typingCount===1);
  // Remove the spoke-to-spoke link. The host can still relay notices and score a guess.
  await b.evaluate(()=>pcs[1].close());
  await a.evaluate(()=>bridge.publishTyping());await b.waitForFunction(()=>typingCount===2);
  assert.ok((await command(b,{type:'message',mode:'guess',text:draw.word,turnId:draw.turnId})).ok);
  assert.ok((await b.evaluate(()=>t.sync())).players.some(p=>p.score>0));
  await command(host,{type:'leave'});await b.waitForFunction(()=>bridge.code==='');
  console.log('PASS: 3 actual WebRTC peers, manual bootstrap, automatic full mesh, private views, authority, strokes, drawer chat, direct publish/subscribe, hub fallback, scoring, host closure.');
 }finally{await browser.close();await new Promise(r=>httpServer.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
