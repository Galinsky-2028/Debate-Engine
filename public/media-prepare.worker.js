// Local preparation keeps hashing and container inspection off the UI thread.
// This advisory result NEVER replaces independent publication safety checks.
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
  self.postMessage({sha256,sizeBytes:file.size});
 }catch(e){self.postMessage({error:e instanceof Error?e.message:'Local preparation failed.'});}
};
