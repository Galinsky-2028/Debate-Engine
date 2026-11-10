import {createHash} from 'node:crypto';
import {scanWithClamd,ScanFailure} from './clamav.ts';
export type ScannerJob={id:string;sha256:string;sizeBytes:number;leaseToken:string;downloadUrl:string};
export function validateScannerJob(value:unknown):ScannerJob{
 const j=value as ScannerJob;
 const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!j||!id.test(j.id)||!id.test(j.leaseToken)||!/^[0-9a-f]{64}$/.test(j.sha256)||!Number.isInteger(j.sizeBytes)||j.sizeBytes<64||j.sizeBytes>60*1024*1024)
  throw Error('Invalid scanner job.');
 const url=new URL(j.downloadUrl);
 // Download only from the selected Neon storage region, never arbitrary hosts.
 if(url.protocol!=='https:'||url.username||url.password||url.port||!/^br-[a-z0-9-]+\.storage\.c-[0-9]+\.[a-z0-9-]+\.aws\.neon\.tech$/.test(url.hostname))
  throw Error('Unapproved storage download destination.');
 return j;
}
export async function inspectScannerJob(job:ScannerJob,socket:string,fetcher:typeof fetch=fetch,scan=scanWithClamd){
 validateScannerJob(job);
 const response=await fetcher(job.downloadUrl,{redirect:'error',signal:AbortSignal.timeout(90000)});
 if(!response.ok||!response.body)throw Error('Original download failed.');
 const chunks:Uint8Array[]=[];
 let size=0;
 const reader=response.body.getReader();
 try {while(true){
  const {done,value}=await reader.read();if(done)break;
  size+=value.length;
  if(size>job.sizeBytes)throw Error('Original exceeded its declared size.');
  chunks.push(value);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=Buffer.concat(chunks);
 if(size!==job.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==job.sha256)throw Error('Original bytes do not match the job digest.');
 try {await scan(bytes,socket);return 'clean' as const;}
 catch(e){if(e instanceof ScanFailure&&e.reason==='detected')return 'detected' as const;throw e;}
}
