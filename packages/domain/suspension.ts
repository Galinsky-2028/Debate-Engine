/**
 * Account suspension rules. A suspension stops an account from acting; it never removes, hides or
 * rewrites published contributions or their attribution. Grounds are limited to the published
 * restriction categories, every step carries a public notice, and when more than one platform
 * administrator is configured, a different administrator must reinstate the account.
 */
import {RestrictionRuleError,readCategory,readPrivateBasis,readPublicNotice,type RestrictionCategory} from "./restrictions.ts";

export const SUSPENSION_CONFIRMATION="SUSPEND THIS ACCOUNT";
export type SuspensionInput={reasonCategory:RestrictionCategory;publicNotice:string;privateBasis:string|null};

export function readSuspension(input:Record<string,unknown>):SuspensionInput{
 if(input.confirmation!==SUSPENSION_CONFIRMATION)throw new RestrictionRuleError("Type "+SUSPENSION_CONFIRMATION+" exactly to confirm the suspension.");
 return {reasonCategory:readCategory(input.reasonCategory),publicNotice:readPublicNotice(input.publicNotice),privateBasis:readPrivateBasis(input.privateBasis)};
}
export function readReinstatement(input:Record<string,unknown>){
 return {publicNotice:readPublicNotice(input.publicNotice),privateBasis:readPrivateBasis(input.privateBasis)};
}
/** Who may act on whom: never on one's own account, and a closed account is final. */
export function suspensionTransition(action:"suspend"|"reinstate",status:string,isSelf:boolean){
 if(isSelf)return {ok:false as const,code:403,message:"An administrator cannot suspend or reinstate their own account."};
 if(status==="closed")return {ok:false as const,code:409,message:"A closed account is final and cannot be suspended or reinstated."};
 if(action==="suspend"&&status!=="active")return {ok:false as const,code:409,message:"Only an active account can be suspended."};
 if(action==="reinstate"&&status!=="suspended")return {ok:false as const,code:409,message:"Only a suspended account can be reinstated."};
 return {ok:true as const};
}
