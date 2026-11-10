import 'server-only';
import {database} from './db';
import {probeClamd} from '../../packages/media/clamav';
export function usesLaptopScanner(){return process.env.PDE_SCANNER_MODE==='pull';}
export async function scannerOnline(){
 if(!usesLaptopScanner())return probeClamd(process.env.CLAMD_SOCKET_PATH||'');
 if((process.env.SCANNER_WORKER_TOKEN?.length??0)<64)return false;
 try {
  const r=await database().query("SELECT 1 FROM media_scanner_heartbeat WHERE id=true AND last_seen_at>now()-interval '45 seconds'");
  return Boolean(r.rowCount);
 } catch {return false;}
}
