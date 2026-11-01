import React, { useEffect, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import type { Stroke } from '../../../packages/protocol/index';
function StrokePath({stroke}:{stroke:Stroke}){
 const pts=stroke.points;if(pts.length===1)return <Circle cx={pts[0].x*1000} cy={pts[0].y*800} r={stroke.width/2} fill={stroke.color}/>;
 return <Path d={pts.map((p,i)=>`${i?'L':'M'}${(p.x*1000).toFixed(1)} ${(p.y*800).toFixed(1)}`).join(' ')} stroke={stroke.color} strokeWidth={stroke.width} fill="none" strokeLinecap="round" strokeLinejoin="round"/>;
}
const MemoStroke=React.memo(StrokePath);
export function DrawingCanvas({strokes,enabled,color,width,turnId,onStroke}:{strokes:Stroke[];enabled:boolean;color:string;width:number;turnId:string;onStroke:(s:Stroke)=>void}){
 const [draft,setDraft]=useState<Stroke|null>(null);const current=useRef<Stroke|null>(null),size=useRef({w:1,h:1}),lastSent=useRef(0);
 const props=useRef({enabled,color,width,onStroke});props.current={enabled,color,width,onStroke};
 useEffect(()=>{current.current=null;setDraft(null);},[turnId,enabled]);
 useEffect(()=>{if(draft&&!current.current&&strokes.some(s=>s.id===draft.id&&s.points.length>=draft.points.length))setDraft(null);},[strokes,draft]);
 const responder=useRef(PanResponder.create({
  onStartShouldSetPanResponder:()=>props.current.enabled,onMoveShouldSetPanResponder:()=>props.current.enabled,
  onPanResponderGrant:e=>{const {locationX:x,locationY:y}=e.nativeEvent;const p={x:Math.max(0,Math.min(1,x/size.current.w)),y:Math.max(0,Math.min(1,y/size.current.h))};const s={id:Crypto.randomUUID(),color:props.current.color,width:props.current.width,points:[p]};current.current=s;setDraft(s);props.current.onStroke(s);lastSent.current=Date.now();},
  onPanResponderMove:e=>{
   if(!current.current||!props.current.enabled)return;const {locationX:x,locationY:y}=e.nativeEvent;
   const point={x:Math.max(0,Math.min(1,x/size.current.w)),y:Math.max(0,Math.min(1,y/size.current.h))},previous=current.current.points.at(-1)!;
   if(Math.hypot(point.x-previous.x,point.y-previous.y)<0.002||current.current.points.length>=1500)return;
   const s={...current.current,points:[...current.current.points,point]};current.current=s;setDraft(s);
   if(Date.now()-lastSent.current>70){props.current.onStroke(s);lastSent.current=Date.now();}
  },
  onPanResponderRelease:()=>{if(current.current)props.current.onStroke(current.current);current.current=null;},
  onPanResponderTerminate:()=>{if(current.current)props.current.onStroke(current.current);current.current=null;},
  onPanResponderTerminationRequest:()=>false,
 })).current;
 return <View accessibilityLabel={enabled?'Drawing canvas. Draw with your finger.':'Live drawing canvas'} style={styles.canvas} onLayout={e=>{size.current={w:e.nativeEvent.layout.width,h:e.nativeEvent.layout.height};}} {...responder.panHandlers}>
  <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 1000 800">{strokes.filter(s=>s.id!==draft?.id).map(s=><MemoStroke key={s.id} stroke={s}/>)}{draft&&<MemoStroke stroke={draft}/>}</Svg>
 </View>;
}
const styles=StyleSheet.create({canvas:{width:'100%',aspectRatio:1.25,backgroundColor:'#FFFFFF',borderRadius:24,overflow:'hidden'}});
