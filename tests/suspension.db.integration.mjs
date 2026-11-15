import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
if(!process.env.DATABASE_URL)throw Error("A disposable PostgreSQL DATABASE_URL is required.");

// Fictional fixtures only; every test runs in a transaction that is rolled back.
const NOTICE="Suspended pending review of a fictional security report.";
async function rejects(db,sql,params,pattern){
 await db.query("SAVEPOINT expect_reject");
 try{await db.query(sql,params);}catch(e){await db.query("ROLLBACK TO SAVEPOINT expect_reject");if(pattern)assert.match(e.message,pattern);return;}
 await db.query("ROLLBACK TO SAVEPOINT expect_reject");
 assert.fail("Expected rejection: "+sql);
}
async function account(db){
 return (await db.query("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('neon-auth',$1,'Fictional fixture') RETURNING id",[randomUUID()])).rows[0].id;
}
async function withDb(fn){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{await db.query("BEGIN");await fn(db);}finally{await db.query("ROLLBACK");await db.end();}
}
const insertEvent="INSERT INTO account_suspension_events(account_id,event_type,reason_category,public_notice,actor_account_id) VALUES($1,$2,'malware_or_security',$3,$4) RETURNING id";

test("suspension history must match the account's status and is append-only",()=>withDb(async db=>{
 const admin=await account(db),target=await account(db);
 await rejects(db,insertEvent,[target,"suspended",NOTICE,admin],/only for a suspended account/);
 await db.query("UPDATE accounts SET status='suspended' WHERE id=$1",[target]);
 const id=(await db.query(insertEvent,[target,"suspended",NOTICE,admin])).rows[0].id;
 await rejects(db,"UPDATE account_suspension_events SET public_notice='rewritten notice for the record' WHERE id=$1",[id]);
 await rejects(db,"DELETE FROM account_suspension_events WHERE id=$1",[id]);
 await rejects(db,insertEvent,[target,"reinstated",NOTICE,admin],/only for a reinstated account/);
 await db.query("UPDATE accounts SET status='active' WHERE id=$1",[target]);
 await db.query(insertEvent,[target,"reinstated",NOTICE,admin]);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM account_suspension_events WHERE account_id=$1",[target])).rows[0].n,2);
}));

test("no self-suspension, short notices, unknown grounds or inactive administrators",()=>withDb(async db=>{
 const admin=await account(db),target=await account(db);
 await db.query("UPDATE accounts SET status='suspended' WHERE id=$1",[target]);
 await rejects(db,insertEvent,[target,"suspended",NOTICE,target]);
 await rejects(db,insertEvent,[target,"suspended","short",admin]);
 await rejects(db,"INSERT INTO account_suspension_events(account_id,event_type,reason_category,public_notice,actor_account_id) VALUES($1,'suspended','disagreeable_views',$2,$3)",[target,NOTICE,admin]);
 await db.query("UPDATE accounts SET status='closed' WHERE id=$1",[admin]);
 await rejects(db,insertEvent,[target,"suspended",NOTICE,admin],/active administrator/);
}));

test("a suspended account cannot publish, and its published record stays; closure stays final",()=>withDb(async db=>{
 const admin=await account(db),target=await account(db);
 const office=(await db.query("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional office','fictional') RETURNING id",["suspension-"+randomUUID()])).rows[0].id;
 const election=(await db.query("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','fictional fixture') RETURNING id",[office])).rows[0].id;
 const cand=(await db.query("INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,'Fictional Candidate S','verified') RETURNING id",[target,election])).rows[0].id;
 await db.query("UPDATE accounts SET status='suspended' WHERE id=$1",[target]);
 await db.query(insertEvent,[target,"suspended",NOTICE,admin]);
 await rejects(db,"INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds) VALUES($2,$1,'Fictional debate','Fictional proposition',600)",[cand,election],/closed or suspended/);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM candidacies WHERE id=$1",[cand])).rows[0].n,1);
 await db.query("UPDATE accounts SET status='closed' WHERE id=$1",[target]);
 await rejects(db,"UPDATE accounts SET status='active' WHERE id=$1",[target],/cannot be reopened/);
}));
