import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ClientEvents, ServerEvents } from '../../../packages/protocol/index.ts';
import { HostRuntime } from '../../../packages/game-core/runtime.ts';
const CREATE_WINDOW_MS=10*60*1000;
/** Rooms one client address may create per 10 minutes, so one visitor cannot fill the server's room cap. */
const createLimit=()=>Math.max(1,Number(process.env.ROOM_CREATE_LIMIT??6));
/** Behind one trusted proxy (Render, Fly, nginx) the real client is the last X-Forwarded-For entry; never trust it otherwise. */
function clientAddress(socket:Socket){
 if(process.env.TRUST_PROXY==='1'){const hops=String(socket.handshake.headers['x-forwarded-for']??'').split(',').map(s=>s.trim()).filter(Boolean);if(hops.length)return hops[hops.length-1];}
 return socket.handshake.address||'unknown';
}
export function createGameServer(){
 const runtime=new HostRuntime();const store=runtime.store;
 const created=new Map<string,{at:number;code:string}[]>();
 const http=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/health'){res.end(JSON.stringify({ok:true,rooms:store.rooms.size}));}else{res.statusCode=404;res.end('{"error":"Not found"}');}});
 const io=new Server<ClientEvents,ServerEvents>(http,{cors:{origin:(process.env.ALLOWED_ORIGINS??'http://localhost:8081').split(',')},maxHttpBufferSize:100000,pingInterval:10000,pingTimeout:15000});
 io.on('connection',socket=>{
  const address=clientAddress(socket);
  runtime.connect(socket.id,event=>{if(event.type==='state')socket.emit('state',event.state);else if(event.type==='stroke')socket.emit('stroke',event.event);else socket.emit('removed',event.reason);});
  socket.on('sync',ack=>{if(typeof ack==='function')ack(runtime.sync(socket.id));});
  socket.on('command',(raw,ack)=>{
   if(typeof ack!=='function')return;
   if((raw as {command?:{type?:unknown}}|null)?.command?.type!=='create'){ack(runtime.request(socket.id,raw));return;}
   const now=Date.now();const recent=(created.get(address)??[]).filter(r=>now-r.at<CREATE_WINDOW_MS);
   if(recent.length>=createLimit()){created.set(address,recent);ack({ok:false,error:'You have opened a lot of rooms. Try again in a few minutes.'});return;}
   const result=runtime.request(socket.id,raw,now);
   // A retried request returns the cached result; count each room only once.
   if(result.ok&&result.session&&!recent.some(r=>r.code===result.session!.code))recent.push({at:now,code:result.session.code});
   created.set(address,recent);ack(result);
  });
  socket.on('disconnect',()=>runtime.disconnect(socket.id));
 });
 const timer=setInterval(()=>runtime.tick(),250);timer.unref();
 const prune=setInterval(()=>{const now=Date.now();for(const [k,v] of created){const keep=v.filter(r=>now-r.at<CREATE_WINDOW_MS);if(keep.length)created.set(k,keep);else created.delete(k);}},60000);prune.unref();
 return {http,io,store,close:async()=>{clearInterval(timer);clearInterval(prune);await new Promise<void>(resolve=>io.close(()=>resolve()));}};
}
