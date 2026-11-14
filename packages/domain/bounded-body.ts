/** Read a request body with a hard byte cap, independent of any client-declared Content-Length. */
export class BodyTooLarge extends Error {}
export async function readBounded(body:ReadableStream<Uint8Array>|null,maxBytes:number):Promise<Uint8Array<ArrayBuffer>>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error("A positive byte limit is required.");
 if(!body)return new Uint8Array(new ArrayBuffer(0));
 const reader=body.getReader();
 const chunks:Uint8Array[]=[];
 let total=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>maxBytes){await reader.cancel().catch(()=>{});throw new BodyTooLarge("Request body exceeds "+maxBytes+" bytes.");}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const out=new Uint8Array(new ArrayBuffer(total));
 let offset=0;
 for(const c of chunks){out.set(c,offset);offset+=c.byteLength;}
 return out;
}
/** A declared Content-Length larger than the limit is rejected before any byte is read. */
export function declaredLengthTooLarge(header:string|null,maxBytes:number){
 if(header===null)return false;
 const n=Number(header);
 return !Number.isSafeInteger(n)||n<0||n>maxBytes;
}
