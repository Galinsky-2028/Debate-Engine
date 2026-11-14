// Plan section 5 / docs/INVITATIONS.md: provider evidence for a direct invitation opens a durable response clock
// (migration 0034). Outbox processing uses pooled connections, so fixtures are committed, unique and explicitly fictional.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {processOutbox,enqueueInvitationDelivery} from "../packages/delivery/outbox-store.ts";
import {loadInvitationProjections} from "../packages/delivery/invitations-store.ts";
import {runDeadlineJobs} from "../scripts/deadline-worker.mjs";
import {invitationResponseClock} from "../packages/domain/deadlines.ts";

if(!process.env.DATABASE_URL)throw Error("A disposable PostgreSQL DATABASE_URL is required.");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:6});
const q=(sql,args)=>pool.query(sql,args);
const one=async(sql,args)=>(await q(sql,args)).rows[0];
test.after(async()=>{await pool.end();});

async function fixture(replyWindowHours=72){
 const office=(await one("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional invitation office','Fictional') RETURNING id",["invite-clock-"+randomUUID()])).id;
 const election=(await one("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','Fictional invitation election') RETURNING id",[office])).id;
 const actor=async label=>{
  const account=(await one("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture',$1,$2) RETURNING id",[randomUUID(),label])).id;
  const candidacy=(await one("INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,$3,'verified') RETURNING id",[account,election,label])).id;
  return {account,candidacy};
 };
 const a=await actor("Fictional Originator A"),b=await actor("Fictional Invitee B"),c=await actor("Fictional Uninvited C");
 const debate=(await one("INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,reply_window_hours,allowed_modalities) VALUES($1,$2,'Fictional invitation debate','A fictional proposition for invitation clocks',300,$3,ARRAY['writing']::text[]) RETURNING id",[election,a.candidacy,replyWindowHours])).id;
 const opening=(await one("INSERT INTO submissions(debate_id,candidacy_id,kind,modality,written_content) VALUES($1,$2,'opening','writing','Fictional opening statement for invitation clock tests.') RETURNING id",[debate,a.candidacy])).id;
 await q("UPDATE submissions SET published_at=now() WHERE id=$1",[opening]);
 await q("UPDATE debates SET status='published',published_at=now() WHERE id=$1",[debate]);
 return {a,b,c,debate,opening};
}
async function webhook(owner){
 const id=(await one("INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address,signing_secret) VALUES($1,$2,'webhook',ARRAY['notifications'],'Fictional hook',$3,$4) RETURNING id",
  [owner.candidacy,owner.account,"https://fictional-"+randomUUID().slice(0,8)+".example.org/hook",randomBytes(32).toString("base64url")])).id;
 await q("UPDATE delivery_destinations SET verified_at=now() WHERE id=$1",[id]);
 return id;
}
const invite=async f=>(await one("INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3) RETURNING id",[f.debate,f.b.candidacy,f.a.candidacy])).id;
// Fake provider: nothing leaves the machine. Outcome per destination id.
function adapters(outcome){
 const calls=[];
 const run=async r=>{calls.push(r);return outcome(r);};
 return {calls,adapters:{webhook:run,email:run}};
}
async function drain(outcome,rounds=2){for(let i=0;i<rounds;i++)await processOutbox(pool,{limit:100,adapters:adapters(outcome).adapters});}
const clocks=invitation=>q("SELECT * FROM reply_obligations WHERE invitation_id=$1",[invitation]).then(r=>r.rows);
async function respond(f,who){
 const branch=(await one("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[f.debate,who.candidacy])).id;
 const id=(await one("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content) VALUES($1,$2,$3,$4,'response','writing','Fictional response statement for invitation clock tests.') RETURNING id",[f.debate,branch,who.candidacy,f.opening])).id;
 return (await one("UPDATE submissions SET published_at=now() WHERE id=$1 RETURNING published_at",[id])).published_at;
}
async function publicStates(debate){
 const source=await readFile("lib/server/public-debates.ts","utf8");
 const sql=source.match(/database\(\)\.query\("(WITH projected AS \(SELECT ro\.\*[\s\S]*?)",\[debateId\]\)/)[1];
 return (await q(sql,[debate])).rows;
}

test.before(async()=>{
 // Retire leftovers from earlier runs so this run's fake provider only sees its own work.
 await q("UPDATE outgoing_actions SET state='dead',dead_at=now(),last_error='retired by test setup' WHERE state IN ('pending','failed')");
});

test("no provider evidence, no clock; a failed attempt is not evidence; the guard refuses a forged clock",async()=>{
 const f=await fixture();
 const inv=await invite(f);
 assert.equal(await enqueueInvitationDelivery(pool,inv),0,"no destination → nothing queued");
 assert.equal((await clocks(inv)).length,0);
 await webhook(f.b);
 assert.equal(await enqueueInvitationDelivery(pool,inv),1);
 await drain(()=>({kind:"failed",retryable:true,error:"Fictional outage"}),1);
 assert.equal((await clocks(inv)).length,0,"a failed attempt opens no clock");
 assert.equal((await q("SELECT public.pde_open_invitation_obligation($1) AS id",[inv])).rows[0].id,null);
 await assert.rejects(q(`INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at,invitation_id)
  VALUES($1,NULL,$2,$3,'reply',now(),now()+interval '72 hours',$4)`,[f.debate,f.opening,f.b.candidacy,inv]),/provider evidence/);
 await assert.rejects(q(`INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at)
  VALUES($1,NULL,$2,$3,'reply',now(),now()+interval '72 hours')`,[f.debate,f.opening,f.c.candidacy]),/branch_or_invitation/,"an uninvited, branchless clock is impossible");
 const [p]=await loadInvitationProjections(pool,f.debate);
 assert.equal(p.state,"drafted");assert.equal(p.responseDueAt,null);
});

test("provider evidence opens exactly one clock, even with two successful destinations and repeated calls",async()=>{
 const f=await fixture(72);
 const inv=await invite(f);
 await webhook(f.b);await webhook(f.b);
 assert.equal(await enqueueInvitationDelivery(pool,inv),2);
 await drain(()=>({kind:"delivered",receipt:"fixture-2xx"}));
 const evidence=await one("SELECT min(accepted_at) AS first,count(*)::int AS n FROM outgoing_actions WHERE subject_kind='invitation' AND subject_id=$1 AND state='delivered'",[inv]);
 assert.equal(evidence.n,2,"both destinations recorded evidence");
 assert.equal((await q("SELECT public.pde_open_invitation_obligation($1) AS id",[inv])).rows[0].id,null,"repeat is a no-op");
 const rows=await clocks(inv);
 assert.equal(rows.length,1);
 const published=(await one("SELECT published_at FROM debates WHERE id=$1",[f.debate])).published_at;
 const expected=invitationResponseClock(published.toISOString(),evidence.first.toISOString(),72);
 assert.equal(rows[0].opened_at.toISOString(),expected.openedAt);
 assert.equal(rows[0].due_at.toISOString(),expected.dueAt);
 assert.equal(rows[0].branch_id,null);assert.equal(rows[0].obligated_candidacy_id,f.b.candidacy);assert.equal(rows[0].source_submission_id,f.opening);
 const job=await one("SELECT dedupe_key,available_at FROM durable_jobs WHERE job_type='obligation_deadline' AND arguments->>'obligationId'=$1",[rows[0].id]);
 assert.equal(job.dedupe_key,`obligation:${rows[0].id}:deadline:${expected.dueAt}`,"same key format as lib/server/obligations.ts");
 assert.equal(job.available_at.toISOString(),new Date(Date.parse(expected.dueAt)-24*3600_000).toISOString(),"first check at the due-soon instant");
 assert.equal((await one("SELECT count(*)::int n FROM publication_events WHERE kind='invitation_response_clock_opened' AND object_id=$1",[inv])).n,1);
 const [p]=await loadInvitationProjections(pool,f.debate);
 assert.equal(p.state,"sent");assert.equal(p.responseDueAt,expected.dueAt);
 const ledger=(await publicStates(f.debate)).find(r=>r.id===rows[0].id);
 assert.equal(ledger.state,"open");assert.equal(ledger.from_invitation,true);assert.equal(ledger.obligated_name,"Fictional Invitee B");
 // An uninvited responder gets no clock; the invitee's first response fulfils theirs on time.
 await respond(f,f.c);
 assert.equal((await one("SELECT count(*)::int n FROM reply_obligations WHERE obligated_candidacy_id=$1",[f.c.candidacy])).n,0);
 const at=await respond(f,f.b);
 const fulfilled=(await clocks(inv))[0];
 assert.equal(fulfilled.received_at.toISOString(),at.toISOString(),"received at the publication time");
 assert.equal((await publicStates(f.debate)).find(r=>r.id===rows[0].id).state,"fulfilled_on_time");
 const [after]=await loadInvitationProjections(pool,f.debate);
 assert.match(after.label,/^Response received .* \(within the response window\)$/);
});

test("a missed invitation clock records one overdue event and notice; a late first response is labelled late",async()=>{
 const f=await fixture(1);
 const inv=await invite(f);
 const hook=await webhook(f.b);
 await enqueueInvitationDelivery(pool,inv);
 await drain(()=>({kind:"delivered",receipt:"fixture-2xx"}));
 const [clock]=await clocks(inv);
 assert.ok(clock,"clock opened");
 // Simulate the window elapsing: shift the recorded instants into the past (test-only) and make the job due.
 await q("UPDATE reply_obligations SET opened_at=opened_at-interval '3 hours',due_at=due_at-interval '3 hours' WHERE id=$1",[clock.id]);
 await q("UPDATE durable_jobs SET available_at=now() WHERE job_type='obligation_deadline' AND arguments->>'obligationId'=$1",[clock.id]);
 await runDeadlineJobs(pool,100);
 await runDeadlineJobs(pool,100);
 const events=(await q("SELECT payload FROM publication_events WHERE kind='obligation_overdue' AND object_id=$1",[clock.id])).rows;
 assert.equal(events.length,1,"overdue recorded once");
 assert.equal(events[0].payload.invitationId,inv);
 const notices=(await q("SELECT payload FROM outgoing_actions WHERE action_type='notification' AND subject_kind='obligation' AND subject_id=$1",[clock.id])).rows;
 assert.equal(notices.length,1,"one overdue notice to the invitee's own destination");
 assert.match(notices[0].payload.email.subject,/^No response received by /);
 assert.equal((await one("SELECT destination_id FROM outgoing_actions WHERE action_type='notification' AND subject_id=$1",[clock.id])).destination_id,hook);
 assert.equal((await publicStates(f.debate)).find(r=>r.id===clock.id).state,"overdue");
 const [missed]=await loadInvitationProjections(pool,f.debate);
 assert.equal(missed.state,"no_response");
 await respond(f,f.b);
 assert.equal((await publicStates(f.debate)).find(r=>r.id===clock.id).state,"fulfilled_late");
 const [late]=await loadInvitationProjections(pool,f.debate);
 assert.match(late.label,/\(after the response window\)$/);
});

test("no reply window, no clock; the inbox and ledger show invitation clocks neutrally",async()=>{
 const f=await fixture(null);
 const inv=await invite(f);
 await webhook(f.b);
 await enqueueInvitationDelivery(pool,inv);
 await drain(()=>({kind:"delivered",receipt:"fixture-2xx"}));
 assert.equal((await clocks(inv)).length,0);
 const [p]=await loadInvitationProjections(pool,f.debate);
 assert.equal(p.state,"sent");assert.equal(p.responseDueAt,null);
 const inbox=await readFile("app/workspace/obligation-inbox.tsx","utf8");
 assert.match(inbox,/invitation_id IS NOT NULL/);assert.match(inbox,/You were invited to respond\. Responding is your choice\./);
 const ledger=await readFile("app/debates/[id]/obligation-ledger.tsx","utf8");
 assert.match(ledger,/response to the direct invitation/);
});
