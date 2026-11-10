import {NextResponse} from "next/server";
import {database} from "../../../lib/server/db";
import {scannerOnline,usesLaptopScanner} from '../../../lib/server/scanner-status';
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 try{
  if(!process.env.NEON_AUTH_BASE_URL?.startsWith("https://")||(process.env.NEON_AUTH_COOKIE_SECRET?.length??0)<32||!process.env.MEDIA_BUCKET||!process.env.AWS_ENDPOINT_URL_S3?.startsWith("https://")||!process.env.AWS_ACCESS_KEY_ID||!process.env.AWS_SECRET_ACCESS_KEY)
    return NextResponse.json({status:"not_ready",reason:"Auth or media storage configuration missing"},{status:503,headers:{"Cache-Control":"no-store"}});
  const result=await database().query("SELECT to_regclass('public.debates') AS debate_table, to_regclass('public.media_assets') AS media_table");
  if(!result.rows[0]?.debate_table||!result.rows[0]?.media_table)throw Error("Schema unavailable");
  const migrations=await database().query("SELECT filename FROM schema_migrations WHERE filename IN ('0018_media_scan_attestations.sql','0019_local_media_scanner.sql','0020_processing_entitlements.sql')");
  if(migrations.rowCount!==3)throw Error("Required media schema unavailable");
  // A sleeping laptop scanner blocks new uploads, not reading the public archive.
  if(!usesLaptopScanner()&&!await scannerOnline())return NextResponse.json({status:"not_ready",reason:"Required media scanner offline"},{status:503,headers:{"Cache-Control":"no-store"}});
  if(usesLaptopScanner()&&(process.env.SCANNER_WORKER_TOKEN?.length??0)<64)throw Error('Scanner pairing configuration missing');
  return NextResponse.json({status:"ready",database:"connected",archive:"configured",mediaScanner:await scannerOnline()?'online':'offline_uploads_paused'},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({status:"not_ready",reason:"Required database schema unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
