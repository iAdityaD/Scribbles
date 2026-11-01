import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { NearbyBridge, RadioEvent } from '../../../../packages/network/NearbyBridge';
interface NativeNearby {
 checkAvailable():Promise<void>;advertise(name:string):Promise<void>;discover():Promise<void>;stopDiscovery():Promise<void>;
 requestConnection(id:string,name:string):Promise<void>;send(id:string,data:string):Promise<void>;disconnectEndpoint(id:string):Promise<void>;stop():Promise<void>;
 addListener(name:'onNearbyEvent',listener:(event:RadioEvent)=>void):{remove():void};
}
export function createNearbyBridge():NearbyBridge {
 const native=Platform.OS==='android'?requireOptionalNativeModule<NativeNearby>('ScribblesNearby'):null;
 const get=()=>{if(!native)throw Error('Nearby play requires an Android development or standalone build. It is not available in Expo Go, iOS or web yet.');return native;};
 return {
  async prepare(){
   await get().checkAvailable();const sdk=Number(Platform.Version);const p=PermissionsAndroid.PERMISSIONS;
   const required:Permission[]=[];
   if(sdk<=32)required.push(p.ACCESS_COARSE_LOCATION,p.ACCESS_FINE_LOCATION);
   if(sdk>=31)required.push(p.BLUETOOTH_SCAN,p.BLUETOOTH_CONNECT,p.BLUETOOTH_ADVERTISE);
   if(sdk>=33)required.push(p.NEARBY_WIFI_DEVICES);
   const result=await PermissionsAndroid.requestMultiple(required);
   if(required.some(permission=>result[permission]!==PermissionsAndroid.RESULTS.GRANTED))throw Error('Allow Nearby devices permissions to play locally. On older Android, allow Location and enable Location services. You can change permissions in Android Settings.');
  },
  subscribe(listener){const sub=native?.addListener('onNearbyEvent',listener);return()=>sub?.remove();},
  advertise:name=>get().advertise(name),discover:()=>get().discover(),stopDiscovery:()=>get().stopDiscovery(),
  requestConnection:(id,name)=>get().requestConnection(id,name),send:(id,data)=>get().send(id,data),disconnectEndpoint:id=>get().disconnectEndpoint(id),stop:async()=>{await native?.stop();},
 };
}
