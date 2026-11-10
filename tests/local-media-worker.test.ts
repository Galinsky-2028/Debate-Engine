import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/media-prepare.worker.js',import.meta.url),'utf8');
async function prepare(bytes:Buffer,origin=''){
 let result:any;
 const self:any={location:{origin:'https://example.test'},postMessage:(r:unknown)=>{result=r;}};
 vm.runInNewContext(source,{self,Blob,crypto:webcrypto,Uint8Array,DataView,BigInt,Number,String,Error});
 await self.onmessage({origin,data:{file:new Blob([Uint8Array.from(bytes)])}});
 return result;
}
function box(type:string,payload:Buffer){const result=Buffer.alloc(8+payload.length);result.writeUInt32BE(result.length);result.write(type,4);payload.copy(result,8);return result;}
test('local preparation hashes exact bytes and reads bounded MP4 movie duration without rendering uploaded content',async()=>{
 const header=box('ftyp',Buffer.from('isom0000'));
 const mvhd=Buffer.alloc(24);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(2500,16);
 const file=Buffer.concat([header,box('moov',box('mvhd',mvhd)),Buffer.alloc(64)]);
 const r=await prepare(file);
 assert.equal(r.sha256,createHash('sha256').update(file).digest('hex'));assert.equal(r.durationSeconds,2.5);
 assert.equal((await prepare(Buffer.from('Fictional unsupported container. '.repeat(4)))).durationSeconds,null);
 assert.equal(await prepare(file,'https://untrusted.example'),undefined);
});
test('truncated and oversized MP4 boxes cannot read outside the uploaded original',async()=>{
 const data=Buffer.alloc(80);data.writeUInt32BE(16);data.write('ftyp',4);data.writeUInt32BE(0xffffffff,16);data.write('moov',20);
 assert.equal((await prepare(data)).durationSeconds,null);
 const result=await prepare(Buffer.alloc(10));assert.match(result.error,/between 64 bytes and 60 MiB/);
});
