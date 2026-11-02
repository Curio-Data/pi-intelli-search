// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, open, readFile, readdir, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { openStudySpendLedger, PROGRAMME_SPEND_ROOT } from "./study-budget.js";
import { readStudyDesign, studyPipelineSettings, STUDY_PHASE_FORECAST, STUDY_REMAINING_PLANNED_USD } from "./study-design.js";
import { loadStudyReplayBundle } from "./study-transports.js";
import { runStudyTask, importStudyNative, REPO_ROOT, type StudyRunMode } from "./study-runner.js";
import { resolveManagedHostRoot, selectStudyHost, importStudyHost, installModuleLoadRecorder, reportLoadedDependencies, readRepositoryIdentity, readCredentialFileState, scanRunForCredentials, writeNewJson, PINNED_HOST_VERSION, STUDY_MAIN_MODEL } from "./study-host.js";
import { sha256Canonical, asJson } from "./canonical.js";
import { mulberry32 } from "./statistics.js";
import { analyseStudySeries, assertSeriesInventoryComplete } from "./study-series.js";

const DESIGN_ROOT=join(REPO_ROOT,"docs/benchmarks/codemode-study-v1");
const REMAINING_PLANNED_USD=STUDY_REMAINING_PLANNED_USD;

export async function studyMain(argv=process.argv.slice(2)):Promise<void>{
  const {values}=parseArgs({args:argv,options:{
    check:{type:"boolean",default:false},"init-spend":{type:"boolean",default:false},
    analyse:{type:"string"},"rerun-of":{type:"string"},"rerun-reason":{type:"string"},
    series:{type:"string"},task:{type:"string"},mode:{type:"string",default:"replay"},
    arm:{type:"string",default:"off"},pair:{type:"boolean",default:false},bundle:{type:"string"},
    repeat:{type:"string",default:"1"},seed:{type:"string",default:"20261102"},order:{type:"string"},
  }});
  if (values.analyse) {
    if (!values.series || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.series) || !["development", "pilot"].includes(values.analyse)) throw new Error("Offline analysis requires --series and --analyse development|pilot");
    console.log(JSON.stringify(await analyseStudySeries(join(REPO_ROOT,"evidence/benchmarks",values.series),values.analyse as "development"|"pilot"),null,2));
    return;
  }
  const design=await readStudyDesign(DESIGN_ROOT);
  const baseline=join(DESIGN_ROOT,"SPEND-BASELINE.json");
  const spendRoot=join(REPO_ROOT,PROGRAMME_SPEND_ROOT);
  if(values["init-spend"]){
    await mkdir(spendRoot); // Existing programme directory refuses, even if its ledger was removed.
    const ledger=await openStudySpendLedger(spendRoot,baseline);
    console.log(JSON.stringify({action:"initialised-programme-ledger",snapshot:await ledger.snapshot(),modelRequests:0},null,2));
    return;
  }
  Object.assign(process.env,{PI_OFFLINE:"1",PI_SKIP_VERSION_CHECK:"1",PI_TELEMETRY:"0"});
  const modules=installModuleLoadRecorder();
  const agentDir=process.env.PI_CODING_AGENT_DIR??join(homedir(),".pi/agent");
  const selection=await selectStudyHost({root:await resolveManagedHostRoot(agentDir),source:"managed-install",expectedVersion:PINNED_HOST_VERSION,launcher:join(agentDir,"bin/pi")});
  const host=await importStudyHost(selection);
  await importStudyNative(selection);
  const loadedBefore=await reportLoadedDependencies({urls:modules.urls(),hostRoot:selection.root,repoRoot:REPO_ROOT});
  if(loadedBefore.outsideHostRelease.length)throw new Error("Study peer imports resolved outside the pinned host release");
  const modelRuntime=await host.ModelRuntime.create();
  const settings=studyPipelineSettings();
  const models=[STUDY_MAIN_MODEL,...[settings.searchModel,settings.extractModel,settings.collateModel].map((m)=>({provider:m.provider,id:m.model}))];
  const available=models.map((model)=>{
    const resolved=modelRuntime.getModel(model.provider,model.id) as Record<string,unknown>|undefined;
    const definition:Record<string,unknown>={};
    if(resolved)for(const key of ["provider","id","api","cost","contextWindow","maxTokens","reasoning","input"])definition[key]=resolved[key]??null;
    if(typeof resolved?.baseUrl==="string"){
      const url=new URL(resolved.baseUrl);
      definition.baseUrlDisplay=url.origin+url.pathname;
      definition.baseUrlSha256=sha256Canonical(asJson(resolved.baseUrl));
    }
    return {...model,present:resolved!==undefined,definition};
  });
  const source=await readRepositoryIdentity(REPO_ROOT,["scripts/benchmarks/study.ts","scripts/benchmarks/study-runner.ts","scripts/benchmarks/study-budget.ts","scripts/benchmarks/study-transports.ts","scripts/benchmarks/study-design.ts","scripts/benchmarks/study-host.ts","src/experimental/codemode-study.ts"]);
  if(values.check){
    console.log(JSON.stringify({host:selection,models:available,loadedDependencies:loadedBefore,source,design:{methodSha256:design.methodSha256,corpusSha256:design.corpusSha256,manifestSha256:design.manifestSha256},spendRoot,remainingPlannedUsd:REMAINING_PLANNED_USD,modelRequests:0},null,2));
    return;
  }
  if(source.dirty)throw new Error("Study execution refuses an uncommitted source tree");
  if(!source.lockfileSha256)throw new Error("Missing package lockfile identity");
  if(available.some((model)=>!model.present))throw new Error("A prescribed model is missing from the normal host registry; no fallback is allowed");
  if(!values.series||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.series))throw new Error("--series must be a plain new study series name");
  const task=design.tasks.find((t)=>t.id===values.task);
  if(!task)throw new Error("--task must identify a versioned corpus task");
  if(task.partition!=="development"&&task.partition!=="pilot")throw new Error("This driver currently admits development and pilot tasks only; freeze the independent series before enabling measured tasks");
  if(!["capture","replay","live"].includes(values.mode))throw new Error("--mode must be capture, replay or live");
  const mode=values.mode as StudyRunMode;
  if(mode==="capture"&&task.partition!=="development")throw new Error("Only development fixture captures are in the current paid schedule");
  if(mode==="live"&&task.partition==="development"&&task.id!=="CS-DEV-01")throw new Error("Development live checks are scheduled only for CS-DEV-01; broader live tasks belong to the pilot");
  if(!["off","on"].includes(values.arm))throw new Error("Only off/on are scheduled; the only arm needs a declared schedule revision");
  if(mode==="capture"&&(values.pair||values.arm!=="on"))throw new Error("Capture is one on-arm prescribed workflow, not a pair");
  const repeat=Number(values.repeat),seed=Number(values.seed);
  const previousText = await readFile(join(REPO_ROOT,"evidence/benchmarks",values.series,"observations.ndjson"),"utf8").catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return "";throw error;});
  const priorRuns=previousText.split("\n").filter(Boolean).map((line)=>JSON.parse(line) as {runId:string;queryId:string;arm:string;repeat:number;population:string;purpose?:string});
  await assertSeriesInventoryComplete(join(REPO_ROOT,"evidence/benchmarks",values.series),priorRuns.map((run)=>run.runId));
  const order=priorRuns.length+1;
  if(values.order!==undefined && Number(values.order)!==order)throw new Error("Requested order differs from the append-only run inventory");
  if(!Number.isSafeInteger(repeat)||repeat<1||!Number.isSafeInteger(order)||order<1||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error("Invalid repeat, order or seed");
  if(repeat>(task.partition==="pilot"?2:1))throw new Error("Repeat lies outside the declared development/pilot schedule");
  if(Boolean(values["rerun-of"])!==Boolean(values["rerun-reason"]?.trim()) || (values.pair&&values["rerun-of"]))throw new Error("A technical rerun needs its original identity, reason and one explicit arm");
  const sameCell=(run:typeof priorRuns[number],arm:string)=>run.queryId===task.id&&run.arm===arm&&run.repeat===repeat&&(mode==="capture"?run.purpose==="fixture-capture":run.purpose!=="fixture-capture"&&run.population===(mode==="live"?"live":"replay"));
  if(values["rerun-of"]){
    const previous=priorRuns.find((run)=>run.runId===values["rerun-of"]);
    if(!previous||!sameCell(previous,values.arm))throw new Error("Rerun does not name this series' original cell");
  }else if(priorRuns.some((run)=>(values.pair?["off","on"]:[values.arm]).some((arm)=>sameCell(run,arm))))throw new Error("This cell already has an outcome; retain it and declare any technical rerun explicitly");
  const bundle=values.bundle?await loadStudyReplayBundle(resolve(values.bundle)):undefined;
  if(mode==="replay"&&!bundle)throw new Error("Replay requires --bundle; no live pipeline fallback exists");
  if(bundle&&bundle.scenario!==task.id)throw new Error("Fixture scenario differs from task identity");
  const credentials=await readCredentialFileState(join(agentDir,"auth.json"),STUDY_MAIN_MODEL.provider);
  if(credentials.providerEntryType!=="oauth")throw new Error("Main model requires the prescribed subscription login");
  const seriesRoot=join(REPO_ROOT,"evidence/benchmarks",values.series);
  await mkdir(seriesRoot,{recursive:true});
  const seriesIdentity={schemaVersion:1,series:values.series,candidateCommit:source.commit,lockfileSha256:source.lockfileSha256,host:selection,models:available,design,remainingPlannedUsd:REMAINING_PLANNED_USD};
  const seriesPath=join(seriesRoot,"series.json");
  try{await writeNewJson(seriesPath,seriesIdentity);}catch(error){
    if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
    if(sha256Canonical(asJson(JSON.parse(await readFile(seriesPath,"utf8"))))!==sha256Canonical(asJson(seriesIdentity)))throw new Error("Existing series is frozen to different inputs or source; use a new series identity");
  }
  const spend=mode==="replay"?undefined:await openStudySpendLedger(spendRoot,baseline,{mustExist:true});
  const checkPhaseCost = async (): Promise<void> => {
    if (!spend) return;
    const state=await spend.snapshot();
    if(state.activeRuns.length||state.stopReasons.length)throw new Error("Programme accounting needs reconciliation; no next paid run admitted");
    const rows=(await readFile(spend.path,"utf8")).trim().split("\n").map((line)=>JSON.parse(line) as {kind:string;runId?:string;reportedNanoUsd?:number});
    const ids=design.tasks.filter((t)=>t.partition===task.partition).map((t)=>t.id+"-");
    const settlements=rows.filter((row)=>row.kind==="settle"&&ids.some((id)=>row.runId?.startsWith(id)));
    const phase=STUDY_PHASE_FORECAST[task.partition as "development"|"pilot"];
    const reported=settlements.reduce((sum,row)=>sum+(row.reportedNanoUsd??0),0)/1e9;
    if(settlements.length>=Math.ceil(phase.paidRuns/2)&&reported>3*phase.expectedUsd)throw new Error("Observed phase spending exceeds the declared halfway threshold; no next paid run admitted");
  };
  await checkPhaseCost();
  const scratch=join(REPO_ROOT,".tmp/study",values.series);
  await mkdir(scratch,{recursive:true});
  const active=join(scratch,".active");
  const lock=await open(active,"wx");
  await lock.writeFile(`${process.pid}\n`);await lock.close();
  const workspace=join(scratch,"workspace");
  const signal=new AbortController();
  const stop=()=>signal.abort();
  process.once("SIGINT",stop);process.once("SIGTERM",stop);
  let safeToClean=false;
  try{
    // No deletion of crash remnants or another run's workspace.
    await mkdir(workspace);
    process.env.TMPDIR=workspace;

    const pairSeed = Number.parseInt(sha256Canonical(asJson({seed,task:task.id,repeat})).slice(0,8),16);
    const arms: Array<"off"|"on"|"only">=values.pair?(mulberry32(pairSeed)()<0.5?["off","on"]:["on","off"]):[values.arm as "off"|"on"|"only"];
    for(let i=0;i<arms.length;i++){
      if(signal.signal.aborted)break;
      if(i>0)await mkdir(workspace);
      safeToClean=false;
      const runId=`${task.id}-${mode}-${arms[i]}-r${repeat}-${new Date().toISOString().replace(/[-:.]/g,"")}-${randomBytes(3).toString("hex")}`;
      const result=await runStudyTask({host,hostSelection:selection,runId,seriesRoot,workspace,task,arm:arms[i],mode,repeat,order:order+i,seed,rerunOf:values["rerun-of"],rerunReason:values["rerun-reason"],methodSha256:design.methodSha256,corpusSha256:design.corpusSha256,candidateCommit:source.commit,lockfileSha256:source.lockfileSha256,bundle,spend,remainingPlannedUsd:REMAINING_PLANNED_USD,signal:signal.signal});
      const dependencies=await reportLoadedDependencies({urls:modules.urls(),hostRoot:selection.root,repoRoot:REPO_ROOT});
      // Separate append-only receipt: the run manifest was finalised by the runner.
      const credentialsAfter=await readCredentialFileState(join(agentDir,"auth.json"),STUDY_MAIN_MODEL.provider);
      const scan=await scanRunForCredentials(result.runDir,[...new Set([...credentials.values,...credentialsAfter.values])]);
      await writeNewJson(join(seriesRoot,`${runId}-host-receipt.json`),{runId,node:{execPath:process.execPath,version:process.version},dependencies,source,environmentOverrides:["PI_OFFLINE=1","PI_SKIP_VERSION_CHECK=1","PI_TELEMETRY=0",`TMPDIR=${workspace}`],credentialFileChanged:credentials.digest!==credentialsAfter.digest,credentialMatches:scan.matchedFiles});
      console.log(JSON.stringify({runId,status:result.observation.status,runDir:result.runDir,manifestSha256:result.manifestSha256,mainUsage:result.observation.mainUsage,pipelineReportedUsd:result.observation.reportedPipelineUsd,fixtureBundle:result.captureBundle?join(result.runDir,"capture/bundle.json"):null},null,2));
      if(dependencies.outsideHostRelease.length||scan.matchedFiles.length)throw new Error("Run provenance or credential-care receipt requires review; no next run started");
      const outcome=JSON.parse(await readFile(join(result.runDir,"outcome.json"),"utf8")) as {settled:boolean};
      if(!outcome.settled)throw new Error("Unsettled runtime retained; refusing cleanup or a next run");
      await rm(workspace,{recursive:true}); // Exactly the owned, captured, settled run workspace.
      safeToClean=true;
      await checkPhaseCost();
    }
  }finally{
    process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);
    modules.stop();
    if(safeToClean)await unlink(active);
    else console.error(`Study workspace retained at ${workspace}; lock retained for inspection`);
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  studyMain().then(()=>{process.exitCode=0;setTimeout(()=>process.exit(0),250);},(error:unknown)=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;setTimeout(()=>process.exit(1),250);});
}
