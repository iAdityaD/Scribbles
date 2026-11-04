import { z } from 'zod';
import type { NearbyBridge,RadioEvent } from '../../../../packages/network/NearbyBridge';
import { packTicket,readTicket,type Ticket } from './ticket';

const message=z.discriminatedUnion('topic',[
  z.object({topic:z.literal('ready')}),
  z.object({topic:z.literal('roster'),seats:z.array(z.tuple([z.string().uuid(),z.string().max(64)])).max(6)}),
  z.object({topic:z.literal('pen'),id:z.string().uuid(),from:z.string().uuid(),turn:z.string().max(64),x:z.number().min(0).max(1),y:z.number().min(0).max(1)}),
  z.object({topic:z.literal('game'),data:z.string().max(25000)}),
  z.object({topic:z.literal('dial'),peer:z.string().uuid()}),
  z.object({topic:z.literal('signal'),peer:z.string().uuid(),type:z.enum(['offer','answer']),sdp:z.string().max(32000)}),
  z.object({topic:z.literal('typing'),id:z.string().uuid()}),
]);
type Packet=z.infer<typeof message>;
type Edge={pc:RTCPeerConnection;channel?:RTCDataChannel;hub:boolean;open:boolean;ready?:boolean;timer?:ReturnType<typeof setTimeout>};
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export type PenCursor={player:string;turn:string;x:number;y:number};

/** Bootstrap manually; existing hub links introduce all remaining peer pairs. */
export class MeshBridge implements NearbyBridge {
  private self:string;
  private host='';
  private room='';
  private searching=false;
  private edges=new Map<string,Edge>();
  private offers=new Map<string,Ticket>();
  private listeners=new Set<(event:RadioEvent)=>void>();
  private seats=new Map<string,string>();
  private penListeners=new Set<(cursor:PenCursor)=>void>();
  private typingListeners=new Set<()=>void>();
  private seen=new Set<string>();
  private dialed=new Set<string>();
  private iceServers:RTCIceServer[]=[{urls:'stun:stun.l.google.com:19302'}];
  constructor(private create:(servers:RTCIceServer[])=>RTCPeerConnection,private uuid:()=>string){this.self=uuid();}
  subscribe(fn:(event:RadioEvent)=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
  onTyping(fn:()=>void){this.typingListeners.add(fn);return()=>{this.typingListeners.delete(fn);};}
  onPen(fn:(cursor:PenCursor)=>void){this.penListeners.add(fn);return()=>{this.penListeners.delete(fn);};}
  bindSeat(endpoint:string,playerId:string){
    if(!this.owner)return;
    const id=endpoint==='local-owner'?this.self:endpoint;
    if(this.seats.get(id)===playerId)return;
    this.seats.set(id,playerId);
    const roster:Packet={topic:'roster',seats:[...this.seats]};
    for(const [peer,e] of this.edges)if(e.open)this.write(peer,roster);
  }
  get code(){return this.room;}
  get connectedPeerCount(){return [...this.edges.values()].filter(edge=>edge.open).length;}
  private emit(event:RadioEvent){for(const fn of this.listeners)fn(event);}
  private get owner(){return this.host===this.self;}
  async prepare(){}
  configureRelay(url:string,username:string,credential:string,useStun=true){
    if(url&&!/^turns?:[^\s/@]+(?::\d+)?(?:\?transport=(?:tcp|udp))?$/i.test(url))throw Error('Enter a turn: or turns: relay address.');
    this.iceServers=useStun?[{urls:'stun:stun.l.google.com:19302'}]:[];
    if(url)this.iceServers.push({urls:url,username,credential});
  }
  async advertise(name:string){await this.stop();this.room=name.replace(/^Scribbles:/,'');this.host=this.self;}
  async discover(){this.searching=true;this.announceHost();}
  async stopDiscovery(){this.searching=false;}
  private announceHost(){
    if(this.searching&&!this.owner&&this.edges.get(this.host)?.ready)this.emit({type:'found',endpointId:this.host,name:'Scribbles:'+this.room});
  }
  async requestConnection(id:string){if(id!==this.host||!this.edges.get(id)?.open)throw Error('Host connection is not ready.');this.emit({type:'connected',endpointId:id});}
  private drop(id:string,edge:Edge){
    if(this.edges.get(id)!==edge)return;
    this.edges.delete(id);this.offers.delete(id);this.dialed.delete(id);if(this.owner)this.seats.delete(id);clearTimeout(edge.timer);
    edge.channel?.close();edge.pc.close();
    if(edge.hub&&edge.open)this.emit({type:'disconnected',endpointId:id});
  }
  async disconnectEndpoint(id:string){const edge=this.edges.get(id);if(edge)this.drop(id,edge);}
  async stop(){
    this.searching=false;this.host='';this.room='';this.offers.clear();this.seen.clear();this.dialed.clear();this.seats.clear();
    for(const [id,e] of [...this.edges])this.drop(id,e);
  }
  private edge(id:string,hub:boolean){
    if(id===this.self||this.edges.has(id)||this.edges.size>=5)throw Error('Peer already connected or the six-player room is full.');
    const pc=this.create(this.iceServers);
    const e:Edge={pc,hub,open:false};this.edges.set(id,e);
    e.timer=setTimeout(()=>{if(!e.open)this.drop(id,e);},hub?10*60000:60000);
    pc.addEventListener('connectionstatechange',()=>{
      if(pc.connectionState==='failed'){
        if(hub)this.emit({type:'error',message:'Direct connection failed. Try another network or configure a TURN relay and create a new invite.'});
        this.drop(id,e);
      }
    });
    pc.addEventListener('datachannel',event=>this.attach(id,e,event.channel));
    return e;
  }
  private attach(id:string,e:Edge,ch:RTCDataChannel){
    if(ch.label!=='scribbles-v1'||e.channel){ch.close();return;}e.channel=ch;
    const opened=()=>{
      if(e.open||this.edges.get(id)!==e)return;e.open=true;clearTimeout(e.timer);
      if(e.hub&&this.owner){
        this.emit({type:'connected',endpointId:id});
        this.write(id,{topic:'ready'});this.write(id,{topic:'roster',seats:[...this.seats]});
        for(const [peer,link] of this.edges)if(peer!==id&&link.open)this.write(peer,{topic:'dial',peer:id});
      }else if(e.hub)this.announceHost();
    };
    ch.addEventListener('open',opened);if(ch.readyState==='open')opened();
    ch.addEventListener('close',()=>this.drop(id,e));
    ch.addEventListener('message',ev=>{
      if(typeof ev.data!=='string'||ev.data.length>64000)return;
      let packet:Packet;try{packet=message.parse(JSON.parse(ev.data));}catch{return;}
      void this.consume(id,e,packet).catch(()=>{
        // An optional spoke-to-spoke link may fail on carrier NAT. The hub link remains usable.
      });
    });
  }
  private write(id:string,p:Packet){
    const ch=this.edges.get(id)?.channel;if(ch?.readyState!=='open')return false;
    try{ch.send(JSON.stringify(p));return true;}catch{return false;}
  }
  async send(id:string,frame:string){
    const edge=this.edges.get(id);
    if(!edge?.hub)throw Error('No game subscription on this edge.');
    const until=Date.now()+8000;
    while((edge.channel?.bufferedAmount??0)>512000&&Date.now()<until)await pause(20);
    if(Date.now()>=until||!this.write(id,{topic:'game',data:frame}))throw Error('Peer link interrupted.');
  }
  private remember(id:string){if(this.seen.has(id))return false;this.seen.add(id);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value!);return true;}
  publishTyping(){
    const p:Packet={topic:'typing',id:this.uuid()};this.remember(p.id);
    for(const [id,e] of this.edges)if(e.open)this.write(id,p);
  }
  publishPen(turn:string,x:number,y:number){
    const p:Packet={topic:'pen',id:this.uuid(),from:this.self,turn,x,y};this.remember(p.id);
    for(const [id,e] of this.edges)if(e.open)this.write(id,p);
  }
  private async consume(id:string,e:Edge,p:Packet){
    if(p.topic==='ready'){
      if(!this.owner&&id===this.host){e.ready=true;this.announceHost();}return;
    }
    if(p.topic==='roster'){
      if(!this.owner&&id===this.host)this.seats=new Map(p.seats);return;
    }
    if(p.topic==='pen'){
      if((id!==this.host&&p.from!==id)||!this.remember(p.id))return;
      const player=this.seats.get(p.from);
      if(!player)return;
      for(const fn of this.penListeners)fn({player,turn:p.turn,x:p.x,y:p.y});
      if(this.owner)for(const [peer,link] of this.edges)if(peer!==id&&link.open)this.write(peer,p);
      return;
    }
    if(p.topic==='game'){
      if(e.hub)this.emit({type:'payload',endpointId:id,data:p.data});
      return;
    }
    if(p.topic==='typing'){
      if(!this.remember(p.id))return;
      for(const fn of this.typingListeners)fn();
      if(this.owner)for(const [peer,link] of this.edges)if(peer!==id&&link.open)this.write(peer,p);
      return;
    }
    if(!e.hub)return; // Only the authenticated hub may introduce peers.
    if(this.owner){
      if(p.topic==='signal'&&p.peer!==id&&this.edges.get(p.peer)?.open)this.write(p.peer,{...p,peer:id});
      return;
    }
    if(id!==this.host||p.peer===this.host||p.peer===this.self)return;
    if(p.topic==='dial'){
      if(this.dialed.has(p.peer)||this.edges.has(p.peer))return;
      this.dialed.add(p.peer);const edge=this.edge(p.peer,false);
      try{this.write(this.host,{topic:'signal',peer:p.peer,type:'offer',sdp:await this.description(edge,'offer')});}
      catch(err){this.drop(p.peer,edge);throw err;}
    }else if(p.type==='offer'){
      const edge=this.edge(p.peer,false);
      try{await edge.pc.setRemoteDescription({type:'offer',sdp:p.sdp});
        this.write(this.host,{topic:'signal',peer:p.peer,type:'answer',sdp:await this.description(edge,'answer')});}
      catch(err){this.drop(p.peer,edge);throw err;}
    }else{
      const edge=this.edges.get(p.peer);if(edge&&!edge.hub)await edge.pc.setRemoteDescription({type:'answer',sdp:p.sdp});
    }
  }
  private async description(e:Edge,type:'offer'|'answer'){
    if(type==='offer')this.attach([...this.edges].find(([,v])=>v===e)![0],e,e.pc.createDataChannel('scribbles-v1',{ordered:true}));
    await e.pc.setLocalDescription(type==='offer'?await e.pc.createOffer():await e.pc.createAnswer());
    const until=Date.now()+12000;
    while(e.pc.iceGatheringState!=='complete'&&e.pc.connectionState!=='closed'&&Date.now()<until)await pause(100);
    const sdp=e.pc.localDescription?.sdp;
    if(!sdp||!sdp.includes('a=candidate:'))throw Error('No network route was found. Check connectivity and try again.');
    return sdp;
  }
  async invite(){
    if(!this.owner||!this.room)throw Error('Create a room first.');
    // Only one unclaimed manual offer is necessary; generating another replaces it.
    for(const id of this.offers.keys())await this.disconnectEndpoint(id);
    const to=this.uuid();const edge=this.edge(to,true);
    try{
      const t:Ticket={version:1,from:this.self,to,room:this.room,nonce:this.uuid(),type:'offer',expires:Date.now()+600000,sdp:await this.description(edge,'offer')};
      this.offers.set(to,t);return packTicket(t);
    }catch(err){this.drop(to,edge);throw err;}
  }
  async answer(text:string){
    const t=readTicket(text,'offer');
    if(this.owner||(this.host&&(t.from!==this.host||t.room!==this.room)))throw Error('Leave your existing room before accepting another host.');
    for(const [id,e] of [...this.edges])this.drop(id,e);this.host=t.from;this.room=t.room;this.self=t.to;
    const edge=this.edge(t.from,true);
    try{await edge.pc.setRemoteDescription({type:'offer',sdp:t.sdp});
      return packTicket({...t,type:'answer',from:this.self,to:t.from,sdp:await this.description(edge,'answer')});
    }catch(err){this.drop(t.from,edge);throw err;}
  }
  async finish(text:string){
    const t=readTicket(text,'answer'),offer=this.offers.get(t.from),edge=this.edges.get(t.from);
    if(!this.owner||!edge||!offer||offer.nonce!==t.nonce||offer.room!==t.room||t.to!==this.self)throw Error('That reply does not match your current invite.');
    await edge.pc.setRemoteDescription({type:'answer',sdp:t.sdp});this.offers.delete(t.from);
  }
}
