import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateScannerJob,inspectScannerJob} from '../packages/media/laptop-worker.ts';
import {ScanFailure} from '../packages/media/clamav.ts';
const bytes=Buffer.from('Fictional media fixture. '.repeat(8));
const job={id:'00000000-0000-4000-8000-000000000001',leaseToken:'00000000-0000-4000-8000-000000000002',sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,downloadUrl:'https://br-tiny-haze-bdurpbbb.storage.c-8.us-east-2.aws.neon.tech/bucket/original'};
const fetcher=(async()=>new Response(bytes)) as typeof fetch;
test('laptop worker rejects arbitrary destinations, oversized jobs and malformed leases before downloading',()=>{
 for(const downloadUrl of ['http://127.0.0.1/internal','https://example.com/file','https://a.neon.tech.evil.example/file','https://user:pass@br-a.storage.c-8.us-east-2.aws.neon.tech/file'])assert.throws(()=>validateScannerJob({...job,downloadUrl}));
 assert.throws(()=>validateScannerJob({...job,sizeBytes:61*1024*1024}));
 assert.throws(()=>validateScannerJob({...job,leaseToken:'bad'}));
});
test('the scanner sees only bytes matching both size and SHA-256; unavailable is never clean',async()=>{
 let called=false;
 const scan=async()=>{called=true;return {scanner:'clamav' as const,verdict:'clean' as const}};
 await assert.rejects(inspectScannerJob({...job,sha256:'a'.repeat(64)},'/socket',fetcher,scan));
 assert.equal(called,false);
 await assert.rejects(inspectScannerJob({...job,sizeBytes:64},'/socket',fetcher,scan));
 assert.equal(await inspectScannerJob(job,'/socket',fetcher,scan),'clean');
 assert.equal(await inspectScannerJob(job,'/socket',fetcher,async()=>{throw new ScanFailure('detected','test')}),'detected');
 await assert.rejects(inspectScannerJob(job,'/socket',fetcher,async()=>{throw new ScanFailure('unavailable','offline')}));
});
