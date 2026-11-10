import {NextRequest,NextResponse} from 'next/server';
import {completeScan,requireScannerWorker} from '../../../../../lib/server/laptop-scanner';
import {parseJson,record,uuid,field,jsonError,HttpError} from '../../../../../lib/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  requireScannerWorker(request);
  const body=record(await parseJson(request));
  if(!['clean','detected','unavailable'].includes(String(body.verdict)))throw new HttpError(400,'Invalid scan verdict.');
  await completeScan({id:uuid((await params).id,'job ID'),sha256:field(body.sha256,'sha256',64),leaseToken:uuid(body.leaseToken,'lease token'),verdict:body.verdict as 'clean'|'detected'|'unavailable'});
  return NextResponse.json({recorded:true},{headers:{'Cache-Control':'private,no-store'}});
 }catch(e){return jsonError(e);}
}
