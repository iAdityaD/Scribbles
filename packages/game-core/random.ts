/** Platform boundary: Node uses Web Crypto; mobile supplies Expo Crypto. */
export interface RandomSource { bytes(length:number):Uint8Array }
export const webRandom:RandomSource={bytes(length){return globalThis.crypto.getRandomValues(new Uint8Array(length));}};
export function randomHex(random:RandomSource,length=16){return Array.from(random.bytes(length),b=>b.toString(16).padStart(2,'0')).join('');}
export function randomIndex(random:RandomSource,max:number){
 if(!Number.isInteger(max)||max<1||max>256)throw new Error('Invalid random bound');
 const limit=256-(256%max);let value:number;do{value=random.bytes(1)[0];}while(value>=limit);return value%max;
}
