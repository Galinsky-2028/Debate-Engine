import test from "node:test";
import assert from "node:assert/strict";
import {parseRuleProposalTerms,ruleProposalOutcome,rulesInForce} from "../packages/domain/branch-rules.ts";
const proposal={id:"p",proposedBy:"A",baseRevision:1,maxResponseSeconds:120,replyWindowHours:24};
test("a proposal accepted only by its proposer has no effect",()=>{
 const x=ruleProposalOutcome({proposal,currentRevision:1,participants:["A","B"],acceptedBy:["A"]});
 assert.equal(x.state,"awaiting_other_participant");assert.deepEqual(x.missing,["B"]);
});
test("both participants' acceptance activates the next version; a third candidate's acceptance counts for nothing",()=>{
 assert.equal(ruleProposalOutcome({proposal,currentRevision:1,participants:["A","B"],acceptedBy:["A","C"]}).state,"awaiting_other_participant");
 assert.equal(ruleProposalOutcome({proposal,currentRevision:1,participants:["A","B"],acceptedBy:["B","A"]}).state,"active_next");
});
test("a proposal based on superseded rules cannot activate",()=>{
 assert.equal(ruleProposalOutcome({proposal,currentRevision:2,participants:["A","B"],acceptedBy:["A","B"]}).state,"superseded");
 assert.throws(()=>ruleProposalOutcome({proposal:{...proposal,proposedBy:"C"},currentRevision:1,participants:["A","B"],acceptedBy:[]}));
});
test("version 1 is the original debate rules; later versions apply only prospectively",()=>{
 assert.deepEqual(rulesInForce({maxResponseSeconds:300,replyWindowHours:48},[]),{revision:1,maxResponseSeconds:300,replyWindowHours:48});
 assert.equal(rulesInForce({maxResponseSeconds:300,replyWindowHours:48},[{revision:3,maxResponseSeconds:90,replyWindowHours:null},{revision:2,maxResponseSeconds:120,replyWindowHours:24}]).revision,3);
});
test("proposal terms are bounded whole numbers; blank reply window means no fixed deadline",()=>{
 assert.deepEqual(parseRuleProposalTerms({baseRevision:1,maxResponseSeconds:"120",replyWindowHours:""}),{baseRevision:1,maxResponseSeconds:120,replyWindowHours:null});
 for(const bad of [{baseRevision:0,maxResponseSeconds:60,replyWindowHours:1},{baseRevision:1,maxResponseSeconds:7201,replyWindowHours:1},{baseRevision:1,maxResponseSeconds:1.5,replyWindowHours:1},{baseRevision:1,maxResponseSeconds:60,replyWindowHours:721}])
  assert.throws(()=>parseRuleProposalTerms(bad));
});
