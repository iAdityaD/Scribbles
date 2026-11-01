import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientEvents, ServerEvents } from '../../../packages/protocol/index.ts';
import { HostRuntime } from '../../../packages/game-core/runtime.ts';
export function createGameServer(){
 const runtime=new HostRuntime();const store=runtime.store;
 const http=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/health'){res.end(JSON.stringify({ok:true,rooms:store.rooms.size}));}else{res.statusCode=404;res.end('{"error":"Not found"}');}});
 const io=new Server<ClientEvents,ServerEvents>(http,{cors:{origin:(process.env.ALLOWED_ORIGINS??'http://localhost:8081').split(',')},maxHttpBufferSize:100000,pingInterval:10000,pingTimeout:15000});
 io.on('connection',socket=>{
  runtime.connect(socket.id,event=>{if(event.type==='state')socket.emit('state',event.state);else if(event.type==='stroke')socket.emit('stroke',event.event);else socket.emit('removed',event.reason);});
  socket.on('sync',ack=>{if(typeof ack==='function')ack(runtime.sync(socket.id));});
  socket.on('command',(raw,ack)=>{if(typeof ack==='function')ack(runtime.request(socket.id,raw));});
  socket.on('disconnect',()=>runtime.disconnect(socket.id));
 });
 const timer=setInterval(()=>runtime.tick(),250);timer.unref();
 return {http,io,store,close:async()=>{clearInterval(timer);await new Promise<void>(resolve=>io.close(()=>resolve()));}};
}
