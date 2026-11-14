import "server-only";
import {NextRequest} from "next/server";
import {HttpError,record} from "./http";
import {boundedText} from "./request-body";
export async function parsePrivateJson(request:NextRequest):Promise<Record<string,unknown>>{
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
  throw new HttpError(415,"Expected application/json.");
 const content=await boundedText(request,155000,"Draft exceeds 155 KB.");
 try{return record(JSON.parse(content));}
 catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Invalid draft JSON.");}
}
