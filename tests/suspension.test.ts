import test from "node:test";
import assert from "node:assert/strict";
import {RestrictionRuleError} from "../packages/domain/restrictions.ts";
import {SUSPENSION_CONFIRMATION,readReinstatement,readSuspension,suspensionTransition} from "../packages/domain/suspension.ts";

const notice="Suspended after repeated sign-in attempts from a compromised device.";

test("a suspension needs the exact confirmation, a published ground and a public notice",()=>{
 const ok=readSuspension({confirmation:SUSPENSION_CONFIRMATION,reasonCategory:"malware_or_security",publicNotice:notice,privateBasis:""});
 assert.deepEqual(ok,{reasonCategory:"malware_or_security",publicNotice:notice,privateBasis:null});
 assert.throws(()=>readSuspension({confirmation:"suspend this account",reasonCategory:"malware_or_security",publicNotice:notice}),RestrictionRuleError);
 assert.throws(()=>readSuspension({confirmation:SUSPENSION_CONFIRMATION,reasonCategory:"rude_debating",publicNotice:notice}),/published restriction categories/);
 assert.throws(()=>readSuspension({confirmation:SUSPENSION_CONFIRMATION,reasonCategory:"impersonation",publicNotice:"too short"}),/Public notice/);
 assert.throws(()=>readReinstatement({publicNotice:""}),/Public notice/);
 assert.equal(readReinstatement({publicNotice:notice}).privateBasis,null);
});

test("nobody acts on their own account, closure is final, and only the matching status changes",()=>{
 assert.equal(suspensionTransition("suspend","active",false).ok,true);
 assert.equal(suspensionTransition("reinstate","suspended",false).ok,true);
 const self=suspensionTransition("suspend","active",true);
 assert.equal(self.ok,false);if(!self.ok)assert.equal(self.code,403);
 for(const action of ["suspend","reinstate"] as const){
  const closed=suspensionTransition(action,"closed",false);
  assert.equal(closed.ok,false);if(!closed.ok)assert.equal(closed.code,409);
 }
 assert.equal(suspensionTransition("suspend","suspended",false).ok,false);
 assert.equal(suspensionTransition("reinstate","active",false).ok,false);
});
