/** Explicit smoke test of a private bucket; never creates a public contribution. */
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
const endpoint=process.env.AWS_ENDPOINT_URL_S3;
const bucket=process.env.MEDIA_BUCKET;
if(!endpoint?.startsWith('https://')||!bucket)throw Error('Explicit HTTPS storage endpoint and bucket required.');
const client=new S3Client({endpoint,region:process.env.AWS_REGION||'us-east-2',forcePathStyle:true});
const key='operations/smoke/'+randomUUID()+'.txt';
const body='Fictional storage connectivity fixture. Not a published candidate contribution.';
try {
 const upload=await getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:'text/plain'}),{expiresIn:60});
 const stored=await fetch(upload,{method:'PUT',headers:{'content-type':'text/plain'},body});
 assert.ok(stored.ok,'Private storage upload failed: '+stored.status);
 const signed=await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:60});
 const response=await fetch(signed);
 assert.equal(response.status,200);assert.equal(await response.text(),body);
 const unsigned=await fetch(endpoint+'/'+bucket+'/'+key);
 assert.ok([401,403,404].includes(unsigned.status),'Bucket must reject unauthenticated reads.');
 console.log('PASS: private object write, signed playback, and anonymous access rejection.');
} finally {
 const cleanup=await getSignedUrl(client,new DeleteObjectCommand({Bucket:bucket,Key:key}),{expiresIn:60});
 const deleted=await fetch(cleanup,{method:'DELETE'});
 assert.ok(deleted.ok,'Storage fixture cleanup failed: '+deleted.status);
 client.destroy();
}
