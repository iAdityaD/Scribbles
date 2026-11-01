import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, type Socket } from 'socket.io-client';
import * as Crypto from 'expo-crypto';
import type { Ack, Command, Session, Snapshot, ServerEvents, ClientEvents } from '../../../packages/protocol/index';
const DEFAULT_URL=process.env.EXPO_PUBLIC_SERVER_URL||'http://localhost:3001';
export function useGame(){
 const [state,setState]=useState<Snapshot|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState('');
 const [endpoint,setEndpoint]=useState(DEFAULT_URL),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false);
 const [profile,setProfile]=useState({name:'',avatar:0}),[invite,setInvite]=useState('');
 const socket=useRef<Socket<ServerEvents,ClientEvents>|null>(null),session=useRef<Session|null>(null),clockOffset=useRef(0);
 const stateRef=useRef<Snapshot|null>(null);stateRef.current=state;
 const accept=(s:Snapshot)=>{clockOffset.current=s.serverNow-Date.now();setState(s);};
 useEffect(()=>{
  let alive=true;
  AsyncStorage.multiGet(['scribbles.profile','scribbles.session','scribbles.endpoint']).then(rows=>{
   if(!alive)return;for(const [key,value]of rows)if(value){try{if(key.endsWith('profile'))setProfile(JSON.parse(value));if(key.endsWith('session'))session.current=JSON.parse(value);if(key.endsWith('endpoint'))setEndpoint(value);}catch{}}
   setLoaded(true);
  }).catch(()=>{setLoaded(true);setError('Local preferences could not be loaded.');});
  const link=(url:string)=>{const match=url.match(/(?:join\/|[?&]code=)([A-Z2-9]{6})/i);if(match)setInvite(match[1].toUpperCase());};
  Linking.getInitialURL().then(url=>url&&link(url));const sub=Linking.addEventListener('url',e=>link(e.url));
  return()=>{alive=false;sub.remove();};
 },[]);
 useEffect(()=>{
  if(!loaded)return;
  const s:Socket<ServerEvents,ClientEvents>=io(endpoint,{transports:['websocket'],reconnection:true,timeout:7000});socket.current=s;
  const clear=()=>{session.current=null;setState(null);AsyncStorage.removeItem('scribbles.session').catch(()=>{});};
  s.on('connect',()=>{
   if(session.current){setConnected(false);s.timeout(6000).emit('command',{id:Crypto.randomUUID(),command:{type:'resume',...session.current}},(err:Error|null,result:Ack)=>{
    if(err){setError('Reconnection timed out. Trying again…');s.disconnect().connect();return;}
    if(!result.ok){clear();setError(result.error);}setConnected(true);
   });}else setConnected(true);
  });
  s.on('disconnect',()=>setConnected(false));
  s.on('connect_error',()=>{setConnected(false);});
  s.on('state',accept);
  s.on('stroke',event=>{
   setState(prev=>{
    if(!prev||prev.turnId!==event.turnId||event.revision<=prev.canvasRevision)return prev;
    if(event.revision>prev.canvasRevision+1){s.emit('sync',fresh=>fresh&&accept(fresh));return prev;}
    const strokes=[...prev.strokes];const i=strokes.findIndex(x=>x.id===event.stroke.id);if(i<0)strokes.push(event.stroke);else strokes[i]=event.stroke;
    return {...prev,strokes,canvasRevision:event.revision};
   });
  });
  s.on('removed',reason=>{clear();setError(reason);});
  const sub=AppState.addEventListener('change',status=>{if(status==='active'){if(!s.connected)s.connect();else s.emit('sync',fresh=>{if(fresh)accept(fresh);});}});
  return()=>{sub.remove();s.disconnect();socket.current=null;};
 },[endpoint,loaded]);
 async function send(command:Command,quiet=false):Promise<boolean>{
  const s=socket.current;if(!s?.connected||!connected){if(!quiet)setError('Reconnecting… Please wait for the connection.');return false;}
  if(!quiet)setBusy(true);
  return new Promise(resolve=>s.timeout(6000).emit('command',{id:Crypto.randomUUID(),command},(err:Error|null,result:Ack)=>{
   if(!quiet)setBusy(false);
   if(err){if(!quiet)setError('No response yet. Reconnect to check the latest room state.');s.emit('sync',fresh=>fresh&&accept(fresh));resolve(false);return;}
   if(!result.ok){if(!quiet)setError(result.error);if(command.type==='stroke')s.emit('sync',fresh=>fresh&&accept(fresh));resolve(false);return;}
   if(result.session){session.current=result.session;AsyncStorage.setItem('scribbles.session',JSON.stringify(result.session)).catch(()=>setError('Could not save reconnect details.'));}
   if(command.type==='leave'){session.current=null;setState(null);AsyncStorage.removeItem('scribbles.session').catch(()=>{});}
   resolve(true);
  }));
 }
 async function saveProfile(next:typeof profile){setProfile(next);await AsyncStorage.setItem('scribbles.profile',JSON.stringify(next)).catch(()=>{});}
 async function saveEndpoint(url:string){
  try{const parsed=new URL(url.trim());if(!['http:','https:'].includes(parsed.protocol))throw Error();}catch{setError('Enter a valid http:// or https:// server address.');return false;}
  if(session.current){setError('Leave the room before changing servers.');return false;}
  setEndpoint(url.trim().replace(/\/$/,''));await AsyncStorage.setItem('scribbles.endpoint',url.trim().replace(/\/$/,'')).catch(()=>{});return true;
 }
 return {state,connected,error,setError,endpoint,saveEndpoint,profile,saveProfile,send,busy,loaded,clockOffset,invite,setInvite};
}
