import {NextRequest,NextResponse} from 'next/server';
import {claimScan,requireScannerWorker} from '../../../../lib/server/laptop-scanner';
import {jsonError} from '../../../../lib/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 try{requireScannerWorker(request);return NextResponse.json({job:await claimScan()},{headers:{'Cache-Control':'private,no-store'}});}
 catch(e){return jsonError(e);}
}
