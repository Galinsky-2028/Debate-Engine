// Shared, explicitly fictional fixture for the PDE-19/PDE-20 database tests.
// Callers run inside a transaction that is rolled back.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

export async function refused(db,sql,args,codes=["23514"]){
 await db.query("SAVEPOINT adversarial");
 let error;
 try{await db.query(sql,args)}catch(e){error=e}
 await db.query("ROLLBACK TO SAVEPOINT adversarial");
 await db.query("RELEASE SAVEPOINT adversarial");
 assert.ok(error,"Expected the database to refuse: "+sql);
 assert.ok(codes.includes(error.code),"Unexpected refusal "+error.code+": "+error.message);
 return error;
}
async function actor(db,election,label){
 const account=(await db.query("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture',$1,$2) RETURNING id",[randomUUID(),label])).rows[0].id;
 return (await db.query("INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,$3,'verified') RETURNING id",[account,election,label])).rows[0].id;
}
async function video(db,owner){
 return (await db.query("INSERT INTO media_assets(owner_candidacy_id,storage_key,original_sha256,size_bytes,mime_type,duration_seconds,processing_status) VALUES($1,$2,$3,1024,'video/mp4',60,'ready') RETURNING id",
  [owner,"fixture/"+randomUUID(),"e".repeat(64)])).rows[0].id;
}
/** Fictional debate: A opens (video, question), B responds on branch AB (video, question), C responds on branch AC (question). */
export async function debateFixture(db){
 const office=(await db.query("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional office','Fictional') RETURNING id",["pde-scope-"+randomUUID()])).rows[0].id;
 const election=(await db.query("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','Fictional election') RETURNING id",[office])).rows[0].id;
 const a=await actor(db,election,"Fictional Candidate A"),b=await actor(db,election,"Fictional Candidate B"),c=await actor(db,election,"Fictional Candidate C");
 const videoA=await video(db,a),videoB=await video(db,b),videoC=await video(db,c);
 const debate=(await db.query("INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds) VALUES($1,$2,'Fictional transit debate','A fictional proposition',300) RETURNING id",[election,a])).rows[0].id;
 const opening=(await db.query("INSERT INTO submissions(debate_id,candidacy_id,media_asset_id,kind) VALUES($1,$2,$3,'opening') RETURNING id",[debate,a,videoA])).rows[0].id;
 const qOpening=(await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,video_timestamp_seconds) VALUES($1,$2,1,'How would you fund it?',5) RETURNING id",[opening,a])).rows[0].id;
 await db.query("UPDATE submissions SET published_at=now() WHERE id=$1",[opening]);
 await db.query("UPDATE debates SET status='published',published_at=now() WHERE id=$1",[debate]);
 const branchAB=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,b])).rows[0].id;
 const branchAC=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,c])).rows[0].id;
 const responseB=(await db.query("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,media_asset_id,kind) VALUES($1,$2,$3,$4,$5,'response') RETURNING id",[debate,branchAB,b,opening,videoB])).rows[0].id;
 const qB=(await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,video_timestamp_seconds) VALUES($1,$2,1,'Would you phase it in?',8) RETURNING id",[responseB,b])).rows[0].id;
 await db.query("UPDATE submissions SET published_at=now() WHERE id=$1",[responseB]);
 const responseC=(await db.query("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,media_asset_id,kind) VALUES($1,$2,$3,$4,$5,'response') RETURNING id",[debate,branchAC,c,opening,videoC])).rows[0].id;
 const qC=(await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,video_timestamp_seconds) VALUES($1,$2,1,'Why not a toll?',3) RETURNING id",[responseC,c])).rows[0].id;
 await db.query("UPDATE submissions SET published_at=now() WHERE id=$1",[responseC]);
 const doc=async(submission,uploader,sha)=>(await db.query("INSERT INTO submission_documents(submission_id,uploaded_by_candidacy_id,filename,storage_key,sha256,size_bytes,mime_type,label,scanner,scan_verdict,scanned_at) VALUES($1,$2,'plan.pdf',$3,$4,100,'application/pdf','Fictional cost table','clamav','clean',now()) RETURNING id",
  [submission,uploader,"fixture-doc/"+randomUUID(),sha])).rows[0].id;
 const docA=await doc(opening,a,"1".repeat(64)),docB=await doc(responseB,b,"2".repeat(64));
 // An unpublished draft and its document must never be attachable.
 const draft=(await db.query("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,media_asset_id,kind) VALUES($1,$2,$3,$4,$5,'reply') RETURNING id",[debate,branchAB,a,responseB,await video(db,a)])).rows[0].id;
 const draftDoc=await doc(draft,a,"3".repeat(64));
 return {election,a,b,c,videoA,videoB,videoC,debate,opening,responseB,responseC,branchAB,branchAC,qOpening,qB,qC,docA,docB,draftDoc};
}
