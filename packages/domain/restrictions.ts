/**
 * Pure rules for exceptional platform restrictions, appeals, account closure and
 * candidacy withdrawal. No server imports: shared by server code, UI and tests.
 * Campaign ownership is never moderation authority; restrictions never delete or
 * rewrite the published row, they only withhold its bytes behind a public notice.
 */
export const restrictionTargetKinds=["submission","document","derivative"] as const;
export type RestrictionTargetKind=typeof restrictionTargetKinds[number];
export const restrictionCategories=["malware_or_security","unlawful_content","private_information","legal_order","impersonation"] as const;
export type RestrictionCategory=typeof restrictionCategories[number];
export const restrictionCategoryLabels:Record<RestrictionCategory,string>={
 malware_or_security:"Malware or security risk",
 unlawful_content:"Content restricted under applicable law",
 private_information:"Private personal information",
 legal_order:"Legal order",
 impersonation:"Impersonation"
};
export type RestrictionEventType="opened"|"appealed"|"upheld"|"lifted";
export type AppealStatus="none"|"pending"|"upheld";
export const APPEAL_PUBLIC_NOTICE="The contributor has appealed this restriction.";
export const ACCOUNT_CLOSURE_CONFIRMATION="CLOSE MY ACCOUNT";
export const WITHDRAWAL_CONFIRMATION="WITHDRAW";

export class RestrictionRuleError extends Error{}
function fail(message:string):never{throw new RestrictionRuleError(message);}

export function readTargetKind(value:unknown):RestrictionTargetKind{
 if(typeof value!=="string"||!(restrictionTargetKinds as readonly string[]).includes(value))fail("Target kind must be submission, document or derivative.");
 return value as RestrictionTargetKind;
}
export function readCategory(value:unknown):RestrictionCategory{
 if(typeof value!=="string"||!(restrictionCategories as readonly string[]).includes(value))fail("Reason category is not one of the published restriction categories.");
 return value as RestrictionCategory;
}
function boundedText(value:unknown,label:string,min:number,max:number){
 if(typeof value!=="string")fail(label+" is required.");
 const text=value.trim();
 if(text.length<min||text.length>max)fail(label+" must be "+min+"–"+max+" characters.");
 return text;
}
export const readPublicNotice=(value:unknown)=>boundedText(value,"Public notice",20,1000);
export const readAppealStatement=(value:unknown)=>boundedText(value,"Appeal statement",25,4000);
export function readPrivateBasis(value:unknown){
 if(value===undefined||value===null||value==="")return null;
 return boundedText(value,"Private basis",1,4000);
}
export function readWithdrawalStatement(value:unknown){
 if(value===undefined||value===null||(typeof value==="string"&&!value.trim()))return null;
 return boundedText(value,"Withdrawal statement",1,1000);
}

function words(text:string){return text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);}
/**
 * A public notice must describe a restriction without republishing the material
 * it restricts. Rejects a notice that shares any run of `run` consecutive words
 * (default 6) with the restricted material or the private basis, or contains a
 * short restricted item verbatim.
 */
export function noticeRepeatsMaterial(notice:string,materials:Array<string|null|undefined>,run=6){
 const n=words(notice);
 const grams=new Set<string>();
 for(let i=0;i+run<=n.length;i++)grams.add(n.slice(i,i+run).join(" "));
 const flat=" "+n.join(" ")+" ";
 for(const raw of materials){
  if(!raw)continue;
  const m=words(raw);
  if(m.length===0)continue;
  if(m.length<run){if(m.join(" ").length>=12&&flat.includes(" "+m.join(" ")+" "))return true;continue;}
  for(let i=0;i+run<=m.length;i++)if(grams.has(m.slice(i,i+run).join(" ")))return true;
 }
 return false;
}

/** Appeal status as shown publicly, derived from the ordered event history. */
export function appealStatus(events:Array<{event_type:RestrictionEventType}>):AppealStatus{
 const last=events.at(-1)?.event_type;
 if(last==="appealed")return "pending";
 if(events.some(e=>e.event_type==="upheld"))return "upheld";
 return "none";
}
/** Which next events the append-only state machine accepts (mirrors the SQL trigger). */
export function allowedNextEvents(events:Array<{event_type:RestrictionEventType}>):RestrictionEventType[]{
 if(events.length===0)return ["opened"];
 const last=events.at(-1)!.event_type;
 if(last==="lifted")return [];
 if(last==="appealed")return ["upheld","lifted"];
 return ["appealed","lifted"];
}
export function configuredAdminCount(raw:string|undefined){
 return new Set((raw??"").split(",").map(x=>x.trim()).filter(Boolean)).size;
}
/**
 * When more than one platform administrator is configured, the opener may not
 * decide their own case. `independentReview` is recorded truthfully either way.
 */
export function decisionIndependence(openerAccountId:string,deciderAccountId:string,adminCount:number){
 const independentReview=openerAccountId!==deciderAccountId;
 return {independentReview,permitted:independentReview||adminCount<=1};
}
export function readDecision(value:unknown):"uphold"|"lift"{
 if(value!=="uphold"&&value!=="lift")fail("Decision must be uphold or lift.");
 return value;
}
export function withdrawalLabel(withdrawnAt:string|Date|null|undefined){
 if(!withdrawnAt)return null;
 return "Withdrew from this election on "+new Date(withdrawnAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"});
}
