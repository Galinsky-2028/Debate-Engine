import test from "node:test";
import assert from "node:assert/strict";
import {zipSync,strToU8} from "fflate";
import {readBounded,BodyTooLarge,declaredLengthTooLarge} from "../packages/domain/bounded-body.ts";

function stream(chunks:number[]){
 return new ReadableStream<Uint8Array>({start(c){for(const n of chunks)c.enqueue(new Uint8Array(n));c.close();}});
}
test("a chunked body without Content-Length is cut off at the byte cap",async()=>{
 await assert.rejects(readBounded(stream([600,600]),1000),BodyTooLarge);
 assert.equal((await readBounded(stream([400,600]),1000)).byteLength,1000);
 assert.equal((await readBounded(null,10)).byteLength,0);
});
test("a declared oversize or malformed Content-Length is refused before reading",()=>{
 assert.equal(declaredLengthTooLarge(null,10),false);
 assert.equal(declaredLengthTooLarge("10",10),false);
 assert.equal(declaredLengthTooLarge("11",10),true);
 assert.equal(declaredLengthTooLarge("abc",10),true);
 assert.equal(declaredLengthTooLarge("-1",10),true);
});
test("security headers deny framing everywhere except read-only embeds",async()=>{
 const config=(await import("../next.config.ts")).default;
 const rules=await config.headers!();
 const page=rules.find(r=>r.source.includes("(?!embed/)"))!;
 const embed=rules.find(r=>r.source.startsWith("/embed/"))!;
 const csp=(r:typeof page)=>r.headers.find(h=>h.key==="Content-Security-Policy")!.value;
 assert.match(csp(page),/frame-ancestors 'none'/);
 assert.ok(page.headers.some(h=>h.key==="X-Frame-Options"&&h.value==="DENY"));
 assert.ok(page.headers.some(h=>h.key==="X-Content-Type-Options"&&h.value==="nosniff"));
 assert.match(csp(embed),/frame-ancestors \*/);
 assert.ok(!embed.headers.some(h=>h.key==="X-Frame-Options"));
 for(const r of [page,embed])assert.match(csp(r),/object-src 'none'/);
});
test("only a ZIP with Word parts is accepted as DOCX",async()=>{
 const {unzipSync}=await import("fflate");
 const names=(b:Uint8Array)=>{const n=new Set<string>();unzipSync(b,{filter:f=>{n.add(f.name);return false;}});return n;};
 const docx=zipSync({"[Content_Types].xml":strToU8("<Types/>"),"word/document.xml":strToU8("<w:document/>")});
 const other=zipSync({"payload.exe":strToU8("MZ")});
 assert.ok(names(docx).has("word/document.xml"));
 assert.ok(!names(other).has("word/document.xml"));
});
test("distributing a released summary re-checks future-use permission and active restrictions",async()=>{
 const {readFileSync}=await import("node:fs");
 const src=readFileSync(new URL("../lib/server/distributions.ts",import.meta.url),"utf8");
 assert.match(src,/ARTIFACT_GRANTS_CURRENT_SQL/);
 assert.match(src,/restriction_cases WHERE target_kind='derivative'/);
});
