import {NextResponse} from "next/server";
import {database} from "../../../lib/server/db";
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assessRuntimeReadiness,runtimeConfigurationIssue,REQUIRED_RUNTIME_TABLES,type MigrationFingerprint} from '../../../packages/domain/runtime-readiness';
export const runtime="nodejs";export const dynamic="force-dynamic";
let inventory:Promise<MigrationFingerprint[]>|undefined;
function releaseMigrations(){
 inventory??=(async()=>{
  const directory=join(process.cwd(),'packages/database/migrations');
  const names=(await readdir(directory)).filter(name=>/^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async filename=>({filename,sha256:createHash('sha256').update(await readFile(join(directory,filename))).digest('hex')})));
 })();
 return inventory;
}
export async function GET(){
 try{
  const issue=runtimeConfigurationIssue(process.env);
  if(issue)return NextResponse.json({status:'not_ready',reason:issue},{status:503,headers:{'Cache-Control':'no-store'}});
  const expectedMigrations=await releaseMigrations();
  const [applied,tables]=await Promise.all([
   database().query<MigrationFingerprint>('SELECT filename,sha256 FROM schema_migrations'),
   database().query<{name:string;relation:string|null}>('SELECT name,to_regclass(\'public.\'||name) AS relation FROM unnest($1::text[]) name',[REQUIRED_RUNTIME_TABLES]),
  ]);
  const result=assessRuntimeReadiness({configuration:process.env,expectedMigrations,appliedMigrations:applied.rows,presentTables:tables.rows.filter(t=>t.relation).map(t=>t.name)});
  if(!result.ready)return NextResponse.json({status:'not_ready',reason:result.reason},{status:503,headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({status:"ready",database:"connected",archive:"configured",schemaRevision:expectedMigrations.at(-1)?.filename},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({status:"not_ready",reason:"Required database schema unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
