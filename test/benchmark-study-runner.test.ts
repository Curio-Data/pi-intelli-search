// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStudySpendLedger } from "../scripts/benchmarks/study-budget.js";
import { createMainFixture, createRecording, importHost, isolateProcess, selectHost, startStageFixture, syntheticPage, MAIN_PROVIDER, type MainTurn } from "./helpers/native-replay.js";
import { runStudyTask } from "../scripts/benchmarks/study-runner.js";
import { analyseStudySeries, assertSeriesInventoryComplete } from "../scripts/benchmarks/study-series.js";
import { createStudyPlan, studyPipelineSettings, type StudyTask } from "../scripts/benchmarks/study-design.js";
import type { StudyHostModule, StudyExtensionFactory } from "../scripts/benchmarks/study-host.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const isolation=await isolateProcess("study-driver");
const selected=await selectHost();
const host=await importHost(selected);
const main=await createMainFixture(selected.root);
const stage=await startStageFixture();
const workspace=join(isolation.root,"workspace");
const seriesRoot=join(isolation.root,"evidence");
const url="https://docs.example.test/runner";
const pages=new Map([[url,syntheticPage("Runner","The documented limit is seven.")]]);
const rawPages=createRecording("driver-pages",pages);
const task:StudyTask={id:"DRIVER-01",partition:"development",workflow:"single",query:"What is the documented limit?",focusPrompt:"Preserve the documented limit.",domains:["docs.example.test"],workflowQueries:["What is the documented limit?"]};
const usage={prompt_tokens:2000,completion_tokens:20,total_tokens:2020,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0},completion_tokens_details:{reasoning_tokens:0},cost:0.001};
const plan=createStudyPlan(task);
const hash="a".repeat(64);

before(async()=>{
  await mkdir(workspace,{recursive:true});
  const model=(id:string)=>({id,name:id,api:"openai-completions",reasoning:false,input:["text"],contextWindow:200_000,maxTokens:4096,cost:{input:1,output:1,cacheRead:0,cacheWrite:0}});
  await writeFile(join(isolation.agentDir,"models.json"),JSON.stringify({providers:{openrouter:{baseUrl:stage.baseUrl,api:"openai-completions",apiKey:"fixture",models:[model("perplexity/sonar"),model("minimax/minimax-m3")]}}}));
  stage.setScript(({role})=>({text:role==="search"?`See [Runner](${url})`:role==="suggest"?"[]":"The documented limit is seven.",usage}));
});
after(async()=>{await stage.close();await rm(isolation.root,{recursive:true,force:true});});
const base=()=>({host:host as unknown as StudyHostModule,hostSelection:{root:selected.root,version:selected.version,source:"explicit-root" as const,launcher:null},workspace,seriesRoot,task,repeat:1,order:1,seed:42,methodSha256:hash,corpusSha256:hash,candidateCommit:"synthetic",lockfileSha256:hash,remainingPlannedUsd:0,testing:{main:{provider:MAIN_PROVIDER,id:"main"},factories:[main.factory],pipeline:{livePageTransport:rawPages.pageTransport},settings:studyPipelineSettings(),timeoutMs:20000}});
const turns=(calls:NonNullable<MainTurn["toolCalls"]>):MainTurn[]=>[{toolCalls:calls,usage},{text:"The limit is seven, according to the captured source.",usage}];
const reset=async()=>{await rm(workspace,{recursive:true,force:true});await mkdir(workspace);};

test(`actual study driver capture and off/on replay on Pi ${selected.version}`,async()=>{
  main.setScript(turns([{name:"codemode",args:{code:plan.script}}]));
  const captured=await runStudyTask({...base(),runId:"capture",mode:"capture",arm:"on"});
  const outcome=JSON.parse(await readFile(join(captured.runDir,"outcome.json"),"utf8"));
  assert.equal(captured.observation.status,"completed",JSON.stringify(outcome.errors));
  assert(captured.captureBundle);
  assert.equal(captured.observation.mainInputTotalComplete,true);
  assert.equal(captured.observation.mainUsageComplete,true);
  assert.equal(captured.observation.mainUsage?.inputTotal,4000);
  const pipelineCalls=stage.requests.length;
  assert(pipelineCalls>0);
  for(const arm of ["off","on"] as const){
    await reset();
    main.setScript(turns(arm==="on"?[{name:"codemode",args:{code:plan.script}}]:[{name:"intelli_research",args:{query:task.query,focusPrompt:task.focusPrompt,domains:task.domains,maxUrls:4}}]));
    const result=await runStudyTask({...base(),runId:`replay-${arm}`,mode:"replay",arm,bundle:captured.captureBundle});
    const end=JSON.parse(await readFile(join(result.runDir,"outcome.json"),"utf8"));
    assert.equal(result.observation.status,"completed",JSON.stringify(end.errors));
    assert.equal(result.observation.replayValidity,"valid");
    assert.equal(result.observation.reportedPipelineUsd,0);
    assert.equal(stage.requests.length,pipelineCalls,"replay makes no pipeline dispatch");
    const requests=(await readFile(join(result.runDir,"actual-requests.ndjson"),"utf8")).trim().split("\n").map((line)=>JSON.parse(line));
    const declarations=requests[0].payload.tools.map((t:{function:{name:string}})=>t.function.name);
    assert.equal(declarations.includes("intelli_fetch"),arm==="off");
    assert(declarations.includes("read"));
    assert.equal(declarations.includes("codemode"),arm==="on");
    if(arm==="on") assert(!requests[0].payload.tools.find((t:{function:{name:string}})=>t.function.name==="codemode").function.description.includes("models.classify"),"other model APIs are disabled in the fixed study catalogue");
    const manifest=JSON.parse(await readFile(join(result.runDir,"manifest.json"),"utf8"));
    assert(manifest.files.some((f:{name:string})=>f.name==="replay.json"));
  }
  const observations=(await readFile(join(seriesRoot,"observations.ndjson"),"utf8")).trim().split("\n");
  assert.equal(observations.length,3);
});

test("driver retains a replay miss and refuses absent recordings before dispatch",async()=>{
  await reset();
  await assert.rejects(runStudyTask({...base(),runId:"no-recording",mode:"replay",arm:"off"}),/Replay requires/);
  const bundle=JSON.parse(await readFile(join(seriesRoot,"capture/capture/bundle.json"),"utf8"));
  main.setScript(turns([{name:"intelli_research",args:{query:"a different query",maxUrls:4,focusPrompt:task.focusPrompt}}]));
  const count=stage.requests.length;
  const failed=await runStudyTask({...base(),runId:"missing-fixture",mode:"replay",arm:"off",bundle});
  assert.notEqual(failed.observation.status,"completed");
  assert.equal(failed.observation.replayValidity,"miss");
  assert.equal(stage.requests.length,count);
  const observations=await readFile(join(seriesRoot,"observations.ndjson"),"utf8");
  assert(observations.includes('"runId":"missing-fixture"'));
});

test("driver captures and replays manual and parallel breadth workflows through both catalogues",async()=>{
  for(const workflow of ["manual","breadth"] as const){
    const t:StudyTask={...task,id:`DRIVER-${workflow}`,workflow,
      ...(workflow==="manual"?{manualPlan:{searchQueries:["Documented limit source one","Documented limit source two"]}}:{workflowQueries:["Documented limit first angle","Documented limit second angle","Documented limit third angle"]}),
    };
    const p=createStudyPlan(t);
    await reset();
    main.setScript(turns([{name:"codemode",args:{code:p.script}}]));
    const c=await runStudyTask({...base(),task:t,runId:`capture-${workflow}`,mode:"capture",arm:"on"});
    assert.equal(c.observation.status,"completed",await readFile(join(c.runDir,"outcome.json"),"utf8"));
    assert(c.captureBundle);
    const eventRows=JSON.parse(await readFile(join(c.runDir,"tool-events.json"),"utf8")) as Array<{type:string;toolName:string;args:Record<string,unknown>}>;
    const direct=eventRows.filter((e)=>e.type==="tool_execution_start"&&e.toolName.startsWith("intelli_")).map((e)=>({name:e.toolName,args:e.args}));
    const count=stage.requests.length;
    for(const arm of ["off","on"] as const){
      await reset();
      main.setScript(arm==="on"?turns([{name:"codemode",args:{code:p.script}}]):workflow==="breadth"?turns(direct):[...direct.map((call)=>({toolCalls:[call],usage})),{text:"Done with the manual evidence.",usage}]);
      const result=await runStudyTask({...base(),task:t,runId:`replay-${workflow}-${arm}`,mode:"replay",arm,bundle:c.captureBundle});
      assert.equal(result.observation.status,"completed",await readFile(join(result.runDir,"outcome.json"),"utf8"));
      assert.equal(stage.requests.length,count);
    }
  }
});

test("driver keeps the two-turn cache follow-up and its saved-report read in both arms",async()=>{
  const t:StudyTask={...task,id:"DRIVER-followup",workflow:"followup",followupPlan:{base:task.query,followup:"Does the saved evidence establish a different limit for version two?"}};
  const p=createStudyPlan(t);
  let bundle;
  for(const mode of ["capture","replay","replay"] as const){
    const arm=mode==="capture"||!bundle?.offDone?"on":"off";
    await reset();
    const readArgs={path:""};
    const followup:StudyExtensionFactory=((pi:ExtensionAPI)=>{
      pi.on("tool_execution_end",(event)=>{
        if(event.toolName==="intelli_research") readArgs.path=(event.result as {details:{intelli:{cache:{reportPath:string}}}}).details.intelli.cache.reportPath;
      });
    }) as unknown as StudyExtensionFactory;
    main.setScript([
      ...turns(arm==="on"?[{name:"codemode",args:{code:p.script}}]:[{name:"intelli_research",args:{query:t.followupPlan!.base,focusPrompt:t.focusPrompt,domains:t.domains,maxUrls:4}}]),
      ...turns(arm==="on"?[{name:"codemode",args:{code:p.followupScript}}]:[{name:"read",args:readArgs}]),
    ]);
    const count=stage.requests.length;
    const result=await runStudyTask({...base(),task:t,runId:`${mode}-followup-${arm}`,mode,arm,bundle:bundle?.data,testing:{...base().testing,factories:[main.factory,followup]}});
    assert.equal(result.observation.status,"completed",await readFile(join(result.runDir,"outcome.json"),"utf8"));
    const events=JSON.parse(await readFile(join(result.runDir,"tool-events.json"),"utf8")) as Array<{type:string;toolName:string}>;
    assert.equal(events.filter((e)=>e.type==="tool_execution_end"&&e.toolName==="read").length,1);
    if(mode==="capture") bundle={data:result.captureBundle,offDone:false};
    else {assert.equal(stage.requests.length,count);bundle!.offDone=true;}
  }
});

test("explicit settings are captured and default global settings do not select pipeline models",async()=>{
  await reset();
  await writeFile(join(isolation.agentDir,"settings.json"),JSON.stringify({"pi-intelli-search":{searchModel:{provider:"invalid",model:"unrelated"}}}));
  main.setScript(turns([{name:"intelli_research",args:{query:task.query,focusPrompt:task.focusPrompt,maxUrls:4,domains:task.domains}}]));
  const result=await runStudyTask({...base(),runId:"explicit-settings",mode:"live",arm:"off"});
  assert.equal(result.observation.status,"completed",JSON.stringify(await readFile(join(result.runDir,"outcome.json"),"utf8")));
  assert(result.observation.pipelineUsage!.attempts>0);
});

test("a settlement error preserves the reservation and still writes the failed run into the inventory",async()=>{
  await reset();
  const ledger=await openStudySpendLedger(join(isolation.root,"spend"),fileURLToPath(new URL("../docs/benchmarks/codemode-study-v1/SPEND-BASELINE.json",import.meta.url)));
  main.setScript(turns([{name:"intelli_research",args:{query:task.query,focusPrompt:task.focusPrompt,maxUrls:4,domains:task.domains}}]));
  const result=await runStudyTask({...base(),runId:"settlement-failure",mode:"live",arm:"off",spend:{...ledger,settle:async()=>{throw new Error("synthetic ledger failure");}}});
  assert.equal(result.observation.status,"failed");
  assert.match(result.observation.error??"",/Spend settlement failed/);
  assert.deepEqual((await ledger.snapshot()).activeRuns,["settlement-failure"]);
  assert.equal(JSON.parse(await readFile(join(result.runDir,"identity.json"),"utf8")).reservationUsd,5);
  assert((await readFile(join(seriesRoot,"observations.ndjson"),"utf8")).includes('"runId":"settlement-failure"'));
  const journal=(await readFile(join(result.runDir,"model-dispatch.ndjson"),"utf8")).trim().split("\n").map((line)=>JSON.parse(line));
  assert(journal.some((entry)=>entry.kind==="admitted-before-dispatch"));
  assert.equal(journal.filter((entry)=>entry.kind==="admitted-before-dispatch").length,journal.filter((entry)=>entry.kind==="settled").length);
});

test("failed collation after allocation is witnessed as settled, not falsely before allocation",async()=>{
  await reset();
  stage.setScript(({role})=>({text:role==="search"?`See [Runner](${url})`:role==="collate"?"":role==="suggest"?"[]":"The documented limit is seven.",usage}));
  try{
    main.setScript(turns([{name:"codemode",args:{code:createStudyPlan(task).script}}]));
    const result=await runStudyTask({...base(),runId:"empty-collation",mode:"capture",arm:"on"});
    assert.equal(result.observation.status,"failed",await readFile(join(result.runDir,"outcome.json"),"utf8"));
    assert(!result.observation.error?.includes("failed-before-allocation witness"));
    const capture=JSON.parse(await readFile(join(result.runDir,"capture/attempts.json"),"utf8"));
    assert(capture.suggestionObservations.some((event:{kind:string})=>event.kind==="allocated"));
    assert.equal(capture.hostWitnesses[0].outcome,"settled");
    assert(capture.faults.every((fault:string)=>!fault.includes("failed-before-allocation witness")));
    const manifest=JSON.parse(await readFile(join(result.runDir,"capture/manifest.json"),"utf8"));
    assert.equal(manifest.complete,false);
    assert.match(manifest.incompleteReason,/without its frozen candidate read/,"the failed workflow still cannot masquerade as a complete replay bundle");
  }finally{stage.setScript(({role})=>({text:role==="search"?`See [Runner](${url})`:role==="suggest"?"[]":"The documented limit is seven.",usage}));}
});

test("the matched fetch character cap applies when the model omits maxChars",async()=>{
  await reset();
  const largeUrl="https://docs.example.test/large";
  pages.set(largeUrl,syntheticPage("Large","Documented detail. ".repeat(5000)));
  main.setScript(turns([{name:"intelli_fetch",args:{url:largeUrl}}]));
  const result=await runStudyTask({...base(),runId:"default-fetch-cap",mode:"live",arm:"off"});
  assert.equal(result.observation.status,"completed",await readFile(join(result.runDir,"outcome.json"),"utf8"));
  const pipeline=JSON.parse(await readFile(join(result.runDir,"pipeline.json"),"utf8"));
  assert(pipeline.operations[0].sources[0].content.length<=16000);
  assert.equal(pipeline.operations[0].sources[0].truncated,true);
});

test("offline export checks retained artifacts and refuses orphaned runs without new model calls",async()=>{
  const count=stage.requests.length;
  await writeFile(join(seriesRoot,"series.json"),JSON.stringify({candidateCommit:"synthetic",design:{methodSha256:hash,corpusSha256:hash,tasks:[task]}}));
  const exported=await analyseStudySeries(seriesRoot,"development");
  const analysis=JSON.parse(await readFile(join(exported.output,"analysis.json"),"utf8"));
  assert.match(analysis.analysisClass,/development: diagnostic/);
  assert.equal(stage.requests.length,count);
  assert.equal(analysis.populations.replay.metrics.mainInputUncached.primaryAvailable,false);
  const orphan=join(seriesRoot,"orphan");await mkdir(orphan);await writeFile(join(orphan,"identity.json"),JSON.stringify({runId:"unfinished"}));
  const observed=(await readFile(join(seriesRoot,"observations.ndjson"),"utf8")).trim().split("\n").map((line)=>JSON.parse(line).runId as string);
  await assert.rejects(assertSeriesInventoryComplete(seriesRoot,observed),/Unfinished run unfinished/);
  await rm(orphan,{recursive:true});
  await writeFile(join(seriesRoot,"capture-workspace","unexpected.txt"),"a changed snapshot");
  await assert.rejects(analyseStudySeries(seriesRoot,"development"),/Changed workspace snapshot/);
  assert.equal(stage.requests.length,count);
});
