import { Buffer } from 'buffer';
import { z } from 'zod';

const ticket=z.object({
  version:z.literal(1),room:z.string().regex(/^[A-Z2-9]{6}$/),
  from:z.string().uuid(),to:z.string().uuid(),nonce:z.string().uuid(),
  expires:z.number().int(),type:z.enum(['offer','answer']),
  sdp:z.string().min(20).max(32000),
});
export type Ticket=z.infer<typeof ticket>;
export function packTicket(value:Ticket){
  return 'SCR1.'+Buffer.from(JSON.stringify(ticket.parse(value)),'utf8').toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
export function readTicket(text:string,kind:Ticket['type']):Ticket {
  const raw=text.trim();
  if(raw.length>50000||!/^SCR1\.[A-Za-z0-9_-]+$/.test(raw))throw Error('Paste the complete pairing message from the other phone.');
  const result=ticket.parse(JSON.parse(Buffer.from(raw.slice(5).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')));
  if(result.type!==kind||result.from===result.to||result.expires<Date.now()||result.expires>Date.now()+11*60000)throw Error('This pairing message expired or is the wrong type. Ask for a new one.');
  return result;
}
