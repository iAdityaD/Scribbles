import { io, type Socket } from 'socket.io-client';
import type { Ack, Request, Snapshot, ServerEvents, ClientEvents } from '../protocol/index.ts';
import { ObservableTransport, type GameTransport } from './transport.ts';
/** Keeps the existing wire protocol and automatic Socket.IO reconnection. */
export class SocketTransport extends ObservableTransport implements GameTransport {
 readonly kind='socket' as const;
 private socket:Socket<ServerEvents,ClientEvents>|null=null;
 constructor(private endpoint:string){super();}
 async connect(){
  if(this.socket){this.socket.connect();return;}
  const s:Socket<ServerEvents,ClientEvents>=io(this.endpoint,{transports:['websocket'],reconnection:true,timeout:7000});this.socket=s;
  s.on('connect',()=>this.emit({type:'connection',connected:true}));
  s.on('disconnect',()=>this.emit({type:'connection',connected:false,message:'Reconnecting… your seat is held for 60 seconds.'}));
  s.on('connect_error',()=>this.emit({type:'connection',connected:false,message:'Online server unavailable. Check Settings.'}));
  s.on('state',state=>this.emit({type:'state',state}));s.on('stroke',event=>this.emit({type:'stroke',event}));s.on('removed',reason=>this.emit({type:'removed',reason}));
 }
 disconnect(){this.socket?.removeAllListeners();this.socket?.disconnect();this.socket=null;}
 async request(request:Request):Promise<Ack>{
  const s=this.socket;if(!s?.connected)throw Error('Waiting for the online connection.');
  const connectionId=s.id;
  try{return await s.timeout(6000).emitWithAck('command',request);}
  catch{
   // The runtime caches acknowledgements per connection. Retrying the same
   // request ID on this socket cannot create another room or double a score.
   if(s.connected&&s.id===connectionId)return s.timeout(6000).emitWithAck('command',request);
   throw Error('Connection interrupted. Reconnect to check the latest room state.');
  }
 }
 async sync():Promise<Snapshot|null>{const s=this.socket;if(!s?.connected)return null;return new Promise((resolve,reject)=>s.timeout(6000).emit('sync',(e:Error|null,state:Snapshot|null)=>e?reject(e):resolve(state)));}
 setActive(active:boolean){if(active&&!this.socket?.connected)this.socket?.connect();}
}

/** A new install can verify the actual game protocol without joining a room. */
export async function verifyGameServer(endpoint:string):Promise<void> {
 const probe:Socket<ServerEvents,ClientEvents>=io(endpoint,{autoConnect:false,forceNew:true,transports:['websocket'],timeout:8000});
 try {
  await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('The server did not respond. Check the address or try again after it wakes up.')),75000);
   probe.on('connect',()=>{
    probe.timeout(6000).emit('sync',(error:Error|null,state:Snapshot|null)=>{
     clearTimeout(timeout);
     if(error||state!==null)reject(Error('This address did not respond as a Scribbles game server.'));
     else resolve();
    });
   });
   probe.connect();
  });
 } finally { probe.removeAllListeners();probe.disconnect(); }
}
