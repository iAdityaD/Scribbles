import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wordSetSchema, type WordSet } from '../../../packages/protocol/index';
const KEY='scribbles.wordSets.v1';
export function useWordSets(){
 const [sets,setSets]=useState<WordSet[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;AsyncStorage.getItem(KEY).then(raw=>{
  if(!active)return;if(raw){const decoded:unknown=JSON.parse(raw);if(!Array.isArray(decoded))throw Error('Invalid word sets');const parsed=decoded.map(s=>wordSetSchema.parse(s));setSets(parsed);}setLoaded(true);
 }).catch(()=>{if(active){setError('Saved word sets could not be loaded. Restart the app before editing them.');}});return()=>{active=false;};},[]);
 async function save(set:WordSet){
  if(!loaded)throw Error(error||'Word sets are still loading.');
  const valid=wordSetSchema.parse(set);
  if(sets.some(s=>s.id!==valid.id&&s.name.toLowerCase()===valid.name.toLowerCase()))throw Error('Another set already has that name.');
  const next=sets.some(s=>s.id===valid.id)?sets.map(s=>s.id===valid.id?valid:s):[...sets,valid];
  await AsyncStorage.setItem(KEY,JSON.stringify(next));setSets(next);return valid;
 }
 async function remove(id:string){if(!loaded)throw Error('Word sets are not loaded.');const next=sets.filter(s=>s.id!==id);await AsyncStorage.setItem(KEY,JSON.stringify(next));setSets(next);}
 return {sets,loaded,error,save,remove};
}
