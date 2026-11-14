import {NextRequest} from "next/server";
import {database} from "../../lib/server/db";
import {rssFeed} from "../../packages/domain/xml";
import {JOINT_AGREEMENT_RECORDS_SQL} from "../../lib/server/policy-agreement-sql";
import {agreementFeedItems,type AgreementScope} from "../../packages/domain/policy-view";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Entry={policy_version_id:string;title:string;debate_id:string;originator:string;contender:string;scope:AgreementScope;
 currently_joint:boolean;withdrawn_at:string|null;withdrawn_by:string|null;last_joint_at:string};
export async function GET(request:NextRequest){
 try{
  // Current status comes from the latest endorsement event per candidate; withdrawn agreements stay listed as withdrawn.
  const result=await database().query<Entry>(JOINT_AGREEMENT_RECORDS_SQL,[null]);
  const base=process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL||request.nextUrl.origin;
  const entries=result.rows.flatMap(r=>agreementFeedItems({policyVersionId:r.policy_version_id,title:r.title,originator:r.originator,
   contender:r.contender,scope:r.scope,currentlyJoint:r.currently_joint,withdrawnAt:r.withdrawn_at,withdrawnBy:r.withdrawn_by,lastJointAt:r.last_joint_at})
   .map(item=>({...item,url:new URL("/debates/"+r.debate_id,base).toString()})))
   .sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,60);
  return new Response(rssFeed(new URL("/press",base).toString(),entries),{headers:{"content-type":"application/rss+xml; charset=utf-8","cache-control":"public,max-age=300","x-content-type-options":"nosniff"}});
 }catch{return new Response("Feed temporarily unavailable.",{status:503,headers:{"cache-control":"no-store"}});}
}
