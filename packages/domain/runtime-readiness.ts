export const REQUIRED_RUNTIME_VARIABLES=['DATABASE_URL','NEON_AUTH_BASE_URL','NEON_AUTH_COOKIE_SECRET','MEDIA_BUCKET','AWS_ENDPOINT_URL_S3','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'] as const;
export const REQUIRED_RUNTIME_TABLES=['accounts','candidacies','debates','debate_branches','submissions','questions','answers','assessments','media_assets','media_scan_attestations','reply_obligations','private_submission_drafts','qualifying_sequence_manifests','branch_rule_proposals','branch_rule_approvals','branch_rule_versions'] as const;
export type MigrationFingerprint={filename:string;sha256:string};
export function runtimeConfigurationIssue(configuration:Record<string,string|undefined>):string|null{
 if(REQUIRED_RUNTIME_VARIABLES.some(name=>!configuration[name]?.trim()))return 'Required authentication, database or media storage configuration missing';
 if(configuration.NEON_AUTH_COOKIE_SECRET!.length<32)return 'Authentication cookie configuration is incomplete';
 for(const name of ['NEON_AUTH_BASE_URL','AWS_ENDPOINT_URL_S3']){
  try{const url=new URL(configuration[name]!);if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid endpoint')}
  catch{return 'Authentication and media storage endpoints must use HTTPS'}
 }
 if(!/^postgres(?:ql)?:\/\//.test(configuration.DATABASE_URL!))return 'Database configuration is invalid';
 return null;
}
export function assessRuntimeReadiness(input:{configuration:Record<string,string|undefined>;expectedMigrations:MigrationFingerprint[];appliedMigrations:MigrationFingerprint[];presentTables:string[]}){
 const issue=runtimeConfigurationIssue(input.configuration);
 if(issue)return {ready:false,reason:issue};
 if(!input.expectedMigrations.length)return {ready:false,reason:'Release migration inventory unavailable'};
 const applied=new Map(input.appliedMigrations.map(m=>[m.filename,m.sha256]));
 if(input.expectedMigrations.some(m=>applied.get(m.filename)!==m.sha256))return {ready:false,reason:'Database migrations do not match this release'};
 const tables=new Set(input.presentTables);
 if(REQUIRED_RUNTIME_TABLES.some(table=>!tables.has(table)))return {ready:false,reason:'Required database schema unavailable'};
 return {ready:true,reason:null};
}
