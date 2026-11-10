export async function prepareMediaLocally(file:File,medium:'audio'|'video'){
 const digest=await new Promise<string>((resolve,reject)=>{
  const worker=new Worker('/media-prepare.worker.js');
  const timer=setTimeout(()=>{worker.terminate();reject(Error('Local file preparation timed out. Please retry.'));},60000);
  const finish=()=>{clearTimeout(timer);worker.terminate();};
  worker.onmessage=event=>{finish();if(event.data.error)reject(Error(event.data.error));else if(/^[0-9a-f]{64}$/.test(event.data.sha256))resolve(event.data.sha256);else reject(Error('Local preparation returned an invalid file digest.'));};
  worker.onerror=()=>{finish();reject(Error('Local preparation could not run. Use a current version of Chrome, Firefox, Edge, or Safari.'));};
  worker.postMessage({file});
 });
 const duration=await new Promise<number|null>(resolve=>{
  const media=document.createElement(medium),url=URL.createObjectURL(file);
  let done=false;
  const finish=(value:number|null)=>{if(done)return;done=true;clearTimeout(timer);media.removeAttribute('src');media.load();URL.revokeObjectURL(url);resolve(value);};
  const timer=setTimeout(()=>finish(null),10000);
  media.preload='metadata';
  media.onloadedmetadata=()=>finish(Number.isFinite(media.duration)?media.duration:null);
  media.onerror=()=>finish(null);
  media.src=url;
 });
 return {sha256:digest,durationSeconds:duration};
}
