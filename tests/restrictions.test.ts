import test from "node:test";
import assert from "node:assert/strict";
import {
 noticeRepeatsMaterial,appealStatus,allowedNextEvents,decisionIndependence,configuredAdminCount,
 readCategory,readTargetKind,readPublicNotice,readAppealStatement,readPrivateBasis,readDecision,
 readWithdrawalStatement,withdrawalLabel,RestrictionRuleError,APPEAL_PUBLIC_NOTICE,restrictionCategories,restrictionCategoryLabels
} from "../packages/domain/restrictions.ts";

test("public notices may not repeat restricted material or the private basis",()=>{
 const material="The fictional speaker read out 12 Example Lane Springfield and a private phone number in full.";
 assert.equal(noticeRepeatsMaterial("Withheld because it discloses a private individual's home address.",[material]),false);
 assert.equal(noticeRepeatsMaterial("Withheld: read out 12 Example Lane Springfield and a private number.",[material]),true);
 assert.equal(noticeRepeatsMaterial("Withheld after a report naming secret-codeword-xyz in the item.",["secret-codeword-xyz"]),true);
 assert.equal(noticeRepeatsMaterial("Withheld for a security reason pending review.",[null,undefined,""]),false);
});

test("appeal status and the event state machine mirror the database trigger",()=>{
 assert.equal(appealStatus([{event_type:"opened"}]),"none");
 assert.equal(appealStatus([{event_type:"opened"},{event_type:"appealed"}]),"pending");
 assert.equal(appealStatus([{event_type:"opened"},{event_type:"appealed"},{event_type:"upheld"}]),"upheld");
 assert.deepEqual(allowedNextEvents([]),["opened"]);
 assert.deepEqual(allowedNextEvents([{event_type:"opened"}]),["appealed","lifted"]);
 assert.deepEqual(allowedNextEvents([{event_type:"opened"},{event_type:"appealed"}]),["upheld","lifted"]);
 assert.deepEqual(allowedNextEvents([{event_type:"opened"},{event_type:"lifted"}]),[]);
});

test("a second configured administrator must decide; independence is recorded truthfully",()=>{
 assert.equal(configuredAdminCount(" a, b ,a,,"),2);
 assert.equal(configuredAdminCount(undefined),0);
 assert.deepEqual(decisionIndependence("x","x",2),{independentReview:false,permitted:false});
 assert.deepEqual(decisionIndependence("x","x",1),{independentReview:false,permitted:true});
 assert.deepEqual(decisionIndependence("x","y",1),{independentReview:true,permitted:true});
});

test("inputs are validated against published categories and length limits",()=>{
 assert.equal(readCategory("legal_order"),"legal_order");
 assert.throws(()=>readCategory("embarrassing_to_opponent"),RestrictionRuleError);
 assert.equal(readTargetKind("document"),"document");
 assert.throws(()=>readTargetKind("debate"),RestrictionRuleError);
 assert.throws(()=>readPublicNotice("too short"),RestrictionRuleError);
 assert.throws(()=>readPublicNotice("x".repeat(1001)),RestrictionRuleError);
 assert.throws(()=>readAppealStatement("short appeal"),RestrictionRuleError);
 assert.equal(readPrivateBasis(""),null);
 assert.throws(()=>readDecision("delete"),RestrictionRuleError);
 assert.equal(readWithdrawalStatement("  "),null);
 assert.throws(()=>readWithdrawalStatement("x".repeat(1001)),RestrictionRuleError);
 assert.ok(APPEAL_PUBLIC_NOTICE.length>=20);
 for(const c of restrictionCategories)assert.ok(restrictionCategoryLabels[c]);
});

test("withdrawal label is neutral and dated",()=>{
 assert.equal(withdrawalLabel("2032-03-05T12:00:00Z"),"Withdrew from this election on March 5, 2032");
 assert.equal(withdrawalLabel(null),null);
 assert.doesNotMatch(withdrawalLabel("2032-03-05T12:00:00Z")!,/concede|forfeit/i);
});
