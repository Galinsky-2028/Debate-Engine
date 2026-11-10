// Local preparation keeps hashing and container inspection off the UI thread.
// This advisory result NEVER replaces independent publication safety checks.
function mp4Duration(buffer){
 const view=new DataView(buffer);
 const tag=offset=>String.fromCharCode(...new Uint8Array(buffer,offset,4));
 function boxes(start,end,inMovie=false){
  for(let offset=start;offset+8<=end;){
   let size=view.getUint32(offset),header=8;
   const type=tag(offset+4);
   if(size===1){if(offset+16>end)return null;const extended=view.getBigUint64(offset+8);if(extended>BigInt(Number.MAX_SAFE_INTEGER))return null;size=Number(extended);header=16;}
   if(size===0)size=end-offset;
   if(size<header||offset+size>end)return null;
   const payload=offset+header;
   if(type==='moov'&&!inMovie){const result=boxes(payload,offset+size,true);if(result!==null)return result;}
   if(type==='mvhd'&&inMovie&&payload+4<=offset+size){
    const version=view.getUint8(payload);
    const scaleOffset=payload+(version===0?12:20),durationOffset=scaleOffset+4;
    if((version!==0&&version!==1)||durationOffset+(version===0?4:8)>offset+size)return null;
    const scale=view.getUint32(scaleOffset);
    const duration=version===0?view.getUint32(durationOffset):Number(view.getBigUint64(durationOffset));
    return scale>0&&Number.isSafeInteger(duration)&&duration>0?duration/scale:null;
   }
   offset+=size;
  }
  return null;
 }
 try{return buffer.byteLength>=12&&tag(4)==='ftyp'?boxes(0,buffer.byteLength):null;}catch{return null;}
}
self.onmessage=async event=>{
 // Dedicated Worker messages normally have an empty origin. Any explicit
 // origin must match this site's origin; cross-origin messages are ignored.
 if(event.origin!==''&&event.origin!==self.location.origin)return;
 try {
  const file=event.data.file;
  if(!(file instanceof Blob)||file.size<64||file.size>60*1024*1024)throw Error('Choose an original between 64 bytes and 60 MiB.');
  const bytes=await file.arrayBuffer();
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const sha256=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
  self.postMessage({sha256,sizeBytes:file.size,durationSeconds:mp4Duration(bytes)});
 }catch(e){self.postMessage({error:e instanceof Error?e.message:'Local preparation failed.'});}
};
