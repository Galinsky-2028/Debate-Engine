import test from "node:test";
import assert from "node:assert/strict";
import {branchSequence} from "../packages/domain/sequence.ts";
const submissions=[
 {id:"A0",branch_id:null,parent_submission_id:null,candidacy_id:"A",kind:"opening",published_at:"2026-10-10"},
 {id:"B1",branch_id:"branch",parent_submission_id:"A0",candidacy_id:"B",kind:"response",published_at:"2026-10-11"},
 {id:"A2",branch_id:"branch",parent_submission_id:"B1",candidacy_id:"A",kind:"reply",published_at:"2026-10-12"},
];
const questions=[
 {id:"Q1",submission_id:"A0",asked_by_candidacy_id:"A",question_text:"How?"},
 {id:"Q2",submission_id:"B1",asked_by_candidacy_id:"B",question_text:"Why?"},
];
const answers=[
 {question_id:"Q1",submission_id:"B1",video_timestamp_seconds:12},
 {question_id:"Q2",submission_id:"A2",video_timestamp_seconds:15},
];
const reviews=[
 {id:"r1",question_id:"Q1",answer_submission_id:"B1",reviewer_candidacy_id:"A",decision:"answered",reasoning:"Answered",created_at:"2026-10-13T10:00:00Z"},
 {id:"r2",question_id:"Q2",answer_submission_id:"A2",reviewer_candidacy_id:"B",decision:"answered",reasoning:"Answered",created_at:"2026-10-13T11:00:00Z"},
];
test("complete reciprocal exchange joins official sequence",()=>{
 const x=branchSequence("A","branch","B",submissions,questions,answers,reviews);
 assert.deepEqual(x.qualifyingSubmissionIds,["A0","B1","A2"]);
 assert.equal(x.exchanges[0].state,"qualified");
});
test("originator missing an answer cannot include challenger even if it is published",()=>{
 const x=branchSequence("A","branch","B",submissions,questions,answers.filter(a=>a.submission_id!=="A2"),reviews);
 assert.deepEqual(x.qualifyingSubmissionIds,["A0"]);
 assert.equal(x.exchanges[0].state,"awaiting_originator_answer");
});
test("questioner's later correction supersedes old assessment",()=>{
 const x=branchSequence("A","branch","B",submissions,questions,answers,[...reviews,{
  id:"r3",question_id:"Q1",answer_submission_id:"B1",reviewer_candidacy_id:"A",decision:"not_answered",reasoning:"Still not an answer",created_at:"2026-10-14T10:00:00Z"}]);
 assert.deepEqual(x.qualifyingSubmissionIds,["A0"]);
 assert.equal(x.exchanges[0].state,"footnoted");
});
test("challenge remains in public record when originator never replies",()=>{
 const x=branchSequence("A","branch","B",submissions.slice(0,2),questions,answers,reviews);
 assert.deepEqual(x.qualifyingSubmissionIds,["A0"]);
 assert.equal(x.exchanges[0].state,"awaiting_originator_answer");
});
test("same-timestamp decisions follow recorded event order, including PostgreSQL Date values",()=>{
 const latest={...reviews[0],id:"a",decision:"not_answered",event_order:"9007199254740994"};
 const earlier={...reviews[0],id:"z",event_order:"9007199254740993"};
 assert.equal(branchSequence("A","branch","B",submissions,questions,answers,[earlier,latest,reviews[1]]).exchanges[0].state,"footnoted");
 const dated=[{...earlier,created_at:new Date(earlier.created_at) as unknown as string},{...latest,created_at:new Date(latest.created_at) as unknown as string},reviews[1]];
 assert.equal(branchSequence("A","branch","B",submissions,questions,answers,dated).exchanges[0].state,"footnoted");
});
test("a published prefix survives a later reversal and permits new reciprocal exchanges",()=>{
 const later=[...submissions,
  {id:"B3",branch_id:"branch",parent_submission_id:"A2",candidacy_id:"B",kind:"reply",published_at:"2026-10-14"},
  {id:"A4",branch_id:"branch",parent_submission_id:"B3",candidacy_id:"A",kind:"reply",published_at:"2026-10-15"}];
 const nextQuestions=[...questions,{id:"Q3",submission_id:"A2",asked_by_candidacy_id:"A",question_text:"Next?"},{id:"Q4",submission_id:"B3",asked_by_candidacy_id:"B",question_text:"And then?"}];
 const nextAnswers=[...answers,{question_id:"Q3",submission_id:"B3",video_timestamp_seconds:2},{question_id:"Q4",submission_id:"A4",video_timestamp_seconds:2}];
 const nextReviews=[...reviews,{...reviews[0],id:"r3",decision:"not_answered",created_at:"2026-10-16"},
  {...reviews[0],id:"r4",question_id:"Q3",answer_submission_id:"B3"},
  {...reviews[1],id:"r5",question_id:"Q4",answer_submission_id:"A4"}];
 assert.deepEqual(branchSequence("A","branch","B",later,nextQuestions,nextAnswers,nextReviews).qualifyingSubmissionIds,["A0"]);
 assert.deepEqual(branchSequence("A","branch","B",later,nextQuestions,nextAnswers,nextReviews,["A0","B1","A2"]).qualifyingSubmissionIds,["A0","B1","A2","B3","A4"]);
});
test('new ordered decisions supersede legacy reviews even when their transaction timestamp is earlier',()=>{
 const legacy={...reviews[0],event_order:null,created_at:'2026-11-09T14:00:00Z'};
 const corrected={...reviews[0],id:'new',decision:'not_answered',event_order:'1',created_at:'2026-11-09T13:59:59Z'};
 assert.equal(branchSequence('A','branch','B',submissions,questions,answers,[legacy,corrected,reviews[1]]).exchanges[0].state,'footnoted');
});
