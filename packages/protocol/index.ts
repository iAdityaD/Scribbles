import { z } from 'zod';
export const avatars = ['😎','🐱','🦊','🐼','🐸','🦄','🤖','👽'];
export const palette = ['#20242D','#FFFFFF','#FF5252','#FFB52E','#FFE047','#51CC7A','#398BFF','#AC66FF'];
export const WORD_SET_MIN = 20;
export const WORD_SET_MAX = 100;
export const wordKey = (word:string) => word.toLowerCase().replace(/[^a-z]/g,'');
const wordSchema=z.string().trim().min(2,'Each word needs at least 2 characters.').max(32,'Keep each word under 33 characters.').regex(/^[a-zA-Z]+(?:[ -][a-zA-Z]+)*$/,'Words can contain letters, spaces and hyphens.');
export const wordListSchema=z.array(wordSchema).min(WORD_SET_MIN,'A set needs at least 20 unique words.').max(WORD_SET_MAX,'A set can contain at most 100 words.').refine(words=>new Set(words.map(wordKey)).size===words.length,'Remove duplicate words (spacing and punctuation do not make a different word).');
export const wordSetSchema=z.object({id:z.string().min(1).max(64),name:z.string().trim().min(1,'Give your set a name.').max(40),words:wordListSchema});
export type WordSet=z.infer<typeof wordSetSchema>;
export function parseWordText(text:string){return text.split(/[,\n;]+/).map(w=>w.trim()).filter(Boolean);}
export const settingsSchema = z.object({
  rounds: z.number().int().min(1).max(10), seconds: z.number().int().min(30).max(180),
  maxPlayers: z.number().int().min(2).max(12), mode:z.enum(['random','custom']),pack: z.enum(['Classic','Animals']),
  wordSetName:z.string().max(40),customWords:z.array(wordSchema).max(WORD_SET_MAX),
  wordChoices:z.number().int().min(1).max(3),hints:z.number().int().min(0).max(3),
  choiceSeconds:z.number().int().min(10).max(30),allowLateJoin:z.boolean(),
}).superRefine((s,ctx)=>{
 if(s.mode==='custom'){
  const parsed=wordListSchema.safeParse(s.customWords);
  if(!parsed.success)for(const issue of parsed.error.issues)ctx.addIssue({code:'custom',path:['customWords'],message:issue.message});
  if(!s.wordSetName.trim())ctx.addIssue({code:'custom',path:['wordSetName'],message:'Select a saved word set.'});
 }
});
export const defaults = { rounds: 3, seconds: 80, maxPlayers: 8, mode:'random' as const,pack:'Classic' as const,wordSetName:'',customWords:[] as string[],wordChoices:3,hints:2,choiceSeconds:15,allowLateJoin:true };
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
