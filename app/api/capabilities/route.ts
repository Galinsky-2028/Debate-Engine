import {NextResponse} from "next/server";
import {scannerOnline as checkScanner} from '../../../lib/server/scanner-status';
import {storageBudget,renderBudget} from '../../../lib/server/budget';
import {emailProviderConfig} from '../../../packages/delivery/email.ts';
export const dynamic="force-dynamic";
export const runtime="nodejs";
/**
 * Public, secret-free operational capability disclosure.
 * A scanner PONG is a preflight check, never independent security acceptance.
 */
export async function GET(){
 const storageConfigured=Boolean(
  process.env.AWS_ENDPOINT_URL_S3?.startsWith("https://")&&
  process.env.MEDIA_BUCKET&&process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_SECRET_ACCESS_KEY
 );
 const scannerOnline=await checkScanner();
 // Budget states only; exact usage is visible to administrators on the operations page.
 const storage=await storageBudget().catch(()=>null),render=await renderBudget().catch(()=>null);
 const storageOpen=storage?storage.allowed:true;
 return NextResponse.json({
  mediaScanner:scannerOnline?"online":"unavailable",
  mediaStorageConfigured:storageConfigured,
  newMediaUploadPreflight:scannerOnline&&storageConfigured&&storageOpen?"available_for_validation":"blocked",
  mediaStorageBudget:!storage?"unknown":!storage.configured?"not_configured":storage.allowed?"available":"exhausted",
  mediaStorageBudgetMessage:storage&&!storage.allowed?storage.message:null,
  optionalRendering:!render?"unknown":!render.configured?"no_budget_configured":render.allowed?"available":"paused_budget_exhausted",
  optionalRenderingMessage:render&&!render.allowed?render.message:null,
  emailProvider:emailProviderConfig(process.env)?"configured":"not_configured",
  productionMediaAcceptance:"pending",
  note:"Preflight readiness does not certify official malware signatures, end-to-end uploads or release acceptance."
 },{headers:{"Cache-Control":"no-store"}});
}
