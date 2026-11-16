import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** A playback encode job from the platform. The original is downloaded and verified before encoding. */
export type EncodeJob={kind:'encode';id:string;sha256:string;sizeBytes:number;leaseToken:string;profile:'video-720p-h264'|'audio-aac-128k';
 downloadUrl:string;uploadUrl:string;outputMime:'video/mp4'|'audio/mp4';maxOutputBytes:number};
const STORAGE_HOST=/^br-[a-z0-9-]+\.storage\.c-[0-9]+\.[a-z0-9-]+\.aws\.neon\.tech$/;
function storageUrl(value:string,label:string){
 const url=new URL(value);
 // Talk only to the selected Neon storage region, never arbitrary hosts.
 if(url.protocol!=='https:'||url.username||url.password||url.port||!STORAGE_HOST.test(url.hostname))throw Error('Unapproved storage '+label+' destination.');
 return url;
}
export function validateEncodeJob(value:unknown):EncodeJob{
 const j=value as EncodeJob;
 const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!j||j.kind!=='encode'||!id.test(j.id)||!id.test(j.leaseToken)||!/^[0-9a-f]{64}$/.test(j.sha256)||!Number.isInteger(j.sizeBytes)||
  j.sizeBytes<64||j.sizeBytes>60*1024*1024||!['video-720p-h264','audio-aac-128k'].includes(j.profile)||
  j.outputMime!==(j.profile==='audio-aac-128k'?'audio/mp4':'video/mp4')||!Number.isInteger(j.maxOutputBytes)||j.maxOutputBytes<1||j.maxOutputBytes>200*1024*1024)
  throw Error('Invalid encode job.');
 storageUrl(j.downloadUrl,'download');storageUrl(j.uploadUrl,'upload');
 return j;
}
/** FFmpeg arguments for each profile. No network access, no metadata copied from the original, web-friendly layout. */
export function ffmpegArgs(profile:EncodeJob['profile'],input:string,output:string){
 const common=['-hide_banner','-nostdin','-y','-protocol_whitelist','file','-i',input,'-map_metadata','-1','-map_chapters','-1'];
 if(profile==='audio-aac-128k')return [...common,'-vn','-c:a','aac','-b:a','128k','-ac','2','-movflags','+faststart','-f','mp4',output];
 return [...common,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-profile:v','high','-pix_fmt','yuv420p',
  '-vf',"scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
  '-crf','26','-maxrate','2500k','-bufsize','5000k','-c:a','aac','-b:a','128k','-ac','2','-movflags','+faststart','-f','mp4',output];
}
export type Runner=(args:string[])=>Promise<void>;
export const runFfmpeg:Runner=args=>new Promise((resolve,reject)=>{
 const child=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});
 let tail='';child.stderr.on('data',d=>{tail=(tail+d.toString()).slice(-2000);});
 const timer=setTimeout(()=>child.kill('SIGKILL'),15*60*1000);
 child.on('error',e=>{clearTimeout(timer);reject(e);});
 child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('ffmpeg exited with '+code+': '+tail.split('\n').slice(-3).join(' ')));});
});
async function download(job:EncodeJob,fetcher:typeof fetch){
 const response=await fetcher(job.downloadUrl,{redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!response.ok||!response.body)throw Error('Original download failed.');
 const chunks:Uint8Array[]=[];let size=0;
 const reader=response.body.getReader();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>job.sizeBytes)throw Error('Original exceeded its declared size.');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=Buffer.concat(chunks);
 if(size!==job.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==job.sha256)throw Error('Original bytes do not match the job digest.');
 return bytes;
}
/** Download and verify the original, encode it locally, upload the rendition, and report its digest and size. */
export async function performEncode(job:EncodeJob,fetcher:typeof fetch=fetch,run:Runner=runFfmpeg){
 validateEncodeJob(job);
 const original=await download(job,fetcher);
 const dir=await mkdtemp(join(tmpdir(),'pde-encode-'));
 try{
  const input=join(dir,'original'),output=join(dir,job.profile==='audio-aac-128k'?'playback.m4a':'playback.mp4');
  await writeFile(input,original);
  await run(ffmpegArgs(job.profile,input,output));
  const encoded=await readFile(output);
  if(!encoded.length)throw Error('The encoder produced no output.');
  if(encoded.length>job.maxOutputBytes)throw Error('The rendition exceeds the size limit.');
  const upload=await fetcher(job.uploadUrl,{method:'PUT',redirect:'error',headers:{'content-type':job.outputMime,'cache-control':'private, no-store'},body:encoded,signal:AbortSignal.timeout(300000)});
  if(!upload.ok)throw Error('Rendition upload failed: HTTP '+upload.status);
  return {outputSha256:createHash('sha256').update(encoded).digest('hex'),outputBytes:encoded.length};
 }finally{await rm(dir,{recursive:true,force:true});}
}
/** True when an ffmpeg binary is available, so the worker can advertise the encode capability. */
export function ffmpegAvailable(){
 return new Promise<boolean>(resolve=>{const c=spawn('ffmpeg',['-version'],{stdio:'ignore'});c.on('error',()=>resolve(false));c.on('close',code=>resolve(code===0));});
}
