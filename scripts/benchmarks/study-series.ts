// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reproduceAnalysis, type StudyAnalysisRun, type StudyDataset } from "./study-analysis.js";
import type { StudyTask } from "./study-design.js";
import { writeNewJson } from "./study-host.js";
import { studyTreeDigest } from "./study-runner.js";
import { observeToolCatalogue } from "./observer.js";
import { asJson } from "./canonical.js";

/** A partial evidence tail must never disappear into a smaller analysed sample. */
export async function assertSeriesInventoryComplete(seriesRoot: string, observedRunIds: readonly string[]): Promise<void> {
  const observed=new Set(observedRunIds);
  const entries=await readdir(seriesRoot,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return [];throw error;});
  for(const entry of entries){
    if(!entry.isDirectory()||entry.name.endsWith("-workspace"))continue;
    const text=await readFile(join(seriesRoot,entry.name,"identity.json"),"utf8").catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
    if(text===null)continue;
    const identity=JSON.parse(text) as {runId?:string};
    if(identity.runId&&!observed.has(identity.runId))throw new Error(`Unfinished run ${identity.runId} is retained on disk but missing from the inventory; reconcile it before further calls or analysis`);
  }
}

/** Offline development/pilot export. No relabelling into the measured partition. */
export async function analyseStudySeries(seriesRoot: string, partition: "development" | "pilot") {
  const series = JSON.parse(await readFile(join(seriesRoot,"series.json"),"utf8")) as {
    candidateCommit:string;
    design:{methodSha256:string;corpusSha256:string;tasks:StudyTask[]};
  };
  const runs = (await readFile(join(seriesRoot,"observations.ndjson"),"utf8")).split("\n").filter(Boolean).map((line)=>JSON.parse(line) as StudyAnalysisRun);
  await assertSeriesInventoryComplete(seriesRoot,runs.map((run)=>run.runId));
  // Verify every immutable run manifest and each file it binds before analysis.
  for(const run of runs) for(const artifact of run.artifacts) {
    const kind=await lstat(artifact.path);
    if(kind.isDirectory()){
      if(await studyTreeDigest(artifact.path)!==artifact.sha256)throw new Error(`Changed workspace snapshot: ${run.runId}`);
      continue;
    }
    if(!kind.isFile())throw new Error("Study artifacts must be regular files or directories");
    const bytes=await readFile(artifact.path);
    if(createHash("sha256").update(bytes).digest("hex")!==artifact.sha256)throw new Error(`Changed run manifest: ${run.runId}`);
    if(!artifact.path.endsWith("/manifest.json"))continue;
    const manifest=JSON.parse(bytes.toString()) as {files:Array<{name:string;sha256:string}>};
    const root=artifact.path.slice(0,-"manifest.json".length);
    for(const file of manifest.files){
      if(file.name.split(/[\\/]/).includes("..")||file.name.startsWith("/"))throw new Error("Invalid manifest file path");
      const actual=await readFile(join(root,file.name));
      if(createHash("sha256").update(actual).digest("hex")!==file.sha256)throw new Error(`Changed run artifact: ${run.runId}/${file.name}`);
    }
  }
  const metadataCorrections: NonNullable<StudyDataset["metadataCorrections"]>[number][]=[];
  const normalisedRuns: StudyAnalysisRun[]=[];
  for(const run of runs){
    const path=join(seriesRoot,run.runId,"actual-requests.ndjson");
    const text=await readFile(path,"utf8").catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return "";throw error;});
    const observed=text.split("\n").filter(Boolean).map((line)=>observeToolCatalogue(asJson(JSON.parse(line).payload)));
    const first=observed[0];
    const known=Boolean(first&&observed.every((item)=>item.status==="observed"&&item.sha256===first.sha256));
    const derived=first?.sha256??run.toolCatalogueSha256;
    if(known&&derived!==run.toolCatalogueSha256)metadataCorrections.push({runId:run.runId,field:"toolCatalogueSha256",recorded:run.toolCatalogueSha256,derived,sourceFileSha256:createHash("sha256").update(text).digest("hex")});
    normalisedRuns.push({...run,toolCatalogueSha256:derived,toolCatalogueObserved:known});
  }
  const queryIds=series.design.tasks.filter((task)=>task.partition===partition).map((task)=>task.id);
  const population={queryIds,repeats:partition==="pilot"?[1,2]:[1]};
  const dataset:StudyDataset={schemaVersion:1,design:{methodSha256:series.design.methodSha256,corpusSha256:series.design.corpusSha256,candidateCommit:series.candidateCommit,analysisPartition:partition,populations:{replay:population,live:population},bootstrapSeed:20261102,bootstrapDraws:10_000,confidence:0.95,humanCalibrationApproved:false},runs:normalisedRuns,metadataCorrections};
  const stamp=new Date().toISOString().replace(/[-:.]/g,"");
  const datasetPath=join(seriesRoot,`dataset-${partition}-${stamp}.json`);
  const output=join(seriesRoot,`analysis-${partition}-${stamp}`);
  await writeNewJson(datasetPath,dataset);
  await mkdir(output);
  await reproduceAnalysis(datasetPath,output);
  return {datasetPath,output,analysisPartition:partition,qualityScored:false};
}
