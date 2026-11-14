import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {transaction,database} from "./db";
import {objectStorage} from "./storage";
import {GetObjectCommand,PutObjectCommand} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {HttpError} from "./http";
import {unzipSync} from "fflate";
import {requireScannerPreflight,scanOriginalBeforeValidation} from "./malware";

const MAX_DOCUMENT=20*1024*1024;
export function inspectDocument(bytes:Buffer,mime:string){
 if(bytes.length<64||bytes.length>MAX_DOCUMENT)throw new HttpError(413,"Document must be between 64 bytes and 20 MiB.");
 let actual:string;
 if(bytes.subarray(0,5).toString("ascii")==="%PDF-")actual="application/pdf";
 else if(bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))actual="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
 else if(mime==="text/plain"&&!bytes.includes(0)&&bytes.toString("utf8").indexOf("�")===-1)actual="text/plain";
 else throw new HttpError(415,"Only PDF, plain text and DOCX sources are supported.");
 if(actual!==mime)throw new HttpError(415,"Document content and type differ.");
 if(actual.endsWith("wordprocessingml.document")&&!isWordDocument(bytes))throw new HttpError(415,"The ZIP container is not a Word (DOCX) document.");
 // Office files must be inspected in a sandbox before in-browser preview;
 // the download endpoint enforces attachment, not inline rendering.
 return {mime:actual,sha256:createHash("sha256").update(bytes).digest("hex")};
}

/** A DOCX is a ZIP with a content-type manifest and a main document part; any other ZIP is refused. */
export function isWordDocument(bytes:Uint8Array){
 const names=new Set<string>();
 try{unzipSync(bytes,{filter:file=>{names.add(file.name);return false;}});}catch{return false;}
 return names.has("[Content_Types].xml")&&names.has("word/document.xml");
}
export async function uploadSource(input:{submissionId:string;authSubject:string;candidacyId:string;name:string;label:string;bytes:Buffer;mime:string}){
 const details=inspectDocument(input.bytes,input.mime);
 const fileId=randomUUID(),key="documents/"+input.candidacyId+"/"+fileId+"/original";
 const ownership=await database().query(
  "SELECT s.id FROM submissions s JOIN candidacies c ON c.id=s.candidacy_id JOIN accounts a ON a.id=c.account_id WHERE s.id=$1 AND s.candidacy_id=$2 AND s.published_at IS NOT NULL AND c.verification_status='verified' AND a.identity_provider='neon-auth' AND a.external_subject=$3",[input.submissionId,input.candidacyId,input.authSubject]);
 if(!ownership.rowCount)throw new HttpError(403,"Only the verified author of this published contribution may add sources.");
 await requireScannerPreflight();
 const {client,bucket}=objectStorage();
 await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:input.bytes,ContentType:details.mime,ContentDisposition:"attachment",CacheControl:"private, no-store"}));
 // Supporting documents become permanent public downloads, so they pass the same malware gate as originals.
 const scan=await scanOriginalBeforeValidation(input.bytes,key);
 return transaction(async db=>{
  const q=await db.query<{id:string;debate_id:string;branch_id:string|null}>(
   "SELECT s.id,s.debate_id,s.branch_id FROM submissions s JOIN candidacies c ON c.id=s.candidacy_id JOIN accounts a ON a.id=c.account_id WHERE s.id=$1 AND s.candidacy_id=$2 AND s.published_at IS NOT NULL AND a.external_subject=$3 FOR UPDATE OF s",[input.submissionId,input.candidacyId,input.authSubject]);
  if(!q.rowCount)throw new HttpError(403,"Contribution authorization changed.");
  const item=await db.query<{id:string}>(
   "INSERT INTO submission_documents(id,submission_id,uploaded_by_candidacy_id,filename,storage_key,sha256,size_bytes,mime_type,label,scanner,scan_verdict,scanned_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING id",[fileId,input.submissionId,input.candidacyId,input.name,key,details.sha256,input.bytes.length,details.mime,input.label,scan.scanner,scan.verdict]);
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'supporting_document_published',$4,$5::jsonb)",[q.rows[0].debate_id,q.rows[0].branch_id,input.candidacyId,item.rows[0].id,JSON.stringify({sha256:details.sha256,filename:input.name})]);
  return {documentId:item.rows[0].id,sha256:details.sha256};
 });
}
export async function publicDocuments(debateId:string){
 const q=await database().query<{id:string;submission_id:string;label:string;filename:string;sha256:string;mime_type:string;published_at:string;restriction:Record<string,unknown>|null}>(
  "SELECT doc.id,doc.submission_id,CASE WHEN pde_active_restriction_case('document',doc.id) IS NULL THEN doc.label ELSE 'Restricted supporting material' END AS label,CASE WHEN pde_active_restriction_case('document',doc.id) IS NULL THEN doc.filename ELSE 'withheld' END AS filename,doc.sha256,doc.mime_type,doc.published_at,pde_public_restriction('document',doc.id) AS restriction FROM submission_documents doc JOIN submissions s ON s.id=doc.submission_id JOIN debates d ON d.id=s.debate_id WHERE d.id=$1 AND s.published_at IS NOT NULL AND d.status='published' ORDER BY doc.published_at,doc.id",[debateId]);
 return q.rows;
}
export async function signedDocumentUrl(documentId:string){
 const q=await database().query<{storage_key:string;filename:string}>(
  "SELECT doc.storage_key,doc.filename FROM submission_documents doc JOIN submissions s ON s.id=doc.submission_id JOIN debates d ON d.id=s.debate_id WHERE doc.id=$1 AND s.published_at IS NOT NULL AND d.status='published'",[documentId]);
 if(!q.rowCount)throw new HttpError(404,"Document not available for public download.");
 const {client,bucket}=objectStorage();
 const safeName=q.rows[0].filename.replace(/[\r\n"\\]/g,"_").replace(/[^\w.\- ]/g,"_");
 return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:q.rows[0].storage_key,ResponseContentDisposition:'attachment; filename="'+safeName+'"'}),{expiresIn:300});
}
