// Transaction core for mutually accepted branch rule versions (PDE-06). No "server-only" import so the
// DB integration tests exercise this code; callers pass a client inside transaction(...).
import type {PoolClient} from "pg";
import {HttpError} from "./http-error.ts";
import {parseRuleProposalTerms} from "../../packages/domain/branch-rules.ts";

type Db=Pick<PoolClient,"query">;
export type BranchRules={revision:number;max_response_seconds:number;reply_window_hours:number|null};

/** Rules a NEW contribution on this branch is judged by. Version 1 is the debate's original rules. */
export async function effectiveBranchRules(db:Db,branchId:string):Promise<BranchRules>{
 const result=await db.query<BranchRules>(`SELECT COALESCE(v.revision,1)::integer AS revision,
  CASE WHEN v.revision IS NULL THEN d.max_response_seconds ELSE p.max_response_seconds END AS max_response_seconds,
  CASE WHEN v.revision IS NULL THEN d.reply_window_hours ELSE p.reply_window_hours END AS reply_window_hours
  FROM debate_branches b JOIN debates d ON d.id=b.debate_id
  LEFT JOIN LATERAL(SELECT revision,proposal_id FROM branch_rule_versions WHERE branch_id=b.id ORDER BY revision DESC LIMIT 1) v ON true
  LEFT JOIN branch_rule_proposals p ON p.id=v.proposal_id WHERE b.id=$1 AND d.status='published'`,[branchId]);
 if(!result.rowCount)throw new HttpError(404,"Published branch not found.");
 return result.rows[0];
}

/** Prove the actor in SQL: branch participant + verified candidacy + active Neon Auth account. */
async function lockParticipant(db:Db,branchId:string,candidateId:string,subject:string){
 const member=await db.query<{debate_id:string;account_id:string}>(`SELECT b.debate_id,a.id AS account_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id
  JOIN candidacies c ON c.id=$2 AND c.id IN(d.originator_candidacy_id,b.responder_candidacy_id)
  JOIN accounts a ON a.id=c.account_id WHERE b.id=$1 AND d.status='published' AND c.verification_status='verified'
  AND a.status='active' AND a.identity_provider='neon-auth' AND a.external_subject=$3 FOR SHARE OF c,a`,[branchId,candidateId,subject]);
 if(!member.rowCount)throw new HttpError(403,"Only the two verified branch participants may propose or accept rule changes.");
 // Same lock order as continuation and assessment transactions: debate, then branch.
 await db.query("SELECT id FROM debates WHERE id=$1 FOR UPDATE",[member.rows[0].debate_id]);
 await db.query("SELECT id FROM debate_branches WHERE id=$1 FOR UPDATE",[branchId]);
 return member.rows[0];
}

export async function listBranchRules(db:Db,branchId:string){
 const current=await effectiveBranchRules(db,branchId);
 const proposals=await db.query(`SELECT p.id,p.base_revision,p.max_response_seconds,p.reply_window_hours,p.content_sha256,p.created_at,
  c.public_name AS proposer,p.proposed_by_candidacy_id,v.revision AS activated_revision,v.activated_at,
  COALESCE((SELECT array_agg(a.candidacy_id ORDER BY a.approved_at,a.candidacy_id) FROM branch_rule_approvals a WHERE a.proposal_id=p.id),ARRAY[]::uuid[]) AS accepted_by
  FROM branch_rule_proposals p JOIN candidacies c ON c.id=p.proposed_by_candidacy_id
  LEFT JOIN branch_rule_versions v ON v.proposal_id=p.id WHERE p.branch_id=$1 ORDER BY p.created_at DESC,p.id DESC`,[branchId]);
 return {current,proposals:proposals.rows};
}

/** Publishing a proposal records the proposer's own acceptance; it has no effect until the other participant accepts. */
export async function proposeBranchRules(db:Db,input:{branchId:string;candidateId:string;authSubject:string;baseRevision:unknown;maxResponseSeconds:unknown;replyWindowHours:unknown}){
 let terms;
 try{terms=parseRuleProposalTerms(input)}catch(e){throw new HttpError(400,(e as Error).message)}
 const member=await lockParticipant(db,input.branchId,input.candidateId,input.authSubject);
 const current=await effectiveBranchRules(db,input.branchId);
 if(current.revision!==terms.baseRevision)throw new HttpError(409,"The rules changed. Review the current version before proposing another change.");
 if(current.max_response_seconds===terms.maxResponseSeconds&&current.reply_window_hours===terms.replyWindowHours)
  throw new HttpError(400,"The proposal is identical to the rules in force.");
 const proposal=(await db.query<{id:string;content_sha256:string}>(
  "INSERT INTO branch_rule_proposals(branch_id,proposed_by_candidacy_id,base_revision,max_response_seconds,reply_window_hours,content_sha256) VALUES($1,$2,$3,$4,$5,repeat('0',64)) RETURNING id,content_sha256",
  [input.branchId,input.candidateId,terms.baseRevision,terms.maxResponseSeconds,terms.replyWindowHours])).rows[0];
 await db.query("INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[proposal.id,proposal.content_sha256,input.candidateId]);
 await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'branch_rules_proposed',$4,$5::jsonb)",
  [member.debate_id,input.branchId,input.candidateId,proposal.id,JSON.stringify({sha256:proposal.content_sha256,baseRevision:terms.baseRevision,maxResponseSeconds:terms.maxResponseSeconds,replyWindowHours:terms.replyWindowHours})]);
 await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id) VALUES($1,'branch_rules_proposed','branch_rule_proposal',$2)",[member.account_id,proposal.id]);
 return {proposalId:proposal.id,sha256:proposal.content_sha256,activated:false};
}

/** Accept the exact proposal digest. Activation happens only when both participants accepted the current-base proposal. */
export async function acceptBranchRules(db:Db,input:{branchId:string;proposalId:string;candidateId:string;authSubject:string;sha256:unknown}){
 if(typeof input.sha256!=="string"||!/^[a-f0-9]{64}$/.test(input.sha256))throw new HttpError(400,"The exact proposal SHA-256 digest is required.");
 const member=await lockParticipant(db,input.branchId,input.candidateId,input.authSubject);
 const proposal=(await db.query<{id:string;base_revision:number;content_sha256:string}>(
  "SELECT id,base_revision,content_sha256 FROM branch_rule_proposals WHERE id=$1 AND branch_id=$2",[input.proposalId,input.branchId])).rows[0];
 if(!proposal)throw new HttpError(404,"Rule proposal not found in this branch.");
 if(proposal.content_sha256!==input.sha256)throw new HttpError(409,"Accept the exact rule proposal digest you reviewed.");
 const existing=await db.query<{revision:number}>("SELECT revision FROM branch_rule_versions WHERE proposal_id=$1",[input.proposalId]);
 if(existing.rowCount)return {activated:true,revision:existing.rows[0].revision,alreadyActivated:true};
 const current=await effectiveBranchRules(db,input.branchId);
 if(current.revision!==proposal.base_revision)throw new HttpError(409,"This proposal is based on superseded rules. Propose a new version.");
 const approval=await db.query("INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[input.proposalId,input.sha256,input.candidateId]);
 if(!approval.rowCount)return {activated:false,revision:current.revision,alreadyAccepted:true};
 const count=await db.query<{n:number}>("SELECT count(*)::integer AS n FROM branch_rule_approvals WHERE proposal_id=$1",[input.proposalId]);
 const activated=count.rows[0].n===2;
 const revision=activated?current.revision+1:current.revision;
 if(activated)await db.query("INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,$2,$3)",[input.branchId,revision,input.proposalId]);
 await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
  [member.debate_id,input.branchId,input.candidateId,activated?"branch_rules_activated":"branch_rules_accepted",input.proposalId,JSON.stringify({sha256:input.sha256,revision:activated?revision:null})]);
 await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id) VALUES($1,$2,'branch_rule_proposal',$3)",[member.account_id,activated?"branch_rules_activated":"branch_rules_accepted",input.proposalId]);
 return {activated,revision};
}
