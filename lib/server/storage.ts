import "server-only";
import { S3Client,GetObjectCommand,PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError } from "./http";

let s3:S3Client|undefined;
export function objectStorage(){
 const endpoint=process.env.AWS_ENDPOINT_URL_S3;
 if(!endpoint?.startsWith("https://") || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.MEDIA_BUCKET)
   throw new HttpError(503,"Permanent media storage is not configured.");
 s3??=new S3Client({
   endpoint,region:process.env.AWS_REGION||"us-east-2",forcePathStyle:true,
   credentials:{accessKeyId:process.env.AWS_ACCESS_KEY_ID,secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY}
 });
 return {client:s3,bucket:process.env.MEDIA_BUCKET};
}
export async function storeOriginal(key:string,bytes:Buffer,contentType:string){
 const {client,bucket}=objectStorage();
 await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:contentType,
   CacheControl:"private, no-store",Metadata:{archival:"original-unaltered"}}));
}
export async function playOriginal(key:string){
 const {client,bucket}=objectStorage();
 return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:"inline"}),{expiresIn:300});
}

/** A short-lived signed upload for the operator-laptop encoder. The server re-hashes the object before accepting it. */
export async function presignUpload(key:string,contentType:string){
 const {client,bucket}=objectStorage();
 return getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType,CacheControl:"private, no-store"}),{expiresIn:30*60});
}
/** Stream a stored object and return its SHA-256 and size, refusing anything larger than maxBytes. */
export async function hashStoredObject(key:string,maxBytes:number){
 const {client,bucket}=objectStorage();
 let result;
 try{result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}));}
 catch{throw new HttpError(409,"The uploaded rendition was not found in storage.");}
 const hash=createHash("sha256");let size=0;
 for await(const chunk of result.Body as AsyncIterable<Uint8Array>){
  size+=chunk.length;
  if(size>maxBytes)throw new HttpError(413,"The uploaded rendition exceeds the size limit.");
  hash.update(chunk);
 }
 return {sha256:hash.digest("hex"),size};
}
