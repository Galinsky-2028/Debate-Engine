import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,jsonError,HttpError} from '../../../../lib/server/http';
import {scannerOnline,usesLaptopScanner} from '../../../../lib/server/scanner-status';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 try{
  await requireAdmin();
  if(request.nextUrl.searchParams.get('download')==='1'){
   const token=process.env.SCANNER_WORKER_TOKEN||'';
   const origin=process.env.PUBLIC_APP_ORIGIN;
   if(!usesLaptopScanner()||token.length<64||!origin?.startsWith('https://'))throw new HttpError(503,'Laptop scanning has not been configured.');
   return new Response('PDE_APP_URL='+origin+'\nPDE_SCANNER_TOKEN='+token+'\n',{headers:{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="scanner.env"','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
  }
  return NextResponse.json({mode:usesLaptopScanner()?'laptop':'hosted',online:await scannerOnline()},{headers:{'Cache-Control':'private,no-store'}});
 }catch(e){return jsonError(e);}
}
