import { z } from 'zod';
const CHUNK=4000, MAX_MESSAGE=1_500_000, MAX_BUFFER=3_000_000;
const schema=z.object({v:z.literal(1),seq:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),index:z.number().int().min(0),total:z.number().int().min(1).max(375),data:z.string().max(CHUNK)});
/** Conservative <32 KiB UTF-8 frames, bounded reassembly, ordered delivery. */
export class FramedPeer {
 private outgoing=0;private expected=0;private size=0;private queued=0;
 private chain=Promise.resolve();private closed=false;
 private incoming=new Map<number,{total:number;parts:Map<number,string>;at:number}>();
 constructor(private write:(frame:string)=>Promise<void>,private receive:(value:unknown)=>void,private fail:(reason:string)=>void){}
 send(value:unknown){
  if(this.closed)return Promise.reject(Error('Connection closed.'));
  const text=JSON.stringify(value);if(text.length>MAX_MESSAGE||this.queued+text.length>MAX_BUFFER){this.abort('Connection is too slow. Reconnect to restore the canvas.');return Promise.reject(Error('Payload limit'));}
  const seq=this.outgoing++;this.queued+=text.length;
  const task=this.chain.then(async()=>{for(let i=0;i<text.length;i+=CHUNK){if(this.closed)throw Error('Connection closed.');await this.write(JSON.stringify({v:1,seq,index:i/CHUNK,total:Math.ceil(text.length/CHUNK),data:text.slice(i,i+CHUNK)}));}});
  this.chain=task.catch(()=>this.abort('Nearby data transfer failed.')).finally(()=>{this.queued-=text.length;});return task;
 }
 accept(raw:string,now=Date.now()){
  if(this.closed)return;
  try{
   if(raw.length>25000)throw Error();const f=schema.parse(JSON.parse(raw));if(f.index>=f.total)throw Error();
   if(f.seq<this.expected)return;if(f.seq>this.expected+32)throw Error();
   let message=this.incoming.get(f.seq);if(!message){message={total:f.total,parts:new Map(),at:now};this.incoming.set(f.seq,message);}
   if(message.total!==f.total)throw Error();
   if(!message.parts.has(f.index)){message.parts.set(f.index,f.data);this.size+=f.data.length;}
   else if(message.parts.get(f.index)!==f.data)throw Error();
   if(this.size>MAX_BUFFER)throw Error();
   let next=this.incoming.get(this.expected);
   while(next&&next.parts.size===next.total){
    let text='';for(let i=0;i<next.total;i++)text+=next.parts.get(i)!;if(text.length>MAX_MESSAGE)throw Error();
    this.size-=text.length;this.incoming.delete(this.expected++);this.receive(JSON.parse(text));next=this.incoming.get(this.expected);
   }
  }catch{this.abort('Invalid or oversized Nearby message.');}
 }
 tick(now=Date.now()){if([...this.incoming.values()].some(m=>now-m.at>15000))this.abort('Nearby transfer timed out. Reconnect to restore the canvas.');}
 close(){this.closed=true;this.incoming.clear();this.size=0;}
 private abort(reason:string){if(this.closed)return;this.close();this.fail(reason);}
}
