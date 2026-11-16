import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {chooseRendition,encodeStorageKey,profileFor} from '../packages/domain/playback.ts';
import {ffmpegArgs,performEncode,validateEncodeJob,type EncodeJob} from '../packages/media/encode.ts';

const original=Buffer.from('Fictional original media fixture. '.repeat(8));
const host='https://br-tiny-haze-bdurpbbb.storage.c-8.us-east-2.aws.neon.tech/bucket/';
const job:EncodeJob={kind:'encode',id:'00000000-0000-4000-8000-000000000011',leaseToken:'00000000-0000-4000-8000-000000000012',
 sha256:createHash('sha256').update(original).digest('hex'),sizeBytes:original.length,profile:'video-720p-h264',
 downloadUrl:host+'original',uploadUrl:host+'playback.mp4?X-Amz-Signature=x',outputMime:'video/mp4',maxOutputBytes:1024};

test('profiles, storage keys and the rendition a player receives',()=>{
 assert.equal(profileFor('video/mp4'),'video-720p-h264');
 assert.equal(profileFor('audio/mpeg'),'audio-aac-128k');
 assert.equal(profileFor('text/plain'),null);
 assert.match(encodeStorageKey('00000000-0000-4000-8000-000000000001','a'.repeat(64),'video-720p-h264'),/^playback\/[0-9a-f-]{36}\/a{16}-video-720p-h264\.mp4$/);
 assert.throws(()=>encodeStorageKey('../x','a'.repeat(64),'video-720p-h264'));
 assert.equal(chooseRendition(null,{status:'ready',storage_key:'playback/x.mp4'}),'playback');
 assert.equal(chooseRendition('original',{status:'ready',storage_key:'playback/x.mp4'}),'original');
 for(const encode of [null,undefined,{status:'pending',storage_key:null},{status:'failed',storage_key:null}])assert.equal(chooseRendition(null,encode),'original');
});

test('encode jobs only talk to the storage region and carry consistent profiles',()=>{
 assert.equal(validateEncodeJob(job).id,job.id);
 for(const bad of [{uploadUrl:'https://example.com/put'},{downloadUrl:'http://127.0.0.1/x'},{kind:'scan'},{profile:'gif'},
  {outputMime:'audio/mp4'},{sizeBytes:61*1024*1024},{maxOutputBytes:0},{leaseToken:'nope'}])
  assert.throws(()=>validateEncodeJob({...job,...bad} as EncodeJob));
});

test('ffmpeg is confined to local files and strips original metadata',()=>{
 for(const profile of ['video-720p-h264','audio-aac-128k'] as const){
  const args=ffmpegArgs(profile,'/tmp/in','/tmp/out');
  assert.deepEqual(args.slice(args.indexOf('-protocol_whitelist'),args.indexOf('-protocol_whitelist')+2),['-protocol_whitelist','file']);
  assert.ok(args.includes('-map_metadata')&&args.includes('+faststart'));
  assert.equal(args.at(-1),'/tmp/out');
 }
 assert.ok(ffmpegArgs('audio-aac-128k','i','o').includes('-vn'));
 assert.ok(ffmpegArgs('video-720p-h264','i','o').includes('libx264'));
});

test('the worker verifies the original before encoding and reports the uploaded digest',async()=>{
 const uploads:Buffer[]=[];
 const fetcher=(async(url:string,init?:RequestInit)=>{
  if(init?.method==='PUT'){uploads.push(Buffer.from(init.body as Uint8Array));return new Response(null,{status:200});}
  return new Response(original);
 }) as unknown as typeof fetch;
 const rendition=Buffer.from('fictional encoded rendition');
 let ran=0;
 const run=async(args:string[])=>{ran++;await writeFile(args.at(-1)!,rendition);};
 const result=await performEncode(job,fetcher,run);
 assert.equal(ran,1);
 assert.deepEqual(result,{outputSha256:createHash('sha256').update(rendition).digest('hex'),outputBytes:rendition.length});
 assert.deepEqual(uploads[0],rendition);
 // tampered original: no encode, no upload
 await assert.rejects(performEncode({...job,sha256:'b'.repeat(64)},fetcher,run),/digest/);
 assert.equal(ran,1);
 // oversized output is never uploaded
 await assert.rejects(performEncode({...job,maxOutputBytes:4},fetcher,run),/size limit/);
 assert.equal(uploads.length,1);
 // a failed upload is an error, not a success
 const refusing=(async(_u:string,init?:RequestInit)=>init?.method==='PUT'?new Response(null,{status:403}):new Response(original)) as unknown as typeof fetch;
 await assert.rejects(performEncode(job,refusing,run),/upload failed/);
});
