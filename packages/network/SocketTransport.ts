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
  return new Promise((resolve,reject)=>s.timeout(6000).emit('command',request,(e:Error|null,ack:Ack)=>e?reject(Error('No response yet. Reconnect to check the latest room state.')):resolve(ack)));
 }
 async sync():Promise<Snapshot|null>{const s=this.socket;if(!s?.connected)return null;return new Promise((resolve,reject)=>s.timeout(6000).emit('sync',(e:Error|null,state:Snapshot|null)=>e?reject(e):resolve(state)));}
 setActive(active:boolean){if(active&&!this.socket?.connected)this.socket?.connect();}
}
