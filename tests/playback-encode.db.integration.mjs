import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {CLAIM_PLAYBACK_SQL,COMPLETE_PLAYBACK_SQL,ENQUEUE_PLAYBACK_SQL,FAIL_PLAYBACK_SQL,PLAYBACK_FOR_MEDIA_SQL,ENCODE_MAX_ATTEMPTS} from "../packages/domain/playback.ts";
if(!process.env.DATABASE_URL)throw Error("A disposable PostgreSQL DATABASE_URL is required.");

// Fictional fixtures only; every test runs in a transaction that is rolled back.
async function withDb(fn){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{await db.query("BEGIN");await fn(db);}
 finally{await db.query("ROLLBACK");await db.end();}
}
async function rejects(db,sql,params,pattern){
 await db.query("SAVEPOINT r");
 try{await db.query(sql,params);}catch(e){await db.query("ROLLBACK TO SAVEPOINT r");if(pattern)assert.match(e.message,pattern);return;}
 await db.query("ROLLBACK TO SAVEPOINT r");assert.fail("Expected rejection: "+sql);
}
async function published(db,{mime="video/mp4",publish=true}={}){
 const uid="encode-"+randomUUID();
 const acct=(await db.query("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture',$1,'Fictional') RETURNING id",[uid])).rows[0].id;
 const office=(await db.query("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional office','Test') RETURNING id",[uid])).rows[0].id;
 const election=(await db.query("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','Test') RETURNING id",[office])).rows[0].id;
 const cand=(await db.query("INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,'Fictional','verified') RETURNING id",[acct,election])).rows[0].id;
 const sha=randomUUID().replace(/-/g,"").padEnd(64,"0");
 const media=(await db.query("INSERT INTO media_assets(owner_candidacy_id,storage_key,original_sha256,size_bytes,mime_type,duration_seconds,processing_status) VALUES($1,$2,$3,1024,$4,60,'ready') RETURNING id",[cand,uid+"/original",sha,mime])).rows[0].id;
 const modality=mime.startsWith("audio/")?"audio":"video";
 const debate=(await db.query("INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,allowed_modalities) VALUES($1,$2,'Fixture','A fictional proposition.',300,ARRAY['video','audio','writing']) RETURNING id",[election,cand])).rows[0].id;
 const opening=(await db.query("INSERT INTO submissions(debate_id,candidacy_id,media_asset_id,modality,kind) VALUES($1,$2,$3,$4,'opening') RETURNING id",[debate,cand,media,modality])).rows[0].id;
 await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,video_timestamp_seconds) VALUES($1,$2,1,'A fictional question?',10)",[opening,cand]);
 if(publish){
  await db.query("UPDATE submissions SET published_at=now() WHERE id=$1",[opening]);
  await db.query("UPDATE debates SET status='published',published_at=now() WHERE id=$1",[debate]);
 }
 return {media,sha};
}
async function encodeFor(db,media){return (await db.query("SELECT * FROM media_playback_encodes WHERE media_asset_id=$1",[media])).rows[0];}

test("only published, ready originals are queued, once, with the matching profile",()=>withDb(async db=>{
 const video=await published(db),audio=await published(db,{mime:"audio/mpeg"}),draft=await published(db,{publish:false});
 await db.query(ENQUEUE_PLAYBACK_SQL,[1000]);
 await db.query(ENQUEUE_PLAYBACK_SQL,[1000]);
 assert.equal((await encodeFor(db,video.media)).profile,"video-720p-h264");
 assert.equal((await encodeFor(db,audio.media)).profile,"audio-aac-128k");
 assert.equal(await encodeFor(db,draft.media),undefined);
 assert.equal((await db.query("SELECT count(*)::int n FROM media_playback_encodes WHERE media_asset_id=$1",[video.media])).rows[0].n,1);
 await rejects(db,"INSERT INTO media_playback_encodes(media_asset_id,source_sha256,profile) VALUES($1,$2,'video-720p-h264')",[draft.media,"f".repeat(64)],/ready original/);
}));

test("a lease completes once, the ready rendition is immutable, and plays instead of the original",()=>withDb(async db=>{
 const {media}=await published(db);
 await db.query(ENQUEUE_PLAYBACK_SQL,[1000]);
 // claim until we get our fixture (other pending rows may exist in a shared database)
 let lease;
 for(let i=0;i<50&&!lease;i++){const r=(await db.query(CLAIM_PLAYBACK_SQL,[randomUUID()])).rows[0];if(!r)break;if(r.media_asset_id===media)lease=r;}
 assert.ok(lease,"the fixture encode is claimable");
 assert.equal((await db.query(CLAIM_PLAYBACK_SQL,[randomUUID()])).rows.find(r=>r.media_asset_id===media),undefined,"a leased job is not claimed twice");
 assert.equal((await db.query(COMPLETE_PLAYBACK_SQL,[lease.id,randomUUID(),"playback/x.mp4","c".repeat(64),10,"video/mp4"])).rowCount,0,"wrong lease");
 assert.equal((await db.query(COMPLETE_PLAYBACK_SQL,[lease.id,lease.lease_token,"playback/"+media+".mp4","c".repeat(64),10,"video/mp4"])).rowCount,1);
 assert.equal((await db.query(COMPLETE_PLAYBACK_SQL,[lease.id,lease.lease_token,"playback/other.mp4","d".repeat(64),10,"video/mp4"])).rowCount,0,"no second completion");
 await rejects(db,"UPDATE media_playback_encodes SET output_sha256=$2 WHERE id=$1",[lease.id,"e".repeat(64)],/immutable/);
 await rejects(db,"DELETE FROM media_playback_encodes WHERE id=$1",[lease.id],/retained/);
 const play=(await db.query(PLAYBACK_FOR_MEDIA_SQL,[media])).rows[0];
 assert.equal(play.status,"ready");assert.equal(play.storage_key,"playback/"+media+".mp4");
}));

test("failed attempts retry, then stop; the original keeps playing",()=>withDb(async db=>{
 const {media}=await published(db);
 await db.query(ENQUEUE_PLAYBACK_SQL,[1000]);
 const id=(await encodeFor(db,media)).id;
 // isolate: lease our row directly by giving every other pending row a future lease
 await db.query("UPDATE media_playback_encodes SET lease_expires_at=now()+interval '1 hour' WHERE status='pending' AND id<>$1",[id]);
 for(let attempt=1;attempt<=ENCODE_MAX_ATTEMPTS;attempt++){
  const lease=(await db.query(CLAIM_PLAYBACK_SQL,[randomUUID()])).rows[0];
  assert.equal(lease.id,id);
  const status=(await db.query(FAIL_PLAYBACK_SQL,[id,lease.lease_token,"fictional failure"])).rows[0].status;
  assert.equal(status,attempt<ENCODE_MAX_ATTEMPTS?"pending":"failed");
 }
 assert.equal((await db.query(CLAIM_PLAYBACK_SQL,[randomUUID()])).rowCount,0);
 assert.equal((await db.query(PLAYBACK_FOR_MEDIA_SQL,[media])).rows[0].status,"failed");
 await rejects(db,"UPDATE media_playback_encodes SET status='ready' WHERE id=$1",[id]);
}));
