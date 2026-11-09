#!/usr/bin/env node
/**
 * CI-only real HTTP/Next.js + PostgreSQL browser pilot, with TWO separate
 * cryptographically signed fixture sessions. Managed Neon Auth itself is NOT
 * mocked into a production environment and is NOT accepted by this test.
 * Everything runs on a disposable localhost GitHub runner and fictional data.
 */
import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import {chromium} from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {isPilotRunner} from "./pilot-scope.mjs";
const origin=process.env.PDE_BROWSER_URL;
if(!isPilotRunner()||
   origin!=="https://127.0.0.1:3443"||
   process.env.DATABASE_URL!=="postgresql://debate_ci:test_only_password@localhost:5432/debate_ci"||
   !/^[0-9a-f]{64}$/.test(process.env.PDE_CI_AUTH_KEY||""))
 throw Error("The candidate pilot may run only on its disposable localhost CI database.");
const key=process.env.PDE_CI_AUTH_KEY;
const browser=await chromium.launch({headless:true,...(process.env.PDE_CHROMIUM_EXECUTABLE?{executablePath:process.env.PDE_CHROMIUM_EXECUTABLE}:{})});
const contexts=[];
const random="ci-"+randomUUID().slice(0,8);
const candidateNameA="Fictional Policy Candidate A "+random;
const candidateNameB="Fictional Policy Candidate B "+random;
const policyTitle="Synthetic source accountability policy "+random;
const questionA="How would you independently verify the evidence for each budget change?";
const questionB="How would you preserve those public audit records?";
const questionB2="How would you identify corrections without changing original statements?";
const openingText="This is an entirely fictional policy debate. The proposal is to publish documented fiscal assumptions and clearly state which spending estimates are subject to independent verification. The record must preserve original source material so that participants can check each claim against the published budget calculations and explain any disputes.";
const responseText="I would use an open and independently inspectable audit ledger to evaluate each published budget change. The responsible office should identify its evidence, sources and approval date without altering the preceding original statement. I also want the proposer to explain how the audit records would be kept accessible without changing prior versions.";
const replyText="I would publish a permanently attributed append-only audit ledger with dated records, immutable original sources and independent restoration checks. No candidate or reviewer should silently remove another candidate's published contribution or invent a determination of who won the exchange.";
const actorId={reviewer:"00000000-0000-4000-8000-000000000001",a:"00000000-0000-4000-8000-000000000002",b:"00000000-0000-4000-8000-000000000003"};
function signedCookie(actor){
 return actor+"."+createHmac("sha256",key).update("ci-session:"+actor).digest("hex");
}
async function contextFor(actor){
 const context=await browser.newContext({viewport:{width:1250,height:900},locale:"en-US",ignoreHTTPSErrors:true});
 contexts.push(context);
 if(actor){
  await context.addCookies([{name:"pde_ci_session",value:signedCookie(actor),
   url:origin,httpOnly:true,sameSite:"Lax",secure:true}]);
 }
 return context;
}
async function request(context,verb,path,data,expected=200){
 const response=await context.request.fetch(new URL(path,origin).href,{
  method:verb,headers:{"origin":origin,...(data===undefined?{}:{"content-type":"application/json"})},
  ...(data===undefined?{}:{data:JSON.stringify(data)})
 });
 const raw=await response.text();
 let result;
 try{result=JSON.parse(raw)}catch{result={raw:raw.slice(0,1200)}}
 assert.equal(response.status(),expected,verb+" "+path+": "+JSON.stringify(result));
 return result;
}
async function pageAt(context,path){
 const page=await context.newPage();
 const response=await page.goto(origin+path,{waitUntil:"domcontentloaded",timeout:30000});
 assert.equal(response?.status(),200,path+" must load in the real browser");
 return page;
}
async function publishFromComposer(page,label){
 await page.getByRole("button",{name:/Prepare private assessment/}).click();
 try{
  await page.getByRole("heading",{name:/Review your speech before publishing/}).waitFor({timeout:25000});
 }catch(e){throw Error(label+" preparation failed: "+JSON.stringify(await page.locator('[role="alert"]').allTextContents()))}
 await page.getByRole("button",{name:/Skip optional assessment/}).click();
 await page.getByText(/Optional analysis skipped/).waitFor({timeout:25000});
 await page.getByRole("button",{name:/Approve my final original and publish/}).click();
 try{
  await page.waitForURL(/\/workspace\/drafts\/[0-9a-f-]+$/, {timeout:35000});
 }catch(e){throw Error(label+" confirmation failed: "+JSON.stringify(await page.locator('[role="alert"],[role="status"]').allTextContents()))}
 const id=page.url().match(/\/workspace\/drafts\/([0-9a-f-]+)$/)?.[1];
 assert.ok(id,label+" must resolve to a private draft receipt");
 return id;
}
async function consent(page){
 // React updates each independently controlled checkbox; real users do not
 // click both simultaneously. Concurrent automation can race component rerenders.
 await page.getByRole("checkbox",{name:/I authorize permanent public archiving/}).check();
 await page.getByRole("checkbox",{name:/I authorize unedited inclusion/}).check();
}
async function waitVerified(page,id){
 await page.goto(origin+"/workspace",{waitUntil:"domcontentloaded"});
 await page.getByRole("link",{name:/Prepare a debate/}).first().waitFor({timeout:25000});
 const options=await page.locator("select").count();
 assert.ok(options>=1);
}
async function prepareWriting(page,candidateId,content){
 await page.getByLabel("Verified candidate").selectOption(candidateId);
 await page.getByRole("checkbox",{name:"Writing"}).check().catch(async()=>{
  // Replies have inherited allowed modalities rather than editable checkboxes.
  assert.ok((await page.getByLabel("Your submission medium").locator('option[value="writing"]').count())===1);
 });
 await page.getByLabel("Your submission medium").selectOption("writing");
 await page.getByLabel("Complete written speech").fill(content);
}
try{
 const anonymous=await contextFor(null),admin=await contextFor("reviewer"),
  a=await contextFor("a"),b=await contextFor("b");
 await request(anonymous,"GET","/api/account/me",undefined,401);
 await request(anonymous,"GET","/api/private/drafts",undefined,401);
 const tampered=await contextFor(null);
 await tampered.addCookies([{name:"pde_ci_session",value:"a."+"0".repeat(64),url:origin,httpOnly:true,sameSite:"Lax"}]);
 await request(tampered,"GET","/api/account/me",undefined,401);
 const publicAnonymous=await pageAt(anonymous,"/debates");
 assert.ok(await publicAnonymous.getByRole("heading",{name:/Debates in/}).count());
 const uniqueSlug="pde-fixture-"+randomUUID().slice(0,12);
 const election=await request(admin,"POST","/api/admin/elections",{
  title:"FICTIONAL Pilot Legislature",slug:uniqueSlug,jurisdiction:"CI synthetic jurisdiction",
  label:"Fictional pilot 2032",date:"2032-11-02"
 },201);
 const electionId=election.id;
 assert.equal((await request(a,"GET","/api/account/me")).user.id,actorId.a);
 assert.equal((await request(b,"GET","/api/account/me")).user.id,actorId.b);
 const pageA=await pageAt(a,"/workspace"),pageB=await pageAt(b,"/workspace");
 for(const [page,name] of [[pageA,candidateNameA],[pageB,candidateNameB]]){
  // The native HTML label wraps the select and its option text. Exact label
  // matching can include option content; target the actual election form.
  const form=page.locator(".workspace-panel").filter({hasText:"REGISTER FOR AN ELECTION"}).locator("form");
  try{await form.locator("select").selectOption(electionId,{timeout:15000});}
  catch{throw Error("Workspace election picker unavailable: "+(await page.locator("main").innerText()).slice(0,1200));}
  await form.getByLabel("Public candidate name").fill(name);
  await form.getByRole("button",{name:/Request verification/}).click();
  await page.getByText(/Candidate registration submitted/).waitFor({timeout:20000});
 }
 const mineA=(await request(a,"GET","/api/account/me")).candidacies;
 const mineB=(await request(b,"GET","/api/account/me")).candidacies;
 const candidateA=mineA.find(c=>c.public_name===candidateNameA)?.id;
 const candidateB=mineB.find(c=>c.public_name===candidateNameB)?.id;
 assert.ok(candidateA&&candidateB&&candidateA!==candidateB);
 assert.equal(mineA.find(c=>c.id===candidateA)?.verification_status,"pending");
 assert.equal(mineB.find(c=>c.id===candidateB)?.verification_status,"pending");
 const pendingPayload={candidacyId:candidateA,modality:"writing",writtenContent:openingText,
  mediaAssetId:null,allowedModalities:["writing"],questions:[{text:questionA,characterOffset:0}],
  title:policyTitle,proposition:"A fictional and explicitly synthetic proposal",
  maxResponseSeconds:300,replyWindowHours:48,archiveConsent:true,sequenceConsent:true};
 await request(a,"POST","/api/private/drafts",{kind:"opening",candidacyId:candidateA,
  payload:pendingPayload,providerConsent:false,improvementConsent:false},403);
 await request(b,"POST","/api/admin/candidacies/"+candidateA+"/verify",
  {approve:true,reason:"A nonreviewer may not verify another candidate."},403);
 const reason="In this disposable test only, each fixture identity is permitted to publish synthetic speeches.";
 await request(admin,"POST","/api/admin/candidacies/"+candidateA+"/verify",{approve:true,reason});
 await request(admin,"POST","/api/admin/candidacies/"+candidateB+"/verify",{approve:true,reason});
 assert.equal((await request(a,"GET","/api/account/me")).candidacies.find(c=>c.id===candidateA).verification_status,"verified");
 assert.equal((await request(b,"GET","/api/account/me")).candidacies.find(c=>c.id===candidateB).verification_status,"verified");
 await waitVerified(pageA,candidateA);
 await waitVerified(pageB,candidateB);
 await pageA.goto(origin+"/workspace/new");
 await pageA.getByLabel("Verified candidate").selectOption(candidateA);
 await pageA.getByLabel("Policy title").fill(policyTitle);
 await pageA.getByLabel("Proposal and supporting explanation").fill("An explicitly fictional plan to make public-source budget estimates more auditable.");
 await pageA.getByRole("checkbox",{name:"Writing"}).check();
 await pageA.getByLabel("Your submission medium").selectOption("writing");
 await pageA.getByLabel("Complete written speech").fill(openingText);
 await pageA.getByLabel("Question 1").fill(questionA);
 await consent(pageA);
 // The private text remains absent from the public archive until explicit confirmation.
 await pageA.getByRole("button",{name:/Prepare private assessment/}).click();
 await pageA.getByRole("heading",{name:/Review your speech before publishing/}).waitFor();
 const prepared=(await request(a,"GET","/api/private/drafts")).drafts.find(d=>d.kind==="opening");
 assert.ok(prepared&&prepared.status==="draft");
 await request(b,"GET","/api/private/drafts/"+prepared.id,undefined,404);
 await request(anonymous,"GET","/api/private/drafts/"+prepared.id,undefined,401);
 const visibleBefore=(await request(anonymous,"GET","/api/debates?q="+encodeURIComponent(policyTitle))).debates;
 assert.equal(visibleBefore.length,0,"Private candidate drafts must not appear in public search.");
 await pageA.getByRole("button",{name:/Skip optional assessment/}).click();
 await pageA.getByText(/Optional analysis skipped/).waitFor();
 await pageA.getByRole("button",{name:/Approve my final original and publish/}).click();
 await pageA.waitForURL(/\/workspace\/drafts\/[0-9a-f-]+$/,{timeout:35000});
 const openingReceipt=await request(a,"GET","/api/private/drafts/"+prepared.id);
 const debateId=openingReceipt.draft.published_debate_id,openingId=openingReceipt.draft.published_submission_id;
 assert.ok(debateId&&openingId);
 const firstPublic=await request(anonymous,"GET","/api/debates/"+debateId);
 const qA=firstPublic.questions.find(q=>q.submission_id===openingId)?.id;
 assert.ok(qA,"Published opening must persist its attributed question");
 await request(b,"GET","/api/private/drafts/"+prepared.id,undefined,404);
 await pageB.goto(origin+"/debates/"+debateId+"/respond");
 await pageB.getByLabel("Verified candidate").selectOption(candidateB);
 await pageB.getByLabel("Opponent's contribution to answer").selectOption(openingId);
 await pageB.getByLabel("Your submission medium").selectOption("writing");
 await pageB.getByLabel("Complete written speech").fill(responseText);
 await pageB.getByLabel(questionA).fill("0");
 await pageB.getByLabel("Reciprocal question").fill(questionB);
 await pageB.getByRole("button",{name:"+ Reciprocal question",exact:true}).click();
 await pageB.getByLabel("Reciprocal question 2",{exact:true}).fill(questionB2);
 await consent(pageB);
 const responseDraftId=await publishFromComposer(pageB,"Responder");
 const responseReceipt=await request(b,"GET","/api/private/drafts/"+responseDraftId);
 const responseId=responseReceipt.draft.published_submission_id;
 assert.ok(responseId);
 await request(b,"POST","/api/assessments",{candidacyId:candidateB,questionId:qA,
  answerSubmissionId:responseId,decision:"answered",reasoning:"The responder cannot assess the originator's question."},403);
 await request(a,"POST","/api/assessments",{candidacyId:candidateA,questionId:qA,
  answerSubmissionId:responseId,decision:"answered",
  reasoning:"The responder gave a specific method for independent checks and public records."},201);
 const secondPublic=await request(anonymous,"GET","/api/debates/"+debateId);
 const responseBranchId=secondPublic.branches.find(b=>b.responder_candidacy_id===candidateB)?.id;
 assert.ok(responseBranchId,"A published contender must own a discoverable debate branch.");
 const currentPolicyList=await request(anonymous,"GET","/api/branches/"+responseBranchId+"/policies");
 assert.deepEqual(currentPolicyList.policies,[],"The policy endpoint must use real endorsement schema and return no invented agreements.");
 const qB=secondPublic.questions.find(q=>q.submission_id===responseId)?.id;
 const qB2=secondPublic.questions.find(q=>q.submission_id===responseId&&q.question_text===questionB2)?.id;
 assert.ok(qB,"Responder's reciprocal question must be attributed and public");
 assert.ok(qB2,"A second reciprocal question must survive private review and publication");
 await pageA.goto(origin+"/debates/"+debateId+"/respond");
 await pageA.getByLabel("Verified candidate").selectOption(candidateA);
 await pageA.getByLabel("Opponent's contribution to answer").selectOption(responseId);
 await pageA.getByLabel("Your submission medium").selectOption("writing");
 await pageA.getByLabel("Complete written speech").fill(replyText);
 await pageA.getByLabel(questionB).fill("0");
 await pageA.getByLabel(questionB2).fill("0");
 await consent(pageA);
 const replyDraftId=await publishFromComposer(pageA,"Originator reply");
 const replyReceipt=await request(a,"GET","/api/private/drafts/"+replyDraftId);
 const replyId=replyReceipt.draft.published_submission_id;
 assert.ok(replyId);
 await request(b,"POST","/api/assessments",{candidacyId:candidateB,questionId:qB,
  answerSubmissionId:replyId,decision:"answered",
  reasoning:"The originator explained how public source records would remain available."},201);
 const awaitingSecondAssessment=await request(anonymous,"GET","/api/debates/"+debateId+"/sequence");
 assert.equal(awaitingSecondAssessment.branches.find(x=>x.branchId===responseBranchId).publishedVersion,null);
 await request(b,"POST","/api/assessments",{candidacyId:candidateB,questionId:qB2,
  answerSubmissionId:replyId,decision:"answered",
  reasoning:"The originator committed to append-only records and unchanged original sources."},201);
 const timeline=await request(anonymous,"GET","/api/debates/"+debateId);
 assert.equal(timeline.submissions.length,3,"All three published originals must be preserved");
 const sequence=await request(anonymous,"GET","/api/debates/"+debateId+"/sequence");
 const branch=sequence.branches.find(x=>x.qualifyingSubmissionIds?.includes(responseId));
 assert.ok(branch,"The responder must have a separate branch");
 assert.deepEqual(branch.qualifyingSubmissionIds,[openingId,responseId,replyId],
  "Only reciprocal question/assessment-complete exchanges belong to the qualified sequence.");
 assert.equal(branch.publishedVersion,1,"The completed exchange must be saved in the assessment transaction.");
 assert.equal(branch.manifests.length,1);
 assert.match(branch.manifests[0].manifest_sha256,/^[a-f0-9]{64}$/);
 await request(a,"POST","/api/assessments",{candidacyId:candidateA,questionId:qA,
  answerSubmissionId:responseId,decision:"not_answered",
  reasoning:"I now disagree with this answer; the earlier published exchange must remain inspectable."},201);
 const revised=await request(anonymous,"GET","/api/debates/"+debateId+"/sequence");
 const retained=revised.branches.find(x=>x.branchId===responseBranchId);
 assert.deepEqual(retained.qualifyingSubmissionIds,[openingId,responseId,replyId]);
 assert.deepEqual(retained.currentQualifyingSubmissionIds,[openingId]);
 assert.equal(retained.manifests[0].manifest_sha256,branch.manifests[0].manifest_sha256);
 await request(b,"POST","/api/contributions/"+openingId+"/corrections",{
  candidacyId:candidateB,correctionBody:"An opponent must not be allowed to rewrite this original."},403);
 const correction=await request(a,"POST","/api/contributions/"+openingId+"/corrections",{
  candidacyId:candidateA,correctionBody:"This fictional proposal also preserves all historical source versions for public inspection."},201);
 assert.ok(correction.correctionId);
 const corrections=await request(anonymous,"GET","/api/contributions/"+openingId+"/corrections");
 assert.equal(corrections.corrections.length,1);
 const publicPage=await pageAt(anonymous,"/debates/"+debateId);
 assert.match(await publicPage.locator("main").innerText(),/fictional|Synthetic/i);
 assert.match(await publicPage.locator("main").innerText(),/preserves all historical source versions/i);
 const archive=await request(anonymous,"GET","/api/debates?q="+encodeURIComponent(policyTitle));
 assert.ok(archive.debates.some(d=>d.id===debateId));
 const rulesPath='/api/branches/'+responseBranchId+'/rules';
 const oldObligations=(await request(anonymous,'GET','/api/debates/'+debateId)).obligations;
 const pendingResponse={kind:'response',candidacyId:candidateB,debateId,parentSubmissionId:replyId,
  providerConsent:false,improvementConsent:false,payload:{candidacyId:candidateB,modality:'writing',writtenContent:responseText,
   mediaAssetId:null,questions:[{text:'How will the next review be scheduled?',characterOffset:0}],answers:[],archiveConsent:true,sequenceConsent:true,rulesVersion:1}};
 const oldDraft=await request(b,'POST','/api/private/drafts',pendingResponse,201);
 await request(b,'POST','/api/private/drafts/'+oldDraft.draftId+'/skip',{});
 const proposal=await request(a,'POST',rulesPath,{candidacyId:candidateA,baseRevision:1,maxResponseSeconds:120,replyWindowHours:24,allowedModalities:['writing']},201);
 const approvePath=rulesPath+'/'+proposal.proposalId+'/approve';
 await request(b,'POST',approvePath,{candidacyId:candidateB,sha256:'0'.repeat(64)},409);
 await request(b,'POST',approvePath,{candidacyId:candidateA,sha256:proposal.sha256},403);
 const firstApproval=await request(a,'POST',approvePath,{candidacyId:candidateA,sha256:proposal.sha256});
 assert.equal(firstApproval.activated,false);
 assert.equal((await request(anonymous,'GET',rulesPath)).current.revision,1);
 const [secondApproval]=await Promise.all([
  request(b,'POST',approvePath,{candidacyId:candidateB,sha256:proposal.sha256}),
  request(a,'POST',approvePath,{candidacyId:candidateA,sha256:proposal.sha256}),
 ]);
 assert.equal(secondApproval.activated,true);assert.equal(secondApproval.revision,2);
 const afterChange=await request(anonymous,'GET','/api/debates/'+debateId);
 assert.deepEqual(afterChange.obligations.map(o=>[o.id,o.effective_due_at]),oldObligations.map(o=>[o.id,o.effective_due_at]),'Rule changes cannot rewrite existing clocks.');
 assert.ok(afterChange.submissions.every(s=>s.rules_version===1));
 await request(b,'POST','/api/private/drafts/'+oldDraft.draftId+'/confirm',{sha256:oldDraft.sha256},409);
 await request(a,'POST',rulesPath,{candidacyId:candidateA,baseRevision:1,maxResponseSeconds:120,replyWindowHours:24,allowedModalities:['writing']},409);
 await pageB.goto(origin+'/debates/'+debateId+'/respond');
 await pageB.getByLabel('Verified candidate').selectOption(candidateB);
 await pageB.getByLabel("Opponent's contribution to answer").selectOption(replyId);
 await pageB.getByLabel('Your submission medium').selectOption('writing');
 await pageB.getByLabel('Complete written speech').fill(responseText);
 await pageB.getByLabel('Reciprocal question',{exact:true}).fill('How will the next review be scheduled?');
 await consent(pageB);
 const newDraftId=await publishFromComposer(pageB,'Response under mutually approved rules');
 const newReceipt=await request(b,'GET','/api/private/drafts/'+newDraftId);
 const finalRecord=await request(anonymous,'GET','/api/debates/'+debateId);
 const newSpeech=finalRecord.submissions.find(s=>s.id===newReceipt.draft.published_submission_id);
 assert.equal(newSpeech.rules_version,2);
 const newClock=finalRecord.obligations.find(o=>o.source_submission_id===newSpeech.id&&o.obligation_type==='reply');
 assert.equal(Date.parse(newClock.effective_due_at)-Date.parse(newClock.opened_at),24*60*60*1000);
 const rulePage=await pageAt(anonymous,'/debates/'+debateId);
 await rulePage.getByRole('region',{name:'Mutually approved branch rules'}).getByText(/Current version 2:/).waitFor();
 assert.match(await rulePage.getByRole('region',{name:'Mutually approved branch rules'}).innerText(),/Current version 2/);
 for(const width of [1250,375]){
  await rulePage.setViewportSize({width,height:900});
  const dimensions=await rulePage.evaluate(()=>({width:window.innerWidth,scroll:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)}));
  if(dimensions.scroll>dimensions.width+1){
   const overflow=await rulePage.evaluate(()=>Array.from(document.querySelectorAll('main *')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1}).map(e=>({tag:e.tagName,class:e.className})).slice(0,12));
   assert.fail('Populated debate page must fit the '+width+'px viewport: '+JSON.stringify(overflow));
  }
  const accessibility=await new AxeBuilder({page:rulePage}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  assert.deepEqual(accessibility.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],'Populated debate, sequence history and branch rules must pass automated accessibility checks.');
 }
 console.log(JSON.stringify({result:"PASS",mode:"isolated_signed_session_fixture_not_real_neon_auth",
  distinctCandidateSessions:2,independentReviewerSession:true,verifiedFixtureCandidacies:2,
  publishedSubmissions:4,assessments:4,reciprocalQuestions:2,qualifyingSubmissions:3,immutableSequenceAfterReassessment:true,
  mutuallyApprovedRuleChange:true,oldDeadlinesPreserved:true,staleRuleDraftRejected:true,newReplyWindowHours:24,
  populatedDebateMobileLayout:true,populatedDebateAutomatedAccessibility:true,
  attributedCorrections:1,privateDraftCrossAccountDenied:true,
  unauthenticatedDenied:true,reviewerOnlyVerification:true,privateBeforePublish:true,
  noRealCandidateData:true,noProductionDatabase:true}));
}finally{
 await Promise.all(contexts.map(x=>x.close().catch(()=>{})));
 await browser.close();
}
