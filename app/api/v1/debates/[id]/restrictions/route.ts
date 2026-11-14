import {NextResponse} from "next/server";
import {database} from "../../../../../../lib/server/db";
import {publicRestrictions} from "../../../../../../lib/server/restrictions";
import {uuid,jsonError,HttpError} from "../../../../../../lib/server/http";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Public restriction history: no account ids and never the private basis. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const id=uuid((await params).id,"debate id");
  const found=await database().query("SELECT 1 FROM debates WHERE id=$1 AND status='published'",[id]);
  if(!found.rowCount)throw new HttpError(404,"No published debate exists with that ID.");
  return NextResponse.json({schemaVersion:"1.0.0",debateId:id,restrictions:await publicRestrictions(id),
   notice:"Exceptional platform restrictions withhold an item's bytes behind a public notice; the item's existence and attribution remain in the record. independentReview records whether the deciding administrator differed from the opener; it is not an external audit."},
   {headers:{"Cache-Control":"public,max-age=30","X-Content-Type-Options":"nosniff"}});
 }catch(e){return jsonError(e);}
}
