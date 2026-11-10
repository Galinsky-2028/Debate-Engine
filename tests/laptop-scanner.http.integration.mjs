/** Real Next.js + disposable local Postgres + private S3 + actual ClamAV. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {S3Client,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {inspectScannerJob} from '../packages/media/laptop-worker.ts';
const origin=process.env.PDE_BROWSER_URL;
const dbUrl=process.env.DATABASE_URL;
if(origin!=='http://127.0.0.1:3100'||!/^postgresql:\/\/debate_ci:[^@]+@127\.0\.0\.1:5432\/debate_ci$/.test(dbUrl||''))throw Error('This fixture test requires the disposable local database and localhost application.');
const token=process.env.SCANNER_WORKER_TOKEN;
const endpoint=process.env.AWS_ENDPOINT_URL_S3;
const bucket=process.env.MEDIA_BUCKET;
const client=new S3Client({endpoint,region:process.env.AWS_REGION,forcePathStyle:true});
const db=new pg.Client({connectionString:dbUrl});await db.connect();
const key='operations/scanner-http-test/'+randomUUID();
const bytes=Buffer.from('Fictional unedited media scanner protocol test. '.repeat(20));
const digest=createHash('sha256').update(bytes).digest('hex');
let jobId;
async function post(path,body,auth=token){return fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)});}
try {
 const upload=await getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key}),{expiresIn:120});
 assert.ok((await fetch(upload,{method:'PUT',body:bytes})).ok);
 const inserted=await db.query('INSERT INTO media_scan_jobs(original_sha256,storage_key,size_bytes) VALUES($1,$2,$3) RETURNING id',[digest,key,bytes.length]);
 jobId=inserted.rows[0].id;
 assert.equal((await post('/api/scanner/jobs',{},'wrong-token')).status,401);
 const claimed=await post('/api/scanner/jobs',{});assert.equal(claimed.status,200);
 const {job}=await claimed.json();assert.equal(job.id,jobId);
 assert.equal((await (await post('/api/scanner/jobs',{})).json()).job,null,'A live lease must not be claimed twice.');
 assert.equal(await inspectScannerJob(job,process.env.CLAMD_SOCKET_PATH),'clean');
 const payload={sha256:job.sha256,leaseToken:job.leaseToken,verdict:'clean'};
 assert.equal((await post('/api/scanner/jobs/'+job.id,{...payload,sha256:'0'.repeat(64)})).status,409);
 assert.equal((await post('/api/scanner/jobs/'+job.id,{...payload,leaseToken:randomUUID()})).status,409);
 assert.equal((await post('/api/scanner/jobs/'+job.id,payload,'not-paired')).status,401);
 assert.equal((await post('/api/scanner/jobs/'+job.id,payload)).status,200);
 assert.equal((await post('/api/scanner/jobs/'+job.id,payload)).status,409,'A scan result cannot be replayed.');
 assert.equal((await db.query('SELECT status FROM media_scan_jobs WHERE id=$1',[job.id])).rows[0].status,'clean');
 const online=await (await fetch(origin+'/api/capabilities')).json();assert.equal(online.mediaScanner,'online');
 await db.query("UPDATE media_scanner_heartbeat SET last_seen_at=now()-interval '1 minute'");
 const offline=await (await fetch(origin+'/api/capabilities')).json();assert.equal(offline.newMediaUploadPreflight,'blocked');
 console.log('PASS: actual Next.js/ClamAV/private-storage scan round trip, authorization, digest binding, exclusive leases, replay rejection and offline fail-closed behavior.');
} finally {
 if(jobId)await db.query('DELETE FROM media_scan_jobs WHERE id=$1',[jobId]);
 await db.end();
 const cleanup=await getSignedUrl(client,new DeleteObjectCommand({Bucket:bucket,Key:key}),{expiresIn:60});
 assert.ok((await fetch(cleanup,{method:'DELETE'})).ok);client.destroy();
}
