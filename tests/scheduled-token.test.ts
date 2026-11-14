import test from "node:test";
import assert from "node:assert/strict";
import {scheduledTokenValid} from "../packages/domain/scheduled-token.ts";
const token="a".repeat(64);
test("only the exact configured bearer token authorizes a scheduled run",()=>{
 assert.equal(scheduledTokenValid(token,"Bearer "+token),true);
 assert.equal(scheduledTokenValid(token,"Bearer "+token.slice(1)+"b"),false);
 assert.equal(scheduledTokenValid(token,token),false);
 assert.equal(scheduledTokenValid(token,null),false);
 assert.equal(scheduledTokenValid(token,"Bearer "),false);
 assert.equal(scheduledTokenValid(token,"Bearer "+"x".repeat(300)),false);
});
test("an unset or short configured token never authorizes",()=>{
 assert.equal(scheduledTokenValid(undefined,"Bearer "),false);
 assert.equal(scheduledTokenValid("",'Bearer '),false);
 assert.equal(scheduledTokenValid("short","Bearer short"),false);
});
