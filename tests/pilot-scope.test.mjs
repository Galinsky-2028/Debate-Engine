import test from 'node:test';
import assert from 'node:assert/strict';
import {isDisposableLocalPilot} from '../scripts/pilot-scope.mjs';
test('local fixture identities require explicit opt-in and an exact disposable copy',()=>{
 const cwd='/tmp/pde-local-pilot-safe';
 const env={PDE_LOCAL_PILOT_RUN:'true',PDE_LOCAL_PILOT_DIRECTORY:cwd};
 assert.equal(isDisposableLocalPilot(env,cwd,false),true);
 assert.equal(isDisposableLocalPilot(env,cwd,true),false);
 assert.equal(isDisposableLocalPilot({},cwd,false),false);
 assert.equal(isDisposableLocalPilot(env,'/workspace/Debate-Engine',false),false);
 assert.equal(isDisposableLocalPilot(env,cwd+'/nested',false),false);
 assert.equal(isDisposableLocalPilot({...env,PDE_LOCAL_PILOT_DIRECTORY:'/tmp/other'},cwd,false),false);
});
