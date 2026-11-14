import "server-only";
import type {NextRequest} from "next/server";
import {HttpError} from "./http";
import {BodyTooLarge,declaredLengthTooLarge,readBounded} from "../../packages/domain/bounded-body";

/** Never buffer an unbounded (for example chunked) request body into memory. */
export async function boundedBytes(request:NextRequest,maxBytes:number,message="Request is too large."){
 if(declaredLengthTooLarge(request.headers.get("content-length"),maxBytes))throw new HttpError(413,message);
 try{return await readBounded(request.body,maxBytes);}
 catch(e){if(e instanceof BodyTooLarge)throw new HttpError(413,message);throw e;}
}
export async function boundedText(request:NextRequest,maxBytes:number,message?:string){
 return new TextDecoder().decode(await boundedBytes(request,maxBytes,message));
}
/** Parse multipart form data only after the raw body has been capped. */
export async function boundedFormData(request:NextRequest,maxBytes:number,message?:string){
 const bytes=await boundedBytes(request,maxBytes,message);
 const type=request.headers.get("content-type")||"";
 if(!type.toLowerCase().startsWith("multipart/form-data"))throw new HttpError(415,"Expected multipart/form-data.");
 try{return await new Response(new Blob([bytes]),{headers:{"content-type":type}}).formData();}
 catch{throw new HttpError(400,"Invalid multipart form data.");}
}
