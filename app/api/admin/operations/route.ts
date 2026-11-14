import {NextResponse} from "next/server";
import {requireAdmin,jsonError} from "../../../../lib/server/http";
import {operationsSnapshot} from "../../../../lib/server/operations";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 try{await requireAdmin();return NextResponse.json(await operationsSnapshot(),{headers:{"Cache-Control":"private, no-store"}});}
 catch(e){return jsonError(e);}
}
