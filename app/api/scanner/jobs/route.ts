import {NextRequest,NextResponse} from 'next/server';
import {claimScan,requireScannerWorker} from '../../../../lib/server/laptop-scanner';
import {claimEncode} from '../../../../lib/server/playback-encodes';
import {jsonError} from '../../../../lib/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
/** Safety scans always come first. A worker that reports the encode capability also receives playback encodes. */
export async function POST(request:NextRequest){
 try{requireScannerWorker(request);
  let capabilities:unknown=[];
  try{capabilities=((await request.json()) as {capabilities?:unknown})?.capabilities??[];}catch{}
  const scan=await claimScan();
  const job=scan?{kind:'scan' as const,...scan}:(Array.isArray(capabilities)&&capabilities.includes('encode')?await claimEncode():null);
  return NextResponse.json({job},{headers:{'Cache-Control':'private,no-store'}});}
 catch(e){return jsonError(e);}
}
