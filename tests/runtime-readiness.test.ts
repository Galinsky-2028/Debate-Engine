import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRuntimeReadiness,REQUIRED_RUNTIME_TABLES} from '../packages/domain/runtime-readiness.ts';
const configuration={DATABASE_URL:'postgresql://fixture@localhost/fixture',NEON_AUTH_BASE_URL:'https://auth.example.invalid/neondb/auth',NEON_AUTH_COOKIE_SECRET:'test-only-'.repeat(5),MEDIA_BUCKET:'fixture-media',AWS_ENDPOINT_URL_S3:'https://storage.example.invalid',AWS_ACCESS_KEY_ID:'fixture',AWS_SECRET_ACCESS_KEY:'fixture'};
const expectedMigrations=[{filename:'0021_branch_rule_versions.sql',sha256:'a'.repeat(64)}];
const input={configuration,expectedMigrations,appliedMigrations:expectedMigrations,presentTables:[...REQUIRED_RUNTIME_TABLES]};
test('configured runtime with the exact release schema is ready',()=>assert.equal(assessRuntimeReadiness(input).ready,true));
test('old databases cannot become ready just because debates and media tables exist',()=>{
 assert.equal(assessRuntimeReadiness({...input,appliedMigrations:[],presentTables:['debates','media_assets']}).ready,false);
 assert.equal(assessRuntimeReadiness({...input,presentTables:input.presentTables.filter(t=>t!=='branch_rule_versions')}).ready,false);
 assert.equal(assessRuntimeReadiness({...input,appliedMigrations:[{...expectedMigrations[0],sha256:'b'.repeat(64)}]}).ready,false);
});
test('missing credentials and an unusable signing key cannot report readiness',()=>{
 for(const name of Object.keys(configuration))assert.equal(assessRuntimeReadiness({...input,configuration:{...configuration,[name]:''}}).ready,false,name);
 assert.equal(assessRuntimeReadiness({...input,configuration:{...configuration,NEON_AUTH_COOKIE_SECRET:'short'}}).ready,false);
});
test('insecure provider endpoints and missing release inventory fail closed',()=>{
 assert.equal(assessRuntimeReadiness({...input,configuration:{...configuration,AWS_ENDPOINT_URL_S3:'http://storage.example.invalid'}}).ready,false);
 assert.equal(assessRuntimeReadiness({...input,expectedMigrations:[]}).ready,false);
});
test('additive database upgrades preserve readiness of a still-compatible release',()=>{
 assert.equal(assessRuntimeReadiness({...input,appliedMigrations:[...expectedMigrations,{filename:'0022_future.sql',sha256:'c'.repeat(64)}]}).ready,true);
});
