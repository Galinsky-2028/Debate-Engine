import test from "node:test";
import assert from "node:assert/strict";
import {parseModalities,parseSourcePointer,equitableWritingWordLimit,formatProblems} from "../packages/domain/modalities.ts";
test("video is default, all nonempty combinations are supported",()=>{
 assert.deepEqual(parseModalities(undefined),["video"]);
 assert.deepEqual(parseModalities(["audio","writing"]),["audio","writing"]);
 assert.deepEqual(parseModalities(["video","audio","writing"]),["video","audio","writing"]);
 assert.throws(()=>parseModalities([]));assert.throws(()=>parseModalities(["audio","audio"]));assert.throws(()=>parseModalities(["pdf"]));
});
test("written positions and media timecodes are distinct and validated",()=>{
 assert.deepEqual(parseSourcePointer({characterOffset:25},"writing"),{characterOffset:25});
 assert.deepEqual(parseSourcePointer({timestampSeconds:2.5},"audio"),{timestampSeconds:2.5});
 assert.throws(()=>parseSourcePointer({timestampSeconds:2},"writing"));
 assert.throws(()=>parseSourcePointer({characterOffset:12},"video"));
});
test("reciprocal fair word-equivalent rule is explicit",()=>{
 assert.equal(equitableWritingWordLimit(60),150);
 const content=Array(151).fill("word").join(" ");
 assert.ok(formatProblems({modality:"writing",allowed:["writing"],durationSeconds:null,maxResponseSeconds:60,writtenContent:content,firstResponse:false,questionCount:0}).some(x=>x.includes("150 words")));
});
test("audio content cannot silently qualify in a video-only debate",()=>{
 assert.ok(formatProblems({modality:"audio",allowed:["video"],durationSeconds:20,maxResponseSeconds:60,firstResponse:false,questionCount:1}).some(x=>x.includes("not permitted")));
});
test("terminal turn: a closing reply with zero new questions is accepted without a format problem",()=>{
 for(const modality of ["writing","video"] as const)
  assert.deepEqual(formatProblems({modality,allowed:["writing","video"],durationSeconds:modality==="video"?30:null,maxResponseSeconds:60,writtenContent:"A closing statement that answers the last question.",firstResponse:false,questionCount:0}),[]);
 assert.ok(formatProblems({modality:"writing",allowed:["writing"],durationSeconds:null,maxResponseSeconds:60,writtenContent:"A first response without a question.",firstResponse:true,questionCount:0}).some(x=>x.includes("reciprocal question")));
});
