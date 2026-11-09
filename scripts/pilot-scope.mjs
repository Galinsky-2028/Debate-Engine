import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

/** Local fixture identities are restricted to a disposable copy without Git metadata. */
export function isDisposableLocalPilot(env=process.env,cwd=process.cwd(),hasGit=existsSync(resolve(cwd,'.git'))){
 return env.PDE_LOCAL_PILOT_RUN==='true'&&env.PDE_LOCAL_PILOT_DIRECTORY===cwd&&
  /^\/tmp\/pde-local-pilot-[A-Za-z0-9_-]+$/.test(cwd)&&!hasGit;
}
export function isPilotRunner(){
 return (process.env.GITHUB_ACTIONS==='true'&&process.env.PDE_CI_PILOT_RUN==='true')||isDisposableLocalPilot();
}
