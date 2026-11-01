import type { Ack, Request, Snapshot } from '../protocol/index.ts';
import type { GameEvent } from '../game-core/runtime.ts';
export type TransportEvent=GameEvent|{type:'connection';connected:boolean;message?:string}|{type:'error';message:string};
export interface GameTransport {
 readonly kind:'socket'|'nearby';
 subscribe(listener:(event:TransportEvent)=>void):()=>void;
 connect():Promise<void>;
 disconnect():void;
 request(request:Request):Promise<Ack>;
 sync():Promise<Snapshot|null>;
 setActive(active:boolean):void;
}
export abstract class ObservableTransport {
 private listeners=new Set<(event:TransportEvent)=>void>();
 subscribe(listener:(event:TransportEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 protected emit(event:TransportEvent){for(const listener of this.listeners)listener(event);}
}
