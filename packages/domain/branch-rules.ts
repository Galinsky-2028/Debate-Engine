/**
 * Neutral, pure rules for prospective, mutually accepted changes to one branch's limits.
 * Version 1 is always the debate's original published rules.
 */
export type BranchRuleTerms={maxResponseSeconds:number;replyWindowHours:number|null};
export type BranchRuleVersion=BranchRuleTerms&{revision:number};
export type RuleProposal=BranchRuleTerms&{id:string;proposedBy:string;baseRevision:number};

export function parseRuleProposalTerms(raw:{maxResponseSeconds:unknown;replyWindowHours:unknown;baseRevision:unknown}):BranchRuleTerms&{baseRevision:number}{
 const baseRevision=Number(raw.baseRevision),maxResponseSeconds=Number(raw.maxResponseSeconds);
 const replyWindowHours=raw.replyWindowHours===null||raw.replyWindowHours===undefined||raw.replyWindowHours===""?null:Number(raw.replyWindowHours);
 if(!Number.isSafeInteger(baseRevision)||baseRevision<1)throw Error("Name the current rules version you are changing.");
 if(!Number.isSafeInteger(maxResponseSeconds)||maxResponseSeconds<1||maxResponseSeconds>7200)
  throw Error("The response limit must be a whole number from 1 to 7200 seconds.");
 if(replyWindowHours!==null&&(!Number.isSafeInteger(replyWindowHours)||replyWindowHours<1||replyWindowHours>720))
  throw Error("The reply window must be empty (no fixed deadline) or a whole number from 1 to 720 hours.");
 return {baseRevision,maxResponseSeconds,replyWindowHours};
}

/** A proposal activates only when both branch participants accepted it and it still extends the current version. */
export function ruleProposalOutcome(input:{proposal:RuleProposal;currentRevision:number;participants:readonly [string,string];acceptedBy:readonly string[]}):
 {state:"active_next"|"awaiting_other_participant"|"superseded";missing:string[]}{
 const [a,b]=input.participants;
 if(!a||!b||a===b)throw Error("A branch has two distinct participants.");
 if(!input.participants.includes(input.proposal.proposedBy))throw Error("Only a branch participant may propose rules.");
 if(input.proposal.baseRevision!==input.currentRevision)return {state:"superseded",missing:[]};
 const valid=new Set(input.acceptedBy.filter(x=>x===a||x===b));
 const missing=[a,b].filter(x=>!valid.has(x));
 return {state:missing.length?"awaiting_other_participant":"active_next",missing};
}

/** The rules a NEW contribution is judged by. Earlier contributions keep their recorded version. */
export function rulesInForce(original:BranchRuleTerms,activated:readonly BranchRuleVersion[]):BranchRuleVersion{
 const latest=[...activated].sort((x,y)=>x.revision-y.revision).at(-1);
 return latest||{revision:1,...original};
}
