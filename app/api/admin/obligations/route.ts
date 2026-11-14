import {NextResponse} from "next/server";
import {requireAdmin,jsonError} from "../../../../lib/server/http";
import {database} from "../../../../lib/server/db";
import {listUnfulfilledObligations} from "../../../../lib/server/outage-adjustments";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 try{await requireAdmin();
  const db=await database().connect();
  try{return NextResponse.json({obligations:await listUnfulfilledObligations(db)},{headers:{"Cache-Control":"private, no-store"}});}finally{db.release();}
 }catch(e){return jsonError(e);}
}
