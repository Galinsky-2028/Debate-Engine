import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {exactManifestHash} from "../packages/domain/rights.ts";
import {ARTIFACT_GRANTS_CURRENT_SQL,FUTURE_USE_WITHDRAWALS_SQL} from "../lib/server/policy-agreement-sql.ts";
import {debateFixture,refused} from "./policy-media-fixture.mjs";

if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL.");
async function withFixture(run){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{await run(db,await debateFixture(db));}finally{await db.query("ROLLBACK");await db.end();}
}
function manifest(f,overrides={}){
 return {branchId:f.branchAB,clips:[{mediaAssetId:f.videoA,startSeconds:0,endSeconds:10},{mediaAssetId:f.videoB,startSeconds:5,endSeconds:15}],
  captions:[],outputKind:"one_minute",releaseTitle:"Fictional summary",...overrides};
}
async function artifact(db,f,m){
 const hash=exactManifestHash(m);
 const id=(await db.query("INSERT INTO derivative_artifacts(branch_id,output_sha256,manifest_sha256,source_manifest,status) VALUES($1,$2,$2,$3::jsonb,'draft') RETURNING id",[f.branchAB,hash,JSON.stringify(m)])).rows[0].id;
 return {id,hash,m};
}
async function grant(db,owner,media,artifactId,start,end,permission="edit"){
 return (await db.query("INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,$3,$4::jsonb) RETURNING id",
  [owner,media,permission,JSON.stringify({artifactId,clipStart:start,clipEnd:end})])).rows[0].id;
}
const current=async(db,id)=>(await db.query(ARTIFACT_GRANTS_CURRENT_SQL,[id])).rows[0].current;
async function rendered(db,art,sha){
 await db.query("UPDATE derivative_artifacts SET output_sha256=$2,rendered_storage_key=$3,rendered_at=now(),status='awaiting_approval' WHERE id=$1",[art.id,sha,"fixture-render/"+art.id]);
}
const revoke="INSERT INTO media_permission_revocations(permission_id,candidate_id,reason) VALUES($1,$2,$3) RETURNING revoked_at";

test("only the granting owner may revoke, and only optional grants are revocable",()=>withFixture(async(db,f)=>{
 const art=await artifact(db,f,manifest(f));
 const editA=await grant(db,f.a,f.videoA,art.id,0,10);
 const distributeA=await grant(db,f.a,f.videoA,art.id,0,10,"distribute");
 const archiveA=(await db.query("INSERT INTO media_permissions(candidate_id,media_asset_id,permission) VALUES($1,$2,'archive') RETURNING id",[f.a,f.videoA])).rows[0].id;
 const sequenceA=(await db.query("INSERT INTO media_permissions(candidate_id,media_asset_id,permission) VALUES($1,$2,'sequence') RETURNING id",[f.a,f.videoA])).rows[0].id;
 await refused(db,revoke,[editA,f.b,null]);                    // opponent cannot revoke A's grant
 await refused(db,revoke,[editA,f.c,"third party"]);
 await refused(db,revoke,[archiveA,f.a,null]);                 // publication obligations are not revocable
 await refused(db,revoke,[sequenceA,f.a,null]);
 await refused(db,revoke,[editA,f.a,"x".repeat(1001)]);
 const backdated=(await db.query("INSERT INTO media_permission_revocations(permission_id,candidate_id,revoked_at) VALUES($1,$2,'2001-01-01') RETURNING revoked_at",[distributeA,f.a])).rows[0].revoked_at;
 assert.ok(new Date(backdated).getFullYear()>2001,"Revocation time is set by the database, never backdated.");
 await db.query(revoke,[editA,f.a,"Changed my mind"]);
 await refused(db,revoke,[editA,f.a,null],["23505"]);          // one revocation per grant
 await refused(db,"DELETE FROM media_permission_revocations WHERE permission_id=$1",[editA],["55000"]);
 await refused(db,"UPDATE media_permission_revocations SET reason=NULL WHERE permission_id=$1",[editA],["55000"]);
 await refused(db,"DELETE FROM media_permissions WHERE id=$1",[editA],["55000","23503"]);
}));

test("a revoked edit grant counts as absent: rendering, approval and release fail closed",()=>withFixture(async(db,f)=>{
 const art=await artifact(db,f,manifest(f));
 const editA=await grant(db,f.a,f.videoA,art.id,0,10);
 assert.equal(await current(db,art.id),false,"B has not granted yet: a refused optional permission blocks the derivative.");
 await refused(db,"UPDATE derivative_artifacts SET output_sha256=$2,rendered_storage_key='fixture-render/x',status='awaiting_approval' WHERE id=$1",[art.id,"9".repeat(64)]);
 // The original public record is unaffected by the missing optional permission.
 assert.ok((await db.query("SELECT published_at FROM submissions WHERE id=$1",[f.responseB])).rows[0].published_at);
 const editB=await grant(db,f.b,f.videoB,art.id,5,15);
 assert.equal(await current(db,art.id),true);
 const sha="9".repeat(64);
 await rendered(db,art,sha);
 await db.query("INSERT INTO derivative_approvals(artifact_id,output_sha256,candidacy_id) VALUES($1,$2,$3)",[art.id,sha,f.a]);
 await db.query(revoke,[editB,f.b,null]);
 assert.equal(await current(db,art.id),false);
 await refused(db,"INSERT INTO derivative_approvals(artifact_id,output_sha256,candidacy_id) VALUES($1,$2,$3)",[art.id,sha,f.b]);
 await refused(db,"UPDATE derivative_artifacts SET status='approved' WHERE id=$1",[art.id]);
 await refused(db,"UPDATE derivative_artifacts SET status='released' WHERE id=$1",[art.id]);
 // A fresh, separate grant by the owner restores eligibility; the revocation stays in the record.
 await grant(db,f.b,f.videoB,art.id,5,15);
 assert.equal(await current(db,art.id),true);
 assert.equal((await db.query("SELECT count(*)::int n FROM media_permission_revocations WHERE permission_id=$1",[editB])).rows[0].n,1);
 assert.ok(editA);
}));

test("an already released summary stays released with a dated future-use notice",()=>withFixture(async(db,f)=>{
 const art=await artifact(db,f,manifest(f));
 const editA=await grant(db,f.a,f.videoA,art.id,0,10);await grant(db,f.b,f.videoB,art.id,5,15);
 const sha="8".repeat(64);
 await rendered(db,art,sha);
 for(const who of [f.a,f.b])await db.query("INSERT INTO derivative_approvals(artifact_id,output_sha256,candidacy_id) VALUES($1,$2,$3)",[art.id,sha,who]);
 await db.query("UPDATE derivative_artifacts SET status='approved' WHERE id=$1",[art.id]);
 await db.query("UPDATE derivative_artifacts SET status='released' WHERE id=$1",[art.id]);
 assert.equal((await db.query(FUTURE_USE_WITHDRAWALS_SQL,[f.branchAB])).rowCount,0);
 await db.query(revoke,[editA,f.a,"private reason"]);
 const row=(await db.query("SELECT status,rendered_storage_key FROM derivative_artifacts WHERE id=$1",[art.id])).rows[0];
 assert.equal(row.status,"released");assert.ok(row.rendered_storage_key,"Released file remains downloadable.");
 const notices=(await db.query(FUTURE_USE_WITHDRAWALS_SQL,[f.branchAB])).rows;
 assert.equal(notices.length,1);assert.equal(notices[0].owner_name,"Fictional Candidate A");assert.ok(notices[0].revoked_at);
 assert.ok(!("reason" in notices[0]),"The private reason is never part of the public notice.");
 // Public download handler still finds it.
 const download=await readFile("app/api/branches/[id]/derivatives/[artifactId]/download/route.ts","utf8");
 const sql=download.match(/database\(\)\.query<[^>]*>\("([^"]+)"/)[1];
 assert.equal((await db.query(sql,[art.id,f.branchAB])).rowCount,1);
}));

test("editor changes an approved clip by one cut or caption: prior approval cannot authorize the new artifact",()=>withFixture(async(db,f)=>{
 const x=await artifact(db,f,manifest(f));
 const oneCut=manifest(f,{clips:[{mediaAssetId:f.videoA,startSeconds:0,endSeconds:9.5},{mediaAssetId:f.videoB,startSeconds:5,endSeconds:15}]});
 const oneCaption=manifest(f,{captions:["Added context card"]});
 const oneTitle=manifest(f,{releaseTitle:"Fictional summary (revised)"});
 const hashes=new Set([x.hash,exactManifestHash(oneCut),exactManifestHash(oneCaption),exactManifestHash(oneTitle)]);
 assert.equal(hashes.size,4,"Every edit produces a distinct manifest digest.");
 await grant(db,f.a,f.videoA,x.id,0,10);await grant(db,f.b,f.videoB,x.id,5,15);
 const sha="7".repeat(64);
 await rendered(db,x,sha);
 for(const who of [f.a,f.b])await db.query("INSERT INTO derivative_approvals(artifact_id,output_sha256,candidacy_id) VALUES($1,$2,$3)",[x.id,sha,who]);
 for(const changed of [oneCut,oneCaption]){
  const y=await artifact(db,f,changed);
  // X's grants are scoped to X's artifact id; Y has none of its own.
  assert.equal(await current(db,y.id),false);
  // X's approval digest cannot be attached to Y.
  await refused(db,"INSERT INTO derivative_approvals(artifact_id,output_sha256,candidacy_id) VALUES($1,$2,$3)",[y.id,sha,f.a],["23503","23514"]);
  assert.equal((await db.query("SELECT count(*)::int n FROM derivative_approvals WHERE artifact_id=$1",[y.id])).rows[0].n,0);
  await refused(db,"UPDATE derivative_artifacts SET status='released' WHERE id=$1",[y.id]);
 }
}));

test("server paths and the render worker check revocation",async()=>{
 const server=await readFile("lib/server/summary-approval.ts","utf8");
 for(const fn of ["enqueueRender","approveRendered","releaseSummary"]){
  const start=server.indexOf("export async function "+fn),next=server.indexOf("\nexport ",start+1);
  const body=server.slice(start,next<0?undefined:next);
  assert.match(body,/assertCurrentEditGrants\(db,input\.artifactId\)/,fn+" must refuse revoked grants");
 }
 assert.match(server,/policyScope/,"release events carry the policy scope label");
 const worker=await readFile("scripts/render-summary.mjs","utf8");
 assert.match(worker,/media_permission_revocations/);
});
