import {NextResponse} from "next/server";
import {requireAdmin,jsonError} from "../../../../../lib/server/http";
import {listSuspensionsAdmin} from "../../../../../lib/server/account-suspension";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 try{await requireAdmin();
  return NextResponse.json({accounts:await listSuspensionsAdmin()},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
