import 'server-only';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {database,transaction} from './db';
import {HttpError} from './http';
import {playOriginal} from './storage';
import {usesLaptopScanner} from './scanner-status';

export function requireScannerWorker(request:NextRequest){
 const expected=process.env.SCANNER_WORKER_TOKEN||'';
 const received=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 // Hash before constant-time comparison so unequal input lengths cannot throw.
 if(!usesLaptopScanner()||expected.length<64||received.length>256||!timingSafeEqual(createHash('sha256').update(expected).digest(),createHash('sha256').update(received).digest()))
  throw new HttpError(401,'A paired platform scanner is required.');
}
export async function claimScan(){
 const row=await transaction(async db=>{
  await db.query("INSERT INTO media_scanner_heartbeat(id,last_seen_at) VALUES(true,now()) ON CONFLICT(id) DO UPDATE SET last_seen_at=now()");
  return db.query<{id:string;original_sha256:string;storage_key:string;size_bytes:string;lease_token:string}>(
   "UPDATE media_scan_jobs SET lease_token=$1,lease_expires_at=now()+interval '2 minutes' WHERE id=(SELECT id FROM media_scan_jobs WHERE status='pending' AND created_at>now()-interval '24 hours' AND (lease_expires_at IS NULL OR lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",[randomUUID()]);
 });
 if(!row.rowCount)return null;
 const job=row.rows[0];
 return {id:job.id,sha256:job.original_sha256,sizeBytes:Number(job.size_bytes),leaseToken:job.lease_token,downloadUrl:await playOriginal(job.storage_key)};
}
export async function completeScan(input:{id:string;sha256:string;leaseToken:string;verdict:'clean'|'detected'|'unavailable'}){
 if(!/^[0-9a-f]{64}$/.test(input.sha256))throw new HttpError(400,'Invalid original digest.');
 const result=input.verdict==='unavailable'
  ?await database().query("UPDATE media_scan_jobs SET lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND original_sha256=$2 AND lease_token=$3 AND lease_expires_at>now() AND status='pending' RETURNING id",[input.id,input.sha256,input.leaseToken])
  :await database().query("UPDATE media_scan_jobs SET status=$4,completed_at=now() WHERE id=$1 AND original_sha256=$2 AND lease_token=$3 AND lease_expires_at>now() AND status='pending' RETURNING id",[input.id,input.sha256,input.leaseToken,input.verdict]);
 if(!result.rowCount)throw new HttpError(409,'Scan lease expired, was already used, or does not match this original.');
}
export async function scanOnLaptop(bytes:Buffer,storageKey:string){
 const digest=createHash('sha256').update(bytes).digest('hex');
 await database().query("INSERT INTO media_scan_jobs(original_sha256,storage_key,size_bytes) VALUES($1,$2,$3) ON CONFLICT(original_sha256) DO NOTHING",[digest,storageKey,bytes.length]);
 for(let attempt=0;attempt<20;attempt++){
  const result=await database().query<{status:string}>("SELECT status FROM media_scan_jobs WHERE original_sha256=$1",[digest]);
  if(result.rows[0]?.status==='clean')return {scanner:'clamav' as const,verdict:'clean' as const};
  if(result.rows[0]?.status==='detected')throw new HttpError(422,'The original was rejected by the required media safety scan.');
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw new HttpError(503,'Your original is saved and waiting for the paired laptop scanner. Keep the scanner running, then retry validation.');
}
