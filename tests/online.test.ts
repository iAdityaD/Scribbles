import test from 'node:test';
import assert from 'node:assert/strict';
import { serverOrigin, onlineInviteLink, parseOnlineInvite } from '../packages/network/onlineAddress.ts';
import { verifyGameServer } from '../packages/network/SocketTransport.ts';
import { createGameServer } from '../apps/server/src/server.ts';

test('shared invites identify the same online server and accept old code-only links',()=>{
 const link=onlineInviteLink('ABCD23','https://example.org:443/');
 assert.deepEqual(parseOnlineInvite(link),{code:'ABCD23',server:'https://example.org'});
 assert.deepEqual(parseOnlineInvite('scribbles://join/abcd23'),{code:'ABCD23'});
 for(const origin of ['http://example.org','https://example.org/a','https://user:password@example.org','https://example.org/?token=x']){
  assert.throws(()=>serverOrigin(origin));
  assert.equal(parseOnlineInvite('scribbles://join/ABCD23?server='+encodeURIComponent(origin)),null);
 }
 assert.equal(parseOnlineInvite('https://example.org/join/ABCD23'),null);
 assert.equal(parseOnlineInvite('scribbles://join/ABCD23X'),null);
});
test('server setup verifies Socket.IO without creating a room or retaining a player connection',async()=>{
 const server=createGameServer();
 try{
  await new Promise<void>(r=>server.http.listen(0,'127.0.0.1',r));
  const {port}=server.http.address() as {port:number};
  await verifyGameServer('http://127.0.0.1:'+port);
  assert.equal(server.store.rooms.size,0);
 }finally{await server.close();}
});
