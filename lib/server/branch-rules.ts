import "server-only";
import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {database,transaction} from "./db";
import {HttpError} from "./http";
import {parseModalities,type DebateModality} from "../../packages/domain/modalities";
export type BranchRules={revision:number;max_response_seconds:number;reply_window_hours:number|null;allowed_modalities:DebateModality[]};
export async function effectiveBranchRules(db:PoolClient,branchId:string):Promise<BranchRules>{
 const result=await db.query<BranchRules>(`SELECT COALESCE(v.revision,1) AS revision,
  COALESCE(p.max_response_seconds,d.max_response_seconds) AS max_response_seconds,
  CASE WHEN v.revision IS NULL THEN d.reply_window_hours ELSE p.reply_window_hours END AS reply_window_hours,
  COALESCE(p.allowed_modalities,d.allowed_modalities) AS allowed_modalities
  FROM debate_branches b JOIN debates d ON d.id=b.debate_id
  LEFT JOIN LATERAL(SELECT revision,proposal_id FROM branch_rule_versions WHERE branch_id=b.id ORDER BY revision DESC LIMIT 1) v ON true
  LEFT JOIN branch_rule_proposals p ON p.id=v.proposal_id WHERE b.id=$1 AND d.status='published'`,[branchId]);
 if(!result.rowCount)throw new HttpError(404,"Published branch not found.");
 return result.rows[0];
}
async function lockParticipant(db:PoolClient,branchId:string,candidateId:string,subject:string){
 const member=await db.query<{debate_id:string}>(`SELECT b.debate_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id
  JOIN candidacies c ON c.id=$2 AND c.id IN(d.originator_candidacy_id,b.responder_candidacy_id)
  JOIN accounts a ON a.id=c.account_id WHERE b.id=$1 AND d.status='published' AND c.verification_status='verified'
  AND a.status='active' AND a.identity_provider='neon-auth' AND a.external_subject=$3 FOR SHARE OF c,a`,[branchId,candidateId,subject]);
 if(!member.rowCount)throw new HttpError(403,"Only verified branch participants may change rules.");
 // Same lock order as continuation and assessment transactions.
 await db.query("SELECT id FROM debates WHERE id=$1 FOR UPDATE",[member.rows[0].debate_id]);
 await db.query("SELECT id FROM debate_branches WHERE id=$1 FOR UPDATE",[branchId]);
 return member.rows[0];
}
export async function listBranchRules(branchId:string){
 const db=await database().connect();
 try{
  const current=await effectiveBranchRules(db,branchId);
  const proposals=await db.query(`SELECT p.*,c.public_name AS proposer,v.revision AS activated_revision,
   COALESCE((SELECT array_agg(a.candidacy_id ORDER BY a.candidacy_id) FROM branch_rule_approvals a WHERE a.proposal_id=p.id),ARRAY[]::uuid[]) AS approvers
   FROM branch_rule_proposals p JOIN candidacies c ON c.id=p.proposed_by_candidacy_id
   LEFT JOIN branch_rule_versions v ON v.proposal_id=p.id WHERE p.branch_id=$1 ORDER BY p.created_at DESC,p.id DESC`,[branchId]);
  return {current,proposals:proposals.rows};
 }finally{db.release()}
}
export async function proposeBranchRules(input:{branchId:string;candidateId:string;authSubject:string;baseRevision:number;maxResponseSeconds:number;replyWindowHours:number|null;allowedModalities:unknown}){
 if(!Number.isInteger(input.baseRevision)||input.baseRevision<1||!Number.isInteger(input.maxResponseSeconds)||input.maxResponseSeconds<1||input.maxResponseSeconds>7200||
  (input.replyWindowHours!==null&&(!Number.isInteger(input.replyWindowHours)||input.replyWindowHours<1||input.replyWindowHours>720)))throw new HttpError(400,"Use a current rule version, a 1–7200 second limit and an optional 1–720 hour reply window.");
 let allowed:DebateModality[];
 try{if(!Array.isArray(input.allowedModalities))throw Error('Explicit media selection required');allowed=parseModalities(input.allowedModalities).sort()}catch{throw new HttpError(400,"Select supported, unique contribution media.")}
 const sha256=createHash('sha256').update(JSON.stringify({branchId:input.branchId,baseRevision:input.baseRevision,maxResponseSeconds:input.maxResponseSeconds,replyWindowHours:input.replyWindowHours,allowedModalities:allowed})).digest('hex');
 return transaction(async db=>{
  const member=await lockParticipant(db,input.branchId,input.candidateId,input.authSubject);
  const current=await effectiveBranchRules(db,input.branchId);
  if(current.revision!==input.baseRevision)throw new HttpError(409,"The rules changed. Review the current version before proposing another change.");
  const proposal=(await db.query<{id:string}>("INSERT INTO branch_rule_proposals(branch_id,proposed_by_candidacy_id,base_revision,max_response_seconds,reply_window_hours,allowed_modalities,content_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[input.branchId,input.candidateId,input.baseRevision,input.maxResponseSeconds,input.replyWindowHours,allowed,sha256])).rows[0];
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'branch_rules_proposed',$4,$5::jsonb)",[member.debate_id,input.branchId,input.candidateId,proposal.id,JSON.stringify({sha256,baseRevision:input.baseRevision})]);
  return {proposalId:proposal.id,sha256};
 });
}
export async function approveBranchRules(input:{branchId:string;proposalId:string;candidateId:string;authSubject:string;sha256:string}){
 return transaction(async db=>{
  const member=await lockParticipant(db,input.branchId,input.candidateId,input.authSubject);
  const proposal=(await db.query<{id:string;base_revision:number;content_sha256:string}>("SELECT id,base_revision,content_sha256 FROM branch_rule_proposals WHERE id=$1 AND branch_id=$2",[input.proposalId,input.branchId])).rows[0];
  if(!proposal)throw new HttpError(404,"Rule proposal not found in this branch.");
  if(proposal.content_sha256!==input.sha256)throw new HttpError(409,"Approve the exact rule proposal digest you reviewed.");
  const existing=await db.query<{revision:number}>("SELECT revision FROM branch_rule_versions WHERE proposal_id=$1",[input.proposalId]);
  if(existing.rowCount)return {activated:true,revision:existing.rows[0].revision,alreadyActivated:true};
  const current=await effectiveBranchRules(db,input.branchId);
  if(current.revision!==proposal.base_revision)throw new HttpError(409,"This proposal is based on superseded rules. Propose a new version.");
  const approval=await db.query("INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[input.proposalId,input.sha256,input.candidateId]);
  if(!approval.rowCount)return {activated:false,revision:current.revision,alreadyApproved:true};
  const count=await db.query<{n:number}>("SELECT count(*)::integer AS n FROM branch_rule_approvals WHERE proposal_id=$1",[input.proposalId]);
  const activated=count.rows[0].n===2;
  if(activated)await db.query("INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,$2,$3)",[input.branchId,current.revision+1,input.proposalId]);
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[member.debate_id,input.branchId,input.candidateId,activated?'branch_rules_activated':'branch_rules_approved',input.proposalId,JSON.stringify({sha256:input.sha256,revision:activated?current.revision+1:null})]);
  return {activated,revision:activated?current.revision+1:current.revision};
 });
}
