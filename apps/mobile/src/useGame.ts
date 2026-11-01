import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { Ack, Command, Session, Snapshot } from '../../../packages/protocol/index';
import type { GameTransport } from '../../../packages/network/transport';
import { SocketTransport } from '../../../packages/network/SocketTransport';
import { NearbyTransport } from '../../../packages/network/NearbyTransport';
import { createNearbyBridge } from './network/nativeNearby';
const DEFAULT_URL=process.env.EXPO_PUBLIC_SERVER_URL||'http://localhost:3001';
export function useGame(){
 const [state,setState]=useState<Snapshot|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState('');
 const [endpoint,setEndpoint]=useState(DEFAULT_URL),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'socket'|'nearby'>('socket'),[connectionMessage,setConnectionMessage]=useState('Connecting to online server…');
 const [profile,setProfile]=useState({name:'',avatar:0}),[invite,setInvite]=useState('');
 const transport=useRef<GameTransport|null>(null),session=useRef<Session|null>(null),clockOffset=useRef(0);
 const operation=useRef(0);
 const accept=(s:Snapshot)=>{clockOffset.current=s.serverNow-Date.now();setState(s);};
 useEffect(()=>{
  let alive=true;
  AsyncStorage.multiGet(['scribbles.profile','scribbles.session','scribbles.endpoint','scribbles.mode']).then(rows=>{
   if(!alive)return;for(const [key,value]of rows)if(value){try{if(key.endsWith('profile'))setProfile(JSON.parse(value));if(key.endsWith('session'))session.current=JSON.parse(value);if(key.endsWith('endpoint'))setEndpoint(value);if(key.endsWith('mode')&&value==='nearby'&&Platform.OS==='android')setMode('nearby');}catch{}}
   setLoaded(true);
  }).catch(()=>{setLoaded(true);setError('Local preferences could not be loaded.');});
  const link=(url:string)=>{const match=url.match(/(?:join\/|[?&]code=)([A-Z2-9]{6})/i);if(match)setInvite(match[1].toUpperCase());};
  Linking.getInitialURL().then(url=>url&&link(url));const sub=Linking.addEventListener('url',e=>link(e.url));
  return()=>{alive=false;sub.remove();};
 },[]);
 useEffect(()=>{
  if(!loaded)return;let alive=true;
  const t:GameTransport=mode==='nearby'?new NearbyTransport(createNearbyBridge(),{bytes:length=>Crypto.getRandomBytes(length)}):new SocketTransport(endpoint);
  transport.current=t;setConnected(false);setConnectionMessage(mode==='nearby'?'Nearby ready. No internet needed.':'Connecting to online server…');
  const clear=()=>{session.current=null;setState(null);if(mode==='socket')AsyncStorage.removeItem('scribbles.session').catch(()=>{});};
  const fresh=()=>void t.sync().then(s=>{if(alive&&s)accept(s);}).catch(()=>{});
  const off=t.subscribe(event=>{
   if(!alive)return;
   if(event.type==='connection'){
    setConnectionMessage(event.message??(event.connected?'Ready when you are':'Reconnecting…'));
    if(event.connected&&mode==='socket'&&session.current){setConnected(false);void t.request({id:Crypto.randomUUID(),command:{type:'resume',...session.current}}).then(result=>{
     if(!alive)return;if(!result.ok){clear();setError(result.error);}setConnected(true);
    }).catch(()=>{if(alive){setError('Reconnection timed out. Trying again…');t.disconnect();void t.connect();}});}else setConnected(event.connected);
   }else if(event.type==='state')accept(event.state);
   else if(event.type==='stroke')setState(prev=>{
    if(!prev||prev.turnId!==event.event.turnId||event.event.revision<=prev.canvasRevision)return prev;
    if(event.event.revision>prev.canvasRevision+1){fresh();return prev;}
    const strokes=[...prev.strokes];const i=strokes.findIndex(x=>x.id===event.event.stroke.id);if(i<0)strokes.push(event.event.stroke);else strokes[i]=event.event.stroke;
    return {...prev,strokes,canvasRevision:event.event.revision};
   });
   else if(event.type==='removed'){clear();setError(event.reason);}
   else setError(event.message);
  });
  void t.connect().catch(e=>{if(alive)setError(String(e));});
  const sub=AppState.addEventListener('change',status=>{t.setActive(status==='active');if(status==='active')fresh();});
  return()=>{alive=false;sub.remove();off();t.disconnect();if(transport.current===t)transport.current=null;};
 },[endpoint,loaded,mode]);
 useEffect(()=>{
  if(mode!=='nearby'||!state)return;
  void activateKeepAwakeAsync('scribbles-room').catch(()=>{});
  return()=>{void deactivateKeepAwake('scribbles-room').catch(()=>{});};
 },[mode,!!state]);
 async function send(command:Command,quiet=false):Promise<boolean>{
  const t=transport.current;const op=operation.current;
  if(!t||(!connected&&command.type!=='leave')){if(!quiet)setError(connectionMessage);return false;}
  if(!quiet)setBusy(true);
  try{
   const result:Ack=await t.request({id:Crypto.randomUUID(),command});
   if(t!==transport.current||op!==operation.current)return false;
   if(!result.ok){if(!quiet)setError(result.error);if(command.type==='stroke')void t.sync().then(s=>s&&accept(s)).catch(()=>{});return false;}
   if(result.session){session.current=result.session;if(mode==='socket')AsyncStorage.setItem('scribbles.session',JSON.stringify(result.session)).catch(()=>setError('Could not save reconnect details.'));}
   if(command.type==='leave'){session.current=null;setState(null);if(mode==='socket')AsyncStorage.removeItem('scribbles.session').catch(()=>{});}
   return true;
  }catch(e){if(op!==operation.current)return false;if(!quiet)setError(e instanceof Error?e.message:String(e));void t.sync().then(s=>s&&accept(s)).catch(()=>{});return false;}
  finally{if(!quiet&&op===operation.current)setBusy(false);}
 }
 function cancelPending(){if(mode!=='nearby'||state)return;operation.current++;transport.current?.disconnect();void transport.current?.connect();setBusy(false);setError('');}
 async function saveProfile(next:typeof profile){setProfile(next);await AsyncStorage.setItem('scribbles.profile',JSON.stringify(next)).catch(()=>{});}
 async function saveMode(next:'socket'|'nearby'){
  if(state||busy){setError('Leave your room before switching connection modes.');return;}
  if(next==='nearby'&&Platform.OS!=='android'){setError('Nearby play is Android-only for now.');return;}
  session.current=null;setMode(next);await AsyncStorage.multiRemove(['scribbles.session']);await AsyncStorage.setItem('scribbles.mode',next);
 }
 async function saveEndpoint(url:string){
  try{const parsed=new URL(url.trim());if(!['http:','https:'].includes(parsed.protocol))throw Error();}catch{setError('Enter a valid http:// or https:// server address.');return false;}
  if(state||busy){setError('Leave the room before changing servers.');return false;}
  setEndpoint(url.trim().replace(/\/$/,''));await AsyncStorage.setItem('scribbles.endpoint',url.trim().replace(/\/$/,'')).catch(()=>{});return true;
 }
 return {state,connected,error,setError,endpoint,saveEndpoint,mode,saveMode,cancelPending,connectionMessage,profile,saveProfile,send,busy,loaded,clockOffset,invite,setInvite};
}
