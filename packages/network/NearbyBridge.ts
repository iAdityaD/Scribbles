/** Native boundary, also implemented by the in-memory radio used in tests. */
export type RadioEvent=
 |{type:'found';endpointId:string;name:string}|{type:'lost';endpointId:string}
 |{type:'connected';endpointId:string}|{type:'disconnected';endpointId:string}
 |{type:'payload';endpointId:string;data:string}|{type:'error';endpointId?:string;message:string};
export interface NearbyBridge {
 prepare():Promise<void>;
 subscribe(listener:(event:RadioEvent)=>void):()=>void;
 advertise(name:string):Promise<void>;
 discover():Promise<void>;
 stopDiscovery():Promise<void>;
 requestConnection(endpointId:string,name:string):Promise<void>;
 send(endpointId:string,data:string):Promise<void>;
 disconnectEndpoint(endpointId:string):Promise<void>;
 stop():Promise<void>;
}
