export async function prepareMediaLocally(file:File,medium:'audio'|'video'){
 return new Promise<{sha256:string;durationSeconds:number|null}>((resolve,reject)=>{
  const worker=new Worker('/media-prepare.worker.js');
  const timer=setTimeout(()=>{worker.terminate();reject(Error('Local file preparation timed out. Please retry.'));},60000);
  const finish=()=>{clearTimeout(timer);worker.terminate();};
  worker.onmessage=event=>{finish();if(event.data.error)reject(Error(event.data.error));else if(/^[0-9a-f]{64}$/.test(event.data.sha256))resolve({sha256:event.data.sha256,durationSeconds:Number.isFinite(event.data.durationSeconds)&&event.data.durationSeconds>0?event.data.durationSeconds:null});else reject(Error('Local preparation returned an invalid file digest.'));};
  worker.onerror=()=>{finish();reject(Error('Local preparation could not run. Use a current version of Chrome, Firefox, Edge, or Safari.'));};
  worker.postMessage({file});
 });
}
