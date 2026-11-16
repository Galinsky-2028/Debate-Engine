import {NextRequest,NextResponse} from 'next/server';
import {requireScannerWorker} from '../../../../../lib/server/laptop-scanner';
import {completeEncode} from '../../../../../lib/server/playback-encodes';
import {parseJson,record,uuid,jsonError,HttpError} from '../../../../../lib/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  requireScannerWorker(request);
  const body=record(await parseJson(request));
  if(body.outcome!=='ready'&&body.outcome!=='failed')throw new HttpError(400,'Invalid encode outcome.');
  const result=await completeEncode({id:uuid((await params).id,'encode ID'),leaseToken:uuid(body.leaseToken,'lease token'),outcome:body.outcome,
   outputSha256:typeof body.outputSha256==='string'?body.outputSha256:undefined,outputBytes:typeof body.outputBytes==='number'?body.outputBytes:undefined,
   failure:typeof body.failure==='string'?body.failure:undefined});
  return NextResponse.json({recorded:true,...result},{headers:{'Cache-Control':'private,no-store'}});
 }catch(e){return jsonError(e);}
}
