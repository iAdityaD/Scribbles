import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { Ack, Command, Session, Snapshot } from '../../../packages/protocol/index';
import type { GameTransport } from '../../../packages/network/transport';
import { SocketTransport, verifyGameServer } from '../../../packages/network/SocketTransport';
import { NearbyTransport } from '../../../packages/network/NearbyTransport';
import { createNearbyBridge } from './network/nativeNearby';
import { parseOnlineInvite, serverOrigin, type OnlineInvite } from '../../../packages/network/onlineAddress';
import { MeshBridge, type PenCursor } from './mesh/MeshBridge';
import { createPeer } from './mesh/rtc';
const development=Platform.OS==='web'||__DEV__;
const DEFAULT_URL=process.env.EXPO_PUBLIC_SERVER_URL||(development?'http://localhost:3001':'');
export function useGame(){
 const [state,setState]=useState<Snapshot|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState('');
 const [endpoint,setEndpoint]=useState(DEFAULT_URL),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'socket'|'nearby'|'mesh'>(Platform.OS==='android'?'mesh':'socket'),[connectionMessage,setConnectionMessage]=useState('Connecting to online server…');
 const [profile,setProfile]=useState({name:'',avatar:0}),[invite,setInvite]=useState<OnlineInvite|null>(null);
 const transport=useRef<GameTransport|null>(null),session=useRef<Session|null>(null),clockOffset=useRef(0);
 const mesh=useMemo(()=>new MeshBridge(createPeer,()=>Crypto.randomUUID()),[]);
 const [typing,setTyping]=useState(false),[cursor,setCursor]=useState<PenCursor|null>(null);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>;
  const off=mesh.onPen(point=>{setCursor(point);clearTimeout(timer);timer=setTimeout(()=>setCursor(null),650);});
  return()=>{off();clearTimeout(timer);};
 },[mesh]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>;
  const off=mesh.onTyping(()=>{setTyping(true);clearTimeout(timer);timer=setTimeout(()=>setTyping(false),1800);});
  return()=>{off();clearTimeout(timer);};
 },[mesh]);
 const operation=useRef(0);
 // Set inside state updaters when the local canvas is behind; the effect below re-syncs outside render.
 const needSync=useRef(false),resync=useRef<()=>void>(()=>{});
 const accept=(s:Snapshot)=>{clockOffset.current=s.serverNow-Date.now();setState(prev=>{
  if(!s.canvasOmitted)return s;
  // Lightweight update without strokes: keep the canvas we already have for this turn.
  if(prev&&prev.turnId===s.turnId){if(s.canvasRevision>prev.canvasRevision)needSync.current=true;return {...s,canvasOmitted:undefined,strokes:prev.strokes,canvasRevision:prev.canvasRevision};}
  if(s.canvasRevision>0)needSync.current=true;
  return {...s,canvasOmitted:undefined,strokes:[],canvasRevision:0};
 });};
 useEffect(()=>{if(needSync.current){needSync.current=false;resync.current();}},[state]);
 useEffect(()=>{
  let alive=true;
  AsyncStorage.multiGet(['scribbles.profile','scribbles.session','scribbles.endpoint','scribbles.mode']).then(rows=>{
   if(!alive)return;
   const saved=Object.fromEntries(rows);
   let origin=DEFAULT_URL;
   try{if(saved['scribbles.endpoint'])origin=serverOrigin(saved['scribbles.endpoint'],development);}catch{}
   setEndpoint(origin);
   try{if(saved['scribbles.profile'])setProfile(JSON.parse(saved['scribbles.profile']));}catch{}
   if(saved['scribbles.mode']==='nearby'&&Platform.OS==='android')setMode('nearby');
   try{
    const seat=JSON.parse(saved['scribbles.session']||'null');
    if(seat&&origin&&(seat.server===origin||(!seat.server&&saved['scribbles.endpoint']===origin))){
     session.current={code:seat.code,playerId:seat.playerId,token:seat.token};
    }
   }catch{}
   setLoaded(true);
  }).catch(()=>{setLoaded(true);setError('Local preferences could not be loaded.');});
  const link=(url:string)=>{if(Platform.OS==='android')return;const parsed=parseOnlineInvite(url);if(parsed)setInvite(parsed);};
  Linking.getInitialURL().then(url=>url&&link(url));const sub=Linking.addEventListener('url',e=>link(e.url));
  return()=>{alive=false;sub.remove();};
 },[]);
 useEffect(()=>{
  if(!loaded)return;let alive=true;
  if(mode==='socket'&&!endpoint){setConnected(false);setConnectionMessage('Open an online room invite or set the server in Settings.');return;}
  const t:GameTransport=mode==='mesh'?new NearbyTransport(mesh,{bytes:length=>Crypto.getRandomBytes(length)},'mesh'):mode==='nearby'?new NearbyTransport(createNearbyBridge(),{bytes:length=>Crypto.getRandomBytes(length)}):new SocketTransport(endpoint);
  transport.current=t;setConnected(false);setConnectionMessage(mode==='nearby'?'Nearby ready. No internet needed.':'Connecting to online server…');
  const clear=()=>{session.current=null;setState(null);if(mode==='socket')AsyncStorage.removeItem('scribbles.session').catch(()=>{});};
  const fresh=()=>{const op=operation.current;void t.sync().then(s=>{if(alive&&op===operation.current&&s)accept(s);}).catch(()=>{});};
  resync.current=fresh;
  const off=t.subscribe(event=>{
   if(!alive)return;
   if(event.type==='connection'){
    setConnectionMessage(event.message??(event.connected?'Ready when you are':'Reconnecting…'));
    if(event.connected&&mode==='socket'&&session.current){const op=operation.current;setConnected(false);void t.request({id:Crypto.randomUUID(),command:{type:'resume',...session.current}}).then(result=>{
     if(!alive||op!==operation.current)return;if(!result.ok){clear();setError(result.error);}setConnected(true);
    }).catch(()=>{if(alive&&op===operation.current){setError('Reconnection timed out. Trying again…');t.disconnect();void t.connect();}});}else setConnected(event.connected);
   }else if(event.type==='state')accept(event.state);
   else if(event.type==='stroke')setState(prev=>{
    const e=event.event;
    if(!prev||prev.turnId!==e.turnId||e.revision<=prev.canvasRevision)return prev;
    if(e.revision>prev.canvasRevision+1){needSync.current=true;return prev;}
    const strokes=[...prev.strokes];const i=strokes.findIndex(x=>x.id===e.stroke.id);let next=e.stroke;
    // Delta events carry only the appended points.
    if(e.from!==undefined){const old=i>=0?strokes[i].points:[];if(e.from>old.length){needSync.current=true;return prev;}next={...e.stroke,points:old.slice(0,e.from).concat(e.stroke.points)};}
    if(i<0)strokes.push(next);else strokes[i]=next;
    return {...prev,strokes,canvasRevision:e.revision};
   });
   else if(event.type==='removed'){clear();setError(event.reason);}
   else setError(event.message);
  });
  void t.connect().catch(e=>{if(alive)setError(String(e));});
  const sub=AppState.addEventListener('change',status=>{t.setActive(status==='active');if(status==='active')fresh();});
  return()=>{alive=false;sub.remove();off();t.disconnect();if(transport.current===t)transport.current=null;};
 },[endpoint,loaded,mode]);
 useEffect(()=>{
  if(mode==='socket'||!state)return;
  void activateKeepAwakeAsync('scribbles-room').catch(()=>{});
  return()=>{void deactivateKeepAwake('scribbles-room').catch(()=>{});};
 },[mode,!!state]);
 async function send(command:Command,quiet=false):Promise<boolean>{
  const t=transport.current;const op=operation.current;
  if(t?.kind==='socket'&&command.type==='leave'&&!connected){
   session.current=null;setState(null);operation.current++;
   await AsyncStorage.removeItem('scribbles.session').catch(()=>{});
   t.disconnect();await t.connect();return true;
  }
  if(!t||(!connected&&command.type!=='leave')){if(!quiet)setError(connectionMessage);return false;}
  if(!quiet)setBusy(true);
  if(mode==='mesh'&&command.type==='stroke'){
   const point=command.stroke.points.at(-1);if(point)mesh.publishPen(command.turnId,point.x,point.y);
  }
  try{
   const result:Ack=await t.request({id:Crypto.randomUUID(),command});
   if(t!==transport.current||op!==operation.current)return false;
   if(!result.ok){if(!quiet)setError(result.error);if(command.type==='stroke')void t.sync().then(s=>s&&accept(s)).catch(()=>{});return false;}
   if(result.session){session.current=result.session;if(mode==='socket')AsyncStorage.setItem('scribbles.session',JSON.stringify({...result.session,server:endpoint})).catch(()=>setError('Could not save reconnect details.'));}
   if(command.type==='leave'){session.current=null;setState(null);if(mode==='socket')AsyncStorage.removeItem('scribbles.session').catch(()=>{});}
   return true;
  }catch(e){if(op!==operation.current)return false;if(!quiet)setError(e instanceof Error?e.message:String(e));void t.sync().then(s=>s&&accept(s)).catch(()=>{});return false;}
  finally{if(!quiet&&op===operation.current)setBusy(false);}
 }
 function cancelPending(){if(mode==='socket'||state)return;operation.current++;transport.current?.disconnect();void transport.current?.connect();setBusy(false);setError('');}
 async function saveProfile(next:typeof profile){setProfile(next);await AsyncStorage.setItem('scribbles.profile',JSON.stringify(next)).catch(()=>{});}
 async function saveMode(next:'socket'|'nearby'|'mesh'){
  if(next===mode)return;
  if(state||busy){setError('Leave your room before switching connection modes.');return;}
  if(next==='nearby'&&Platform.OS!=='android'){setError('Nearby play is Android-only for now.');return;}
  session.current=null;setMode(next);await AsyncStorage.multiRemove(['scribbles.session']);await AsyncStorage.setItem('scribbles.mode',next);
 }
 async function saveEndpoint(url:string){
  if(state||busy){setError('Leave the room before changing servers.');return false;}
  setBusy(true);
  try{
   const origin=serverOrigin(url,development);
   await verifyGameServer(origin);
   if(origin!==endpoint){
    await AsyncStorage.removeItem('scribbles.session');session.current=null;
    await AsyncStorage.setItem('scribbles.endpoint',origin);setEndpoint(origin);
   }
   return true;
  }catch(e){setError(e instanceof Error?e.message:'Could not verify game server.');return false;}
  finally{setBusy(false);}
 }
 return {mesh,typing,cursor:state?.phase==='drawing'&&cursor?.turn===state.turnId&&cursor.player===state.drawerId?cursor:null,state,connected,error,setError,endpoint,saveEndpoint,mode,saveMode,cancelPending,connectionMessage,profile,saveProfile,send,busy,loaded,clockOffset,invite,setInvite};
}
