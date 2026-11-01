import { z } from 'zod';
export const avatars = ['😎','🐱','🦊','🐼','🐸','🦄','🤖','👽'];
export const palette = ['#20242D','#FFFFFF','#FF5252','#FFB52E','#FFE047','#51CC7A','#398BFF','#AC66FF'];
export const settingsSchema = z.object({
  rounds: z.number().int().min(1).max(8), seconds: z.number().int().min(30).max(180),
  maxPlayers: z.number().int().min(2).max(8), pack: z.enum(['Classic','Animals','Custom']),
  customWords: z.array(z.string().trim().min(2).max(32).regex(/^[a-zA-Z -]+$/)).max(100),
}).refine(s => s.pack !== 'Custom' || new Set(s.customWords.map(w=>w.toLowerCase())).size >= 3, 'Add at least three different custom words.');
export const defaults = { rounds: 3, seconds: 80, maxPlayers: 8, pack: 'Classic' as const, customWords: [] as string[] };
export type Settings = z.infer<typeof settingsSchema>;
export const pointSchema = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
export const strokeSchema = z.object({id:z.string().min(1).max(64),color:z.enum(palette as [string,...string[]]),width:z.number().min(1).max(30),points:z.array(pointSchema).min(1).max(1500)});
export const commandSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('create'),name:z.string().trim().min(1).max(20),avatar:z.number().int().min(0).max(7),settings:settingsSchema}),
 z.object({type:z.literal('join'),code:z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/),name:z.string().trim().min(1).max(20),avatar:z.number().int().min(0).max(7)}),
 z.object({type:z.literal('resume'),code:z.string().max(6),token:z.string().min(20).max(128)}),
 z.object({type:z.literal('settings'),settings:settingsSchema}),
 z.object({type:z.literal('ready'),ready:z.boolean()}),
 z.object({type:z.literal('start')}), z.object({type:z.literal('leave')}),
 z.object({type:z.literal('kick'),playerId:z.string().max(64)}),
 z.object({type:z.literal('choose'),index:z.number().int().min(0).max(2),turnId:z.string()}),
 z.object({type:z.literal('message'),text:z.string().trim().min(1).max(200),mode:z.enum(['guess','chat']),turnId:z.string().optional()}),
 z.object({type:z.literal('stroke'),stroke:strokeSchema,turnId:z.string()}),
 z.object({type:z.literal('canvas'),action:z.enum(['undo','redo','clear']),turnId:z.string()}),
]);
export type Command = z.infer<typeof commandSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type Phase = 'lobby'|'choosing'|'drawing'|'reveal'|'paused'|'finished';
export type Player = {id:string;name:string;avatar:number;score:number;connected:boolean;ready:boolean;guessed:boolean;spectator:boolean};
export type Message = {id:string;playerId?:string;name:string;avatar?:number;text:string;kind:'chat'|'guess'|'system'|'correct';at:number};
export type Snapshot = {
 code:string;me:string;hostId:string;settings:Settings;players:Player[];phase:Phase;round:number;
 turn:number;turnCount:number;turnId:string;drawerId:string;deadline:number;serverNow:number;
 word?:string;choices?:string[];hint?:string;strokes:Stroke[];canvasRevision:number;messages:Message[];
};
export type Session = {code:string;token:string;playerId:string};
export type Ack = {ok:true;session?:Session}|{ok:false;error:string};
export type Request = {id:string;command:Command};
export type CanvasEvent = {turnId:string;revision:number;stroke:Stroke};
export interface ServerEvents { state:(state:Snapshot)=>void; stroke:(event:CanvasEvent)=>void; removed:(reason:string)=>void }
export interface ClientEvents { command:(request:Request,ack:(result:Ack)=>void)=>void; sync:(ack:(state:Snapshot|null)=>void)=>void }
