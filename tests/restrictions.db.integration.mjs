import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {PUBLIC_DEBATE_SUBMISSIONS_SQL,PUBLIC_RESTRICTION_HISTORY_SQL,ACTIVE_PUBLIC_RESTRICTION_SQL} from "../packages/domain/restriction-queries.ts";
if(!process.env.DATABASE_URL)throw Error("Disposable PostgreSQL required");

// Fictional fixtures only; every test runs in a transaction that is rolled back.
const PRIVATE_BASIS="PRIVATE-BASIS-MARKER reported by a fictional complainant via email";
const RESPONSE_TEXT="Fictional contender response mentioning zebrafinch-unique-token and a fictional home address.";

async function rejects(db,sql,params=[],pattern){
 await db.query("SAVEPOINT expect_reject");
 try{await db.query(sql,params);}catch(e){await db.query("ROLLBACK TO SAVEPOINT expect_reject");if(pattern)assert.match(e.message,pattern);return e;}
 await db.query("ROLLBACK TO SAVEPOINT expect_reject");
 assert.fail("Expected rejection: "+sql);
}
async function account(db,status){
 return (await db.query("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('neon-auth',$1,'Fictional fixture') RETURNING id,external_subject",[randomUUID()])).rows[0];
}
async function fixture(db){
 const office=(await db.query("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional office','fictional') RETURNING id",["restriction-"+randomUUID()])).rows[0].id;
 const election=(await db.query("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','fictional fixture') RETURNING id",[office])).rows[0].id;
 const accounts={},cands={};
 for(const name of ["a","b","c"]){
  accounts[name]=await account(db);
  cands[name]=(await db.query("INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,$3,'verified') RETURNING id",[accounts[name].id,election,"Fictional Candidate "+name.toUpperCase()])).rows[0].id;
 }
 const admin=await account(db),admin2=await account(db),delegate=await account(db);
 await db.query("INSERT INTO campaign_memberships(candidacy_id,account_id,role,granted_by) VALUES($1,$2,'editor',$3)",[cands.b,delegate.id,accounts.b.id]);
 const title="Fictional restriction debate "+randomUUID();
 const debate=(await db.query("INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,status,published_at,allowed_modalities) VALUES($1,$2,$3,'A fictional proposition',300,'published',now(),ARRAY['writing']::text[]) RETURNING id",[election,cands.a,title])).rows[0].id;
 const opening=(await db.query("INSERT INTO submissions(debate_id,candidacy_id,kind,modality,written_content,published_at) VALUES($1,$2,'opening','writing','Fictional opening speech of candidate A.',now()) RETURNING id",[debate,cands.a])).rows[0].id;
 const branch=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,cands.b])).rows[0].id;
 const response=(await db.query("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,published_at) VALUES($1,$2,$3,$4,'response','writing',$5,now()) RETURNING id",[debate,branch,cands.b,opening,RESPONSE_TEXT])).rows[0].id;
 return {election,accounts,cands,admin,admin2,delegate,debate,opening,branch,response,title};
}
async function openCase(db,f,actor,target=f.response,kind="submission"){
 const id=(await db.query("INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES($1,$2,$3,'private_information',$4) RETURNING id",[kind,target,f.debate,actor])).rows[0].id;
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'opened',$2,'Withheld because it discloses a private individual''s personal details.',$3)",[id,actor,PRIVATE_BASIS]);
 return id;
}
async function listQuery(){
 const source=await readFile("lib/server/public-debates.ts","utf8");
 const match=source.match(/export async function listPublicDebatesPage[\s\S]*?database\(\)\.query<PublicDebateSummary>\(\s*`([\s\S]*?)`/);
 assert.ok(match,"production listPublicDebatesPage query");
 assert.ok(match[1].includes("pde_active_restriction_case('submission',s.id) IS NULL"));
 return match[1];
}
async function withDb(fn){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{await fn(db);}finally{await db.query("ROLLBACK");await db.end();}
}

test("campaign participants and their delegates cannot open or decide restrictions in their own debate",()=>withDb(async db=>{
 const f=await fixture(db);
 // Originator-as-admin: campaign ownership is never moderation authority.
 await rejects(db,"INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES('submission',$1,$2,'impersonation',$3)",[f.response,f.debate,f.accounts.a.id],/participant/);
 await rejects(db,"INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES('submission',$1,$2,'impersonation',$3)",[f.opening,f.debate,f.accounts.b.id],/participant/);
 await rejects(db,"INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES('submission',$1,$2,'impersonation',$3)",[f.opening,f.debate,f.delegate.id],/participant/);
 // Unpublished or mismatched targets are refused.
 await rejects(db,"INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES('submission',$1,$2,'impersonation',$3)",[randomUUID(),f.debate,f.admin.id],/published/);
 const caseId=await openCase(db,f,f.admin.id);
 await rejects(db,"INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES('submission',$1,$2,'impersonation',$3)",[f.response,f.debate,f.admin2.id],/duplicate|unique/);
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','My statement for the fictional appeal record.')",[caseId,f.accounts.b.id]);
 // The originator cannot decide the opponent's appeal, even with an admin role elsewhere.
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'lifted',$2,'Lifted after review of the fictional appeal.',true)",[caseId,f.accounts.a.id],/participant/);
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'upheld',$2,'Upheld after review of the fictional appeal.',true)",[caseId,f.delegate.id],/participant/);
 // A case needs its opened event at commit time.
 await db.query("SAVEPOINT orphan");
 await db.query("INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES('submission',$1,$2,'legal_order',$3)",[f.opening,f.debate,f.admin.id]);
 await assert.rejects(db.query("SET CONSTRAINTS ALL IMMEDIATE"),/opened event/);
 await db.query("ROLLBACK TO SAVEPOINT orphan");
}));

test("appeals come only from the restricted item's contributor; decisions record independence truthfully",()=>withDb(async db=>{
 const f=await fixture(db);
 const caseId=await openCase(db,f,f.admin.id);
 const appeal="INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','A sufficiently long fictional appeal statement.')";
 await rejects(db,appeal,[caseId,f.accounts.a.id],/contributor/);
 await rejects(db,appeal,[caseId,f.accounts.c.id],/contributor/);
 await rejects(db,appeal,[caseId,f.admin2.id],/contributor/);
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'upheld',$2,'Upheld without any pending appeal at all.',true)",[caseId,f.admin2.id],/pending appeal/);
 await db.query(appeal,[caseId,f.accounts.b.id]);
 await rejects(db,appeal,[caseId,f.accounts.b.id],/already pending/);
 // Same administrator: independent_review must be false.
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'upheld',$2,'Upheld after the fictional appeal was reviewed.',true)",[caseId,f.admin.id],/independent_review/);
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'upheld',$2,'Upheld after the fictional appeal was reviewed.',false)",[caseId,f.admin.id]);
 // Different administrator: must be recorded as independent.
 await db.query(appeal,[caseId,f.accounts.b.id]);
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'lifted',$2,'Lifted after a second fictional review.',false)",[caseId,f.admin2.id],/independent_review/);
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'lifted',$2,'Lifted after a second fictional review.',true)",[caseId,f.admin2.id]);
 await db.query("UPDATE restriction_cases SET status='lifted' WHERE id=$1",[caseId]);
 const orders=(await db.query("SELECT event_order,event_type FROM restriction_events WHERE case_id=$1 ORDER BY event_order",[caseId])).rows;
 assert.deepEqual(orders.map(x=>x.event_type),["opened","appealed","upheld","appealed","lifted"]);
 assert.deepEqual(orders.map(x=>x.event_order),[1,2,3,4,5]);
 const times=(await db.query("SELECT occurred_at FROM restriction_events WHERE case_id=$1 ORDER BY event_order",[caseId])).rows.map(r=>r.occurred_at.getTime());
 assert.deepEqual([...times].sort((x,y)=>x-y),times);
}));

test("restriction history is append-only and a lifted case is final",()=>withDb(async db=>{
 const f=await fixture(db);
 const caseId=await openCase(db,f,f.admin.id);
 await rejects(db,"UPDATE restriction_events SET public_notice='Rewritten notice text for the record.' WHERE case_id=$1",[caseId],/append-only/);
 await rejects(db,"DELETE FROM restriction_events WHERE case_id=$1",[caseId],/append-only/);
 await rejects(db,"DELETE FROM restriction_cases WHERE id=$1",[caseId],/retained/);
 await rejects(db,"UPDATE restriction_cases SET reason_category='legal_order' WHERE id=$1",[caseId],/only change once/);
 await rejects(db,"UPDATE restriction_cases SET status='lifted' WHERE id=$1",[caseId],/lifted event/);
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'lifted',$2,'Lifted: the fictional basis no longer applies.',true)",[caseId,f.admin2.id]);
 await db.query("UPDATE restriction_cases SET status='lifted' WHERE id=$1",[caseId]);
 await rejects(db,"UPDATE restriction_cases SET status='active' WHERE id=$1",[caseId],/only change once/);
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','Appeal after lifting is not possible.')",[caseId,f.accounts.b.id],/final/);
 // Restricting again requires a new case, which is allowed.
 const second=await openCase(db,f,f.admin2.id);
 assert.notEqual(second,caseId);
 // The public notice may not repeat the private basis.
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis,independent_review) VALUES($1,1,'lifted',$2,$3,$4,true)",[second,f.admin.id,"Notice: "+PRIVATE_BASIS,PRIVATE_BASIS],/private basis/);
}));

test("public reads keep the restricted row and counts, withhold its text, and lifting restores it",()=>withDb(async db=>{
 const f=await fixture(db);
 const list=await listQuery();
 const before=(await db.query(PUBLIC_DEBATE_SUBMISSIONS_SQL,[f.debate])).rows;
 assert.equal(before.length,2);
 assert.equal(before.find(r=>r.id===f.response).written_content,RESPONSE_TEXT);
 assert.equal(before.find(r=>r.id===f.response).restriction,null);
 const search=(q)=>db.query(list,[null,null,q,null,null,21]);
 assert.equal((await search("zebrafinch-unique-token")).rows.length,1);

 const caseId=await openCase(db,f,f.admin.id);
 const during=(await db.query(PUBLIC_DEBATE_SUBMISSIONS_SQL,[f.debate])).rows;
 assert.equal(during.length,2,"restricted contribution still listed");
 const row=during.find(r=>r.id===f.response);
 assert.equal(row.written_content,null);
 assert.equal(row.candidate_name,"Fictional Candidate B");
 assert.equal(row.restriction.caseId,caseId);
 assert.equal(row.restriction.category,"private_information");
 assert.equal(row.restriction.appealStatus,"none");
 assert.match(row.restriction.publicNotice,/private individual/);
 assert.equal(during.find(r=>r.id===f.opening).written_content,"Fictional opening speech of candidate A.");
 // Writing search excludes restricted bytes; the debate entry and its counts remain.
 assert.equal((await search("zebrafinch-unique-token")).rows.length,0);
 const byTitle=(await search(f.title)).rows;
 assert.equal(byTitle.length,1);
 assert.equal(byTitle[0].contribution_count,2);
 assert.equal(byTitle[0].contender_count,1);
 // Media/caption resolution and inherited derivative logic use the same case function.
 assert.equal((await db.query("SELECT pde_active_restriction_case('submission',$1::uuid) AS id",[f.response])).rows[0].id,caseId);
 assert.equal((await db.query(ACTIVE_PUBLIC_RESTRICTION_SQL,["submission",f.opening])).rows[0].restriction,null);

 // Appeal status becomes visible publicly without the statement.
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','PRIVATE-APPEAL-MARKER fictional statement text.')",[caseId,f.accounts.b.id]);
 assert.equal((await db.query(ACTIVE_PUBLIC_RESTRICTION_SQL,["submission",f.response])).rows[0].restriction.appealStatus,"pending");

 // Private basis, appeal statement and account ids never appear in public results.
 const publicOutputs=JSON.stringify([
  (await db.query(PUBLIC_DEBATE_SUBMISSIONS_SQL,[f.debate])).rows,
  (await db.query(PUBLIC_RESTRICTION_HISTORY_SQL,[f.debate])).rows,
  (await db.query(ACTIVE_PUBLIC_RESTRICTION_SQL,["submission",f.response])).rows,
  (await search(f.title)).rows
 ]);
 for(const secret of ["PRIVATE-BASIS-MARKER","PRIVATE-APPEAL-MARKER",f.admin.id,f.admin2.id,f.accounts.b.id,RESPONSE_TEXT])
  assert.ok(!publicOutputs.includes(secret),"public output leaked "+secret.slice(0,24));

 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,independent_review) VALUES($1,1,'lifted',$2,'Lifted after the fictional appeal was reviewed.',true)",[caseId,f.admin2.id]);
 await db.query("UPDATE restriction_cases SET status='lifted' WHERE id=$1",[caseId]);
 const after=(await db.query(PUBLIC_DEBATE_SUBMISSIONS_SQL,[f.debate])).rows.find(r=>r.id===f.response);
 assert.equal(after.written_content,RESPONSE_TEXT);
 assert.equal(after.restriction,null);
 assert.equal((await search("zebrafinch-unique-token")).rows.length,1);
 const history=(await db.query(PUBLIC_RESTRICTION_HISTORY_SQL,[f.debate])).rows;
 assert.equal(history.length,1);
 assert.equal(history[0].status,"lifted");
 assert.deepEqual(history[0].events.map(e=>e.eventType),["opened","appealed","lifted"]);
 assert.equal(history[0].events[2].independentReview,true);
 // The published row itself was never changed.
 assert.equal((await db.query("SELECT written_content FROM submissions WHERE id=$1",[f.response])).rows[0].written_content,RESPONSE_TEXT);
}));

test("supporting documents can be restricted independently and the public listing hides their names",()=>withDb(async db=>{
 const f=await fixture(db);
 // Later migrations require scan attestation columns on new document rows; include them when present.
 const scanned=(await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='submission_documents' AND column_name='scan_verdict'")).rowCount>0;
 const doc=(await db.query("INSERT INTO submission_documents(submission_id,uploaded_by_candidacy_id,filename,storage_key,sha256,size_bytes,mime_type,label"+(scanned?",scanner,scan_verdict,scanned_at":"")+") VALUES($1,$2,'fictional-private-name.txt',$3,$4,10,'text/plain','Fictional source'"+(scanned?",'clamav','clean',now()":"")+") RETURNING id",[f.opening,f.cands.a,"documents/"+randomUUID(),"a".repeat(64)])).rows[0].id;
 await openCase(db,f,f.admin.id,doc,"document");
 const source=await readFile("lib/server/documents.ts","utf8");
 const sql=source.match(/export async function publicDocuments[\s\S]*?\n  "([^"]+)",\[debateId\]/)[1];
 const rows=(await db.query(sql,[f.debate])).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].filename,"withheld");
 assert.equal(rows[0].restriction.targetKind,"document");
 // Only the uploader may appeal a document restriction.
 const caseId=rows[0].restriction.caseId;
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','Not my document but I appeal anyway.')",[caseId,f.accounts.b.id],/contributor/);
 await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','This is my own fictional document.')",[caseId,f.accounts.a.id]);
}));

test("a closed account cannot write, cannot be reopened, and its publications remain attributed",()=>withDb(async db=>{
 const f=await fixture(db);
 const caseId=await openCase(db,f,f.admin.id);
 await db.query("UPDATE campaign_memberships SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL",[f.delegate.id]);
 await db.query("UPDATE accounts SET status='closed' WHERE id=$1",[f.accounts.b.id]);
 // Candidate-actor SQL used for publishing cannot authorize the closed account.
 const source=await readFile("lib/server/contribution-source.ts","utf8");
 const actorSql=source.match(/export async function verifiedCandidateSource[\s\S]*?db\.query<[^>]*>\(\s*"([^"]+)"/)[1];
 assert.equal((await db.query(actorSql,[f.cands.b,f.accounts.b.external_subject])).rowCount,0);
 assert.equal((await db.query(actorSql,[f.cands.c,f.accounts.c.external_subject])).rowCount,1);
 // Defense in depth: direct inserts are refused for every attributed write.
 const reply="INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,published_at) VALUES($1,$2,$3,$4,'reply','writing','Fictional reply text.',now())";
 const opening=(await db.query("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,published_at) VALUES($1,$2,$3,$4,'reply','writing','Fictional originator reply.',now()) RETURNING id",[f.debate,f.branch,f.cands.a,f.response])).rows[0].id;
 await rejects(db,reply,[f.debate,f.branch,f.cands.b,opening],/closed or suspended/);
 await rejects(db,"INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,allowed_modalities) VALUES($1,$2,'New','New fictional proposition',300,ARRAY['writing']::text[])",[f.election,f.cands.b],/closed or suspended/);
 await rejects(db,"INSERT INTO submission_corrections(submission_id,candidacy_id,correction_body) VALUES($1,$2,'A fictional correction that should be refused.')",[f.response,f.cands.b],/closed or suspended/);
 await rejects(db,"INSERT INTO candidacies(account_id,election_id,public_name) VALUES($1,$2,'Fictional new candidacy')",[f.accounts.b.id,f.election],/closed or suspended/);
 await rejects(db,"INSERT INTO campaign_memberships(candidacy_id,account_id,role,granted_by) VALUES($1,$2,'editor',$3)",[f.cands.c,f.accounts.b.id,f.accounts.c.id],/closed or suspended/);
 await rejects(db,"INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,'The contributor has appealed this restriction.','A closed account tries to appeal here.')",[caseId,f.accounts.b.id],/active account/);
 await rejects(db,"UPDATE accounts SET status='active' WHERE id=$1",[f.accounts.b.id],/cannot be reopened/);
 await rejects(db,"DELETE FROM accounts WHERE id=$1",[f.accounts.b.id],/retained/);
 // Historic publications stay public and attributed.
 const rows=(await db.query(PUBLIC_DEBATE_SUBMISSIONS_SQL,[f.debate])).rows;
 assert.equal(rows.length,3);
 assert.equal(rows.find(r=>r.id===f.response).candidate_name,"Fictional Candidate B");
 // Other participants keep acting normally.
 await db.query("INSERT INTO submission_corrections(submission_id,candidacy_id,correction_body) VALUES($1,$2,'A fictional correction by the originator.')",[f.opening,f.cands.a]);
}));

test("a withdrawn candidacy cannot start debates or publish, while history stays attributed",()=>withDb(async db=>{
 const f=await fixture(db);
 await rejects(db,"INSERT INTO candidacy_status_events(candidacy_id,event_type,actor_account_id) VALUES($1,'withdrawn',$2)",[f.cands.a,f.accounts.b.id],/owning the candidacy/);
 const w=(await db.query("INSERT INTO candidacy_status_events(candidacy_id,event_type,actor_account_id,public_statement) VALUES($1,'withdrawn',$2,'Fictional withdrawal statement.') RETURNING id",[f.cands.a,f.accounts.a.id])).rows[0].id;
 await rejects(db,"INSERT INTO candidacy_status_events(candidacy_id,event_type,actor_account_id) VALUES($1,'withdrawn',$2)",[f.cands.a,f.accounts.a.id],/duplicate|unique/);
 await rejects(db,"UPDATE candidacy_status_events SET public_statement=NULL WHERE id=$1",[w],/append-only/);
 await rejects(db,"DELETE FROM candidacy_status_events WHERE id=$1",[w],/append-only/);
 const source=await readFile("lib/server/contribution-source.ts","utf8");
 const actorSql=source.match(/export async function verifiedCandidateSource[\s\S]*?db\.query<[^>]*>\(\s*"([^"]+)"/)[1];
 assert.equal((await db.query(actorSql,[f.cands.a,f.accounts.a.external_subject])).rowCount,0);
 await rejects(db,"INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,allowed_modalities) VALUES($1,$2,'New','New fictional proposition',300,ARRAY['writing']::text[])",[f.election,f.cands.a],/withdrawn/);
 await rejects(db,"INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,published_at) VALUES($1,$2,$3,$4,'reply','writing','Fictional reply after withdrawal.',now())",[f.debate,f.branch,f.cands.a,f.response],/withdrawn/);
 // Another contender may still answer the withdrawn originator's opening.
 const branchC=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[f.debate,f.cands.c])).rows[0].id;
 await db.query("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,published_at) VALUES($1,$2,$3,$4,'response','writing','Fictional response by C.',now())",[f.debate,branchC,f.cands.c,f.opening]);
 const rows=(await db.query(PUBLIC_DEBATE_SUBMISSIONS_SQL,[f.debate])).rows;
 assert.equal(rows.find(r=>r.id===f.opening).candidate_name,"Fictional Candidate A");
 assert.equal(rows.find(r=>r.id===f.opening).written_content,"Fictional opening speech of candidate A.");
 const profileSource=await readFile("lib/server/discovery.ts","utf8");
 assert.ok(profileSource.includes("candidacy_status_events w WHERE w.candidacy_id=c.id AND w.event_type='withdrawn'"));
 const withdrawn=(await db.query("SELECT (SELECT w.occurred_at FROM candidacy_status_events w WHERE w.candidacy_id=c.id AND w.event_type='withdrawn') AS withdrawn_at FROM candidacies c WHERE c.id=$1",[f.cands.a])).rows[0];
 assert.ok(withdrawn.withdrawn_at instanceof Date);
}));
