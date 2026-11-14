// Plan 11.2 and 12: distributing a released summary needs a current, separate 'distribute' grant from every source
// owner (migration 0033). Explicitly fictional fixtures; transactional tests roll back.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {exactManifestHash} from "../packages/domain/rights.ts";
import {grantDistributePermission,distributePermissionStatus,missingDistributePermissionMessage} from "../lib/server/distribute-permissions.ts";
import {enqueueAction,processOutbox} from "../packages/delivery/outbox-store.ts";
import {debateFixture,refused} from "./policy-media-fixture.mjs";

if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL.");
async function signIn(db,candidacy){
 const subject="fictional-subject-"+randomUUID();
 await db.query("UPDATE accounts SET identity_provider='neon-auth',external_subject=$2 WHERE id=(SELECT account_id FROM candidacies WHERE id=$1)",[candidacy,subject]);
 return subject;
}
async function releasedSummary(db,f){
 const m={branchId:f.branchAB,clips:[{mediaAssetId:f.videoA,startSeconds:0,endSeconds:10},{mediaAssetId:f.videoB,startSeconds:5,endSeconds:15},{mediaAssetId:f.videoA,startSeconds:20,endSeconds:25}],
  captions:[],outputKind:"one_minute",releaseTitle:"Fictional distribution summary"};
 const hash=exactManifestHash(m);
 const id=(await db.query("INSERT INTO derivative_artifacts(branch_id,output_sha256,manifest_sha256,source_manifest,status) VALUES($1,$2,$2,$3::jsonb,'draft') RETURNING id",[f.branchAB,hash,JSON.stringify(m)])).rows[0].id;
 const edit=async(owner,media,start,end)=>(await db.query("INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'edit',$3::jsonb) RETURNING id",[owner,media,JSON.stringify({artifactId:id,clipStart:start,clipEnd:end})])).rows[0].id;
 await edit(f.a,f.videoA,0,25);await edit(f.b,f.videoB,5,15);
 const sha="7".repeat(64);
 await db.query("UPDATE derivative_artifacts SET output_sha256=$2,rendered_storage_key=$3,rendered_at=now(),status='awaiting_approval' WHERE id=$1",[id,sha,"fixture-render/"+id]);
 for(const who of [f.a,f.b])await db.query("INSERT INTO derivative_approvals(artifact_id,output_sha256,candidacy_id) VALUES($1,$2,$3)",[id,sha,who]);
 await db.query("UPDATE derivative_artifacts SET status='approved' WHERE id=$1",[id]);
 await db.query("UPDATE derivative_artifacts SET status='released' WHERE id=$1",[id]);
 return id;
}
async function distributionDestination(db,candidacy){
 const account=(await db.query("SELECT account_id FROM candidacies WHERE id=$1",[candidacy])).rows[0].account_id;
 const id=(await db.query("INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address) VALUES($1,$2,'email',ARRAY['distribution'],'Fictional press list',$3) RETURNING id",
  [candidacy,account,`press-${randomUUID().slice(0,8)}@example.org`])).rows[0].id;
 await db.query("UPDATE delivery_destinations SET verified_at=now() WHERE id=$1",[id]);
 return id;
}
const distribute=(db,f,dest,artifact,key=randomUUID())=>enqueueAction(db,{actionType:"distribution",destinationId:dest,ownerCandidacyId:f.a,dedupeKey:"distribution:"+key,
 debateId:f.debate,branchId:f.branchAB,subjectKind:"derivative_artifact",subjectId:artifact,payload:{type:"pde.distribution.released_summary",data:{fixture:true},email:{subject:"Fictional",text:"Fictional"}}});
const current=async(db,id)=>(await db.query("SELECT public.pde_artifact_distribute_grants_current($1) AS ok",[id])).rows[0].ok;
async function rejectsHttp(promise,status){
 await assert.rejects(promise,e=>e.status===status||(console.error(e),false));
}
async function withFixture(run){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{await run(db,await debateFixture(db));}finally{await db.query("ROLLBACK");await db.end();}
}
async function inSavepoint(db,fn){
 await db.query("SAVEPOINT attempt");
 try{const r=await fn();await db.query("RELEASE SAVEPOINT attempt");return r;}
 catch(e){await db.query("ROLLBACK TO SAVEPOINT attempt");await db.query("RELEASE SAVEPOINT attempt");throw e;}
}

test("only the verified owner can grant distribute, only for a summary that uses their video",()=>withFixture(async(db,f)=>{
 const art=await releasedSummary(db,f);
 const subjectA=await signIn(db,f.a),subjectB=await signIn(db,f.b);
 await rejectsHttp(inSavepoint(db,()=>grantDistributePermission(db,{mediaId:f.videoA,candidateId:f.b,authSubject:subjectB,artifactId:art})),403);
 await rejectsHttp(inSavepoint(db,()=>grantDistributePermission(db,{mediaId:f.videoA,candidateId:f.a,authSubject:subjectB,artifactId:art})),403);
 const subjectC=await signIn(db,f.c);
 await rejectsHttp(inSavepoint(db,()=>grantDistributePermission(db,{mediaId:f.videoC,candidateId:f.c,authSubject:subjectC,artifactId:art})),400);
 // Database defense in depth: a non-owner row and a summary that does not use the video are refused.
 await refused(db,"INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'distribute',$3::jsonb)",[f.b,f.videoA,JSON.stringify({artifactId:art})]);
 await refused(db,"INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'distribute',$3::jsonb)",[f.c,f.videoC,JSON.stringify({artifactId:art})]);
 await refused(db,"INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'distribute','{}'::jsonb)",[f.a,f.videoA]);
 await refused(db,"INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'distribute',$3::jsonb)",[f.a,f.videoA,JSON.stringify({artifactId:art,clipStart:9,clipEnd:3})]);
 const granted=await grantDistributePermission(db,{mediaId:f.videoA,candidateId:f.a,authSubject:subjectA,artifactId:art});
 assert.ok(granted.permissionId);
 await rejectsHttp(inSavepoint(db,()=>grantDistributePermission(db,{mediaId:f.videoA,candidateId:f.a,authSubject:subjectA,artifactId:art})),409);
 const event=(await db.query("SELECT payload FROM publication_events WHERE kind='media_distribution_permission_granted' AND object_id=$1",[granted.permissionId])).rows[0];
 assert.deepEqual(event.payload,{artifactId:art,permission:"distribute"});
}));

test("edit grants alone are insufficient; each owner's current distribute grant is required; revocation blocks again",()=>withFixture(async(db,f)=>{
 const art=await releasedSummary(db,f);
 const dest=await distributionDestination(db,f.a);
 const edits=(await db.query("SELECT public.pde_artifact_edit_grants_current($1) AS ok",[art])).rows[0].ok;
 assert.equal(edits,true,"both edit grants are current");
 assert.equal(await current(db,art),false,"edit grants alone do not authorize distribution");
 let status=await distributePermissionStatus(db,art);
 assert.deepEqual(status.map(s=>[s.ownerName,s.state]).sort(),[["Fictional Candidate A","missing"],["Fictional Candidate B","missing"]]);
 assert.match(missingDistributePermissionMessage(status),/Fictional Candidate A has not granted distribution permission; Fictional Candidate B has not granted/);
 await refused(db,"INSERT INTO outgoing_actions(action_type,destination,dedupe_key,payload,destination_id,owner_candidacy_id,subject_kind,subject_id) VALUES('distribution','destination:'||$1::uuid::text,'x','{}'::jsonb,$1::uuid,$2,'derivative_artifact',$3)",[dest,f.a,art]);

 const subjectA=await signIn(db,f.a),subjectB=await signIn(db,f.b);
 await grantDistributePermission(db,{mediaId:f.videoA,candidateId:f.a,authSubject:subjectA,artifactId:art});
 status=await distributePermissionStatus(db,art);
 assert.equal(missingDistributePermissionMessage(status),"This summary cannot be distributed: Fictional Candidate B has not granted distribution permission. Approving the edit is a separate permission from distributing the result.");
 await assert.rejects(inSavepoint(db,()=>distribute(db,f,dest,art)),/currently grant distribution/);

 const b=await grantDistributePermission(db,{mediaId:f.videoB,candidateId:f.b,authSubject:subjectB,artifactId:art});
 assert.equal(await current(db,art),true);
 assert.equal(missingDistributePermissionMessage(await distributePermissionStatus(db,art)),null);
 assert.equal((await distribute(db,f,dest,art)).created,true);

 await db.query("INSERT INTO media_permission_revocations(permission_id,candidate_id) VALUES($1,$2)",[b.permissionId,f.b]);
 assert.equal(await current(db,art),false,"a revoked distribute grant counts as absent");
 assert.match(missingDistributePermissionMessage(await distributePermissionStatus(db,art)),/Fictional Candidate B withdrew distribution permission/);
 await assert.rejects(inSavepoint(db,()=>distribute(db,f,dest,art)),/currently grant distribution/);
 // A fresh grant restores eligibility; the revocation stays recorded.
 await grantDistributePermission(db,{mediaId:f.videoB,candidateId:f.b,authSubject:subjectB,artifactId:art});
 assert.equal(await current(db,art),true);
 // A withdrawn EDIT grant still blocks distribution even with current distribute grants (existing re-check kept).
 const editB=(await db.query("SELECT id FROM media_permissions WHERE candidate_id=$1 AND permission='edit' AND scope->>'artifactId'=$2",[f.b,art])).rows[0].id;
 await db.query("INSERT INTO media_permission_revocations(permission_id,candidate_id) VALUES($1,$2)",[editB,f.b]);
 await assert.rejects(inSavepoint(db,()=>distribute(db,f,dest,art)),/currently grant distribution/);
}));

test("clip-scoped distribute grants must cover every clip of the owner's video",()=>withFixture(async(db,f)=>{
 const art=await releasedSummary(db,f);
 const grant=(owner,media,scope)=>db.query("INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'distribute',$3::jsonb) RETURNING id",[owner,media,JSON.stringify({artifactId:art,...scope})]);
 await grant(f.b,f.videoB,{});
 await grant(f.a,f.videoA,{clipStart:0,clipEnd:10}); // A's video is used at 0–10 and 20–25
 assert.equal(await current(db,art),false);
 await grant(f.a,f.videoA,{clipStart:0,clipEnd:30});
 assert.equal(await current(db,art),true);
}));

test("policy press-kit distribution needs no media grant; source-level wiring",async()=>{
 await withFixture(async(db,f)=>{
  const dest=await distributionDestination(db,f.a);
  const r=await enqueueAction(db,{actionType:"distribution",destinationId:dest,ownerCandidacyId:f.a,dedupeKey:"policy:"+randomUUID(),debateId:f.debate,branchId:f.branchAB,
   subjectKind:"policy_version",subjectId:randomUUID(),payload:{type:"pde.distribution.agreed_policy",data:{},email:{subject:"Fictional",text:"Fictional"}}});
  assert.equal(r.created,true);
 });
 const distributions=await readFile("lib/server/distributions.ts","utf8");
 assert.match(distributions,/ARTIFACT_GRANTS_CURRENT_SQL/,"the edit-grant re-check is kept");
 assert.match(distributions,/restriction_cases/,"the restriction re-check is kept");
 assert.match(distributions,/missingDistributePermissionMessage\(await distributePermissionStatus\(db, input\.artifactId\)\)/);
 assert.match(distributions,/if \(missing\) throw new HttpError\(409, missing\)/);
 const route=await readFile("app/api/media/[id]/distribute-permissions/route.ts","utf8");
 assert.match(route,/requireSameOrigin\(request\)/);assert.match(route,/requireIdentity\(true\)/);
});

test("a queued summary distribution is not sent after the owner withdraws distribute permission",async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 try{
  const f=await debateFixture(pool);
  const art=await releasedSummary(pool,f);
  const subjectA=await signIn(pool,f.a),subjectB=await signIn(pool,f.b);
  const client=await pool.connect();
  try{
   await grantDistributePermission(client,{mediaId:f.videoA,candidateId:f.a,authSubject:subjectA,artifactId:art});
   var b=await grantDistributePermission(client,{mediaId:f.videoB,candidateId:f.b,authSubject:subjectB,artifactId:art});
  }finally{client.release();}
  const dest=await distributionDestination(pool,f.a);
  const queued=await distribute(pool,f,dest,art);
  await pool.query("INSERT INTO media_permission_revocations(permission_id,candidate_id) VALUES($1,$2)",[b.permissionId,f.b]);
  const sent=[];
  const adapters={webhook:async r=>{sent.push(r.actionId);return {kind:"delivered",receipt:"fixture"};},email:async r=>{sent.push(r.actionId);return {kind:"accepted",receipt:"fixture"};}};
  for(let i=0;i<5&&!(await pool.query("SELECT state FROM outgoing_actions WHERE id=$1",[queued.id])).rows[0].state.match(/dead|accepted|delivered/);i++)
   await processOutbox(pool,{limit:100,adapters});
  const row=(await pool.query("SELECT state,last_error,accepted_at FROM outgoing_actions WHERE id=$1",[queued.id])).rows[0];
  assert.equal(row.state,"dead");assert.equal(row.accepted_at,null);
  assert.match(row.last_error,/withdrew/);
  assert.equal(sent.includes(queued.id),false,"nothing was handed to a provider");
 }finally{await pool.end();}
});
