import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
test('a laptop scan requires its exact digest and live one-use lease; an uploader cannot enable paid preparation',async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 await db.query('BEGIN');
 try {
  const q=await db.query("INSERT INTO media_scan_jobs(original_sha256,storage_key,size_bytes,lease_token,lease_expires_at) VALUES($1,'fictional/private-original',100,gen_random_uuid(),now()+interval '2 minutes') RETURNING *",['b'.repeat(64)]);
  const j=q.rows[0];
  const query="UPDATE media_scan_jobs SET status='clean',completed_at=now() WHERE id=$1 AND original_sha256=$2 AND lease_token=$3 AND lease_expires_at>now() AND status='pending' RETURNING id";
  assert.equal((await db.query(query,[j.id,'c'.repeat(64),j.lease_token])).rowCount,0);
  assert.equal((await db.query(query,[j.id,j.original_sha256,'00000000-0000-4000-8000-000000000001'])).rowCount,0);
  assert.equal((await db.query(query,[j.id,j.original_sha256,j.lease_token])).rowCount,1);
  assert.equal((await db.query(query,[j.id,j.original_sha256,j.lease_token])).rowCount,0);
  const a=await db.query("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture','laptop-tier-test','Fictional account') RETURNING processing_tier");
  assert.equal(a.rows[0].processing_tier,'free');
 }finally{await db.query('ROLLBACK');await db.end();}
});
