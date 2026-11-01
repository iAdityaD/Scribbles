import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { commandSchema, type ClientEvents, type ServerEvents, type Ack, type Session } from '../../../packages/protocol/index.ts';
import { GameStore, GameError, type Room } from '../../../packages/game-core/engine.ts';
const requestSchema=z.object({id:z.string().min(8).max(100),command:commandSchema});
type Data={session?:Session;cache:Map<string,Ack>;window:number;count:number};
type ClientSocket=Socket<ClientEvents,ServerEvents,{},Data>;
export function createGameServer(){
 const store=new GameStore();
 const http=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/health'){res.end(JSON.stringify({ok:true,rooms:store.rooms.size}));}else{res.statusCode=404;res.end('{"error":"Not found"}');}});
 const io=new Server<ClientEvents,ServerEvents,{},Data>(http,{cors:{origin:(process.env.ALLOWED_ORIGINS??'http://localhost:8081').split(',')},maxHttpBufferSize:100000,pingInterval:10000,pingTimeout:15000});
 function publish(room:Room){for(const s of io.sockets.sockets.values())if(s.data.session?.code===room.code&&room.members.some(m=>m.id===s.data.session?.playerId))s.emit('state',room.snapshot(s.data.session.playerId,Date.now()));}
 function unseat(socket:ClientSocket,reason:string){const session=socket.data.session;if(!session)return;socket.leave(session.code);socket.data.session=undefined;socket.emit('removed',reason);}
 io.on('connection',socket=>{
  socket.data.cache=new Map();socket.data.window=Date.now();socket.data.count=0;
  socket.on('sync',ack=>{if(typeof ack!=='function')return;const s=socket.data.session;try{ack(s?store.get(s.code).snapshot(s.playerId,Date.now()):null);}catch{ack(null);}});
  socket.on('command',(raw,ack)=>{
   if(typeof ack!=='function')return;
   const now=Date.now();if(now-socket.data.window>1000){socket.data.window=now;socket.data.count=0;}
   if(++socket.data.count>60){ack({ok:false,error:'Too many requests. Please slow down.'});return;}
   const parsed=requestSchema.safeParse(raw);if(!parsed.success){ack({ok:false,error:parsed.error.issues[0]?.message??'Invalid request.'});return;}
   const {id,command:c}=parsed.data;const cached=socket.data.cache.get(id);if(cached){ack(cached);return;}
   let result:Ack;
   try{
    let session=socket.data.session;let room:Room;
    if(c.type==='create'||c.type==='join'||c.type==='resume'){
     if(session)throw new GameError('Leave your current room first.');
     if(c.type==='create'){const created=store.create(c.settings,c.name,c.avatar,now);room=created.room;session=created.session;}
     else if(c.type==='join'){room=store.get(c.code);session=room.add(c.name,c.avatar,now);}
     else {room=store.get(c.code);const playerId=room.resume(c.token,now);session={code:c.code,token:c.token,playerId};for(const other of io.sockets.sockets.values())if(other.id!==socket.id&&other.data.session?.playerId===playerId)unseat(other,'This seat was opened on another device.');}
     socket.data.session=session;socket.join(room.code);room.tick(now);result={ok:true,session};publish(room);
    }else{
     if(!session)throw new GameError('Join a room first.');room=store.get(session.code);room.tick(now);
     if(c.type==='leave'){room.remove(session.playerId,now);socket.data.session=undefined;socket.leave(room.code);}
     else if(c.type==='kick'){
      room.requireHost(session.playerId);if(c.playerId===session.playerId)throw new GameError('Use Leave Room to leave.');
      room.remove(c.playerId,now);for(const other of io.sockets.sockets.values())if(other.data.session?.playerId===c.playerId)unseat(other,'The host removed you from the room.');
     }else room.act(session.playerId,c,now);
     result={ok:true};
     if(c.type==='stroke')io.to(room.code).emit('stroke',{turnId:room.turnId,revision:room.revision,stroke:c.stroke});else publish(room);
    }
   }catch(error){result={ok:false,error:error instanceof GameError?error.message:'Unable to process that action.'};if(!(error instanceof GameError))console.error(error);}
   socket.data.cache.set(id,result);if(socket.data.cache.size>256)socket.data.cache.delete(socket.data.cache.keys().next().value!);ack(result);
  });
  socket.on('disconnect',()=>{const s=socket.data.session;if(!s)return;try{const r=store.get(s.code);r.disconnect(s.playerId,Date.now());r.tick(Date.now());publish(r);}catch{}});
 });
 let last=new Map<string,string>();
 const timer=setInterval(()=>{
  store.sweep(Date.now());
  for(const r of store.rooms.values()){
   const signature=JSON.stringify([r.phase,r.turnId,r.deadline,r.hint(Date.now()),r.members.map(p=>[p.id,p.connected]),r.hostId]);
   if(last.get(r.code)!==signature){publish(r);last.set(r.code,signature);}
  }
  for(const code of last.keys())if(!store.rooms.has(code))last.delete(code);
 },250);timer.unref();
 return {http,io,store,close:async()=>{clearInterval(timer);await new Promise<void>(resolve=>io.close(()=>resolve()));}};
}
