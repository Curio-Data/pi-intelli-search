// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { AdequacyAssessment } from "./contracts.js";

export const REQUIRED_CRITERION_IDS = [1, 2, 3, 4, 5, 6] as const;

export interface AdequacyResult {
  adequate: boolean;
  assessorPresent: boolean;
  uniqueCriteria: boolean;
  allCriteriaPass: boolean;
  reasonsCited: boolean;
  sourcesCited: boolean;
  readableEvidence: boolean;
  independentReview: boolean;
  disagreementsResolved: boolean;
  unsupportedClaimStatusKnown: boolean;
  materialUnsupportedClaim: boolean;
  criterionIds: number[];
  problems: string[];
}

/** Apply the frozen six-criterion rubric without treating absent evidence as a pass. */
export function assessAdequacy(assessment?: AdequacyAssessment): AdequacyResult {
  if (!assessment) {
    return {
      adequate: false,
      assessorPresent: false,
      uniqueCriteria: false,
      allCriteriaPass: false,
      reasonsCited: false,
      sourcesCited: false,
      readableEvidence: false,
      independentReview: false,
      disagreementsResolved: false,
      unsupportedClaimStatusKnown: false,
      materialUnsupportedClaim: false,
      criterionIds: [],
      problems: ["Adequacy assessment is missing."],
    };
  }

  const problems: string[] = [];
  const criteria = Array.isArray(assessment.criteria) ? assessment.criteria : [];
  const criterionIds = criteria.map(criterion => criterion.id);
  const idCounts = new Map<number, number>();
  for (const id of criterionIds) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);

  const duplicateIds = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id);
  const missingIds = REQUIRED_CRITERION_IDS.filter(id => !idCounts.has(id));
  const unexpectedIds = criterionIds.filter(id => !REQUIRED_CRITERION_IDS.includes(id as 1 | 2 | 3 | 4 | 5 | 6));
  const uniqueCriteria = criteria.length === REQUIRED_CRITERION_IDS.length
    && duplicateIds.length === 0 && missingIds.length === 0 && unexpectedIds.length === 0;
  if (!uniqueCriteria) {
    const details: string[] = [];
    if (missingIds.length > 0) details.push(`missing ${missingIds.join(", ")}`);
    if (duplicateIds.length > 0) details.push(`duplicate ${duplicateIds.join(", ")}`);
    if (unexpectedIds.length > 0) details.push(`unexpected ${unexpectedIds.join(", ")}`);
    problems.push(`Criteria must contain exactly one each of IDs 1 through 6${details.length ? ` (${details.join("; ")})` : ""}.`);
  }

  const allCriteriaPass = uniqueCriteria && criteria.every(criterion => criterion.pass === true);
  if (!allCriteriaPass) problems.push("One or more required criteria did not pass.");

  const reasonsCited = uniqueCriteria && criteria.every(criterion =>
    typeof criterion.justification === "string" && criterion.justification.trim().length > 0);
  if (!reasonsCited) problems.push("Every criterion requires a nonempty justification.");

  const sourcesCited = uniqueCriteria && criteria.every(criterion =>
    Array.isArray(criterion.sourceRefs)
    && criterion.sourceRefs.length > 0
    && criterion.sourceRefs.every(reference => typeof reference === "string" && reference.trim().length > 0));
  if (!sourcesCited) problems.push("Every criterion requires at least one nonempty source reference.");

  const assessorPresent = typeof assessment.assessor === "string" && assessment.assessor.trim().length > 0;
  if (!assessorPresent) problems.push("The assessor is missing.");

  const readableEvidence = assessment.evidenceAccessible === true;
  if (!readableEvidence) problems.push("Readable evidence access was not established.");

  const review = assessment.review;
  const reviewSourcesCited = Array.isArray(review?.sourceRefs) && review.sourceRefs.length > 0
    && review.sourceRefs.every(reference => typeof reference === "string" && reference.trim().length > 0);
  const validDisagreements = review?.disagreements === undefined || Array.isArray(review.disagreements);
  const independentReview = !!review && validDisagreements
    && typeof review.reviewer === "string" && review.reviewer.trim().length > 0
    && review.reviewer.trim() !== (typeof assessment.assessor === "string" ? assessment.assessor.trim() : "")
    && review.agrees === true
    && typeof review.evidencePath === "string" && review.evidencePath.trim().length > 0
    && typeof review.rationale === "string" && review.rationale.trim().length > 0
    && reviewSourcesCited;
  if (!independentReview) {
    problems.push("Independent review requires a distinct reviewer, agreement, durable evidence path, rationale and source references.");
  }
  const disagreements = Array.isArray(review?.disagreements) ? review.disagreements : [];
  const disagreementsResolved = disagreements.length === 0
    || (typeof assessment.adjudication === "string" && assessment.adjudication.trim().length > 0 && reviewSourcesCited);
  if (!disagreementsResolved) problems.push("Independent-review disagreements lack source-cited adjudication.");

  const unsupportedClaimStatusKnown = typeof assessment.materialUnsupportedClaim === "boolean";
  const materialUnsupportedClaim = assessment.materialUnsupportedClaim === true;
  if (!unsupportedClaimStatusKnown) problems.push("The unsupported-claim assessment is missing.");
  if (materialUnsupportedClaim) problems.push("The answer contains a material unsupported claim.");

  return {
    adequate: uniqueCriteria && allCriteriaPass && reasonsCited && sourcesCited
      && assessorPresent && readableEvidence && independentReview && disagreementsResolved
      && unsupportedClaimStatusKnown && !materialUnsupportedClaim,
    assessorPresent,
    uniqueCriteria,
    allCriteriaPass,
    reasonsCited,
    sourcesCited,
    readableEvidence,
    independentReview,
    disagreementsResolved,
    unsupportedClaimStatusKnown,
    materialUnsupportedClaim,
    criterionIds,
    problems,
  };
}
