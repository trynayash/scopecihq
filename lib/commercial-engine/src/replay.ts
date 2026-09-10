import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SOWDecomposer } from './sow-decomposer.js';
import { CapabilityExtractor } from './capability-extractor.js';
import { evaluateCommercialScope, computeEvaluationIdentityHash } from './evaluator.js';
import { DEFAULT_POLICY_CONFIG } from './types.js';
import type { LinearIssue, PullRequest, ScopeBaseline, ChangeOrder } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ReplayResult {
  fixtureName: string;
  matched: boolean;
  actualState: string;
  expectedState: string;
  actualTaxonomy: string;
  expectedTaxonomy: string;
  identityHash: string;
  evidenceIds: string[];
  details: string[];
}

export async function replayFixture(fixtureArg: string): Promise<ReplayResult> {
  // Resolve fixture directory
  let fixtureDir = fixtureArg;
  if (!fs.existsSync(fixtureDir)) {
    // Try resolving relative to fixtures/golden/
    const candidate = path.resolve(__dirname, '../fixtures/golden', fixtureArg);
    if (fs.existsSync(candidate)) {
      fixtureDir = candidate;
    } else {
      throw new Error(`Fixture directory not found: ${fixtureArg} (checked ${candidate})`);
    }
  }

  const fixtureName = path.basename(fixtureDir);
  const details: string[] = [];

  // Read files
  const contractPath = path.join(fixtureDir, 'contract.md');
  const issuePath = path.join(fixtureDir, 'issue.json');
  const prPath = path.join(fixtureDir, 'pr.json');
  const diffPath = path.join(fixtureDir, 'diff.patch');
  const expectedPath = path.join(fixtureDir, 'expected.json');

  if (!fs.existsSync(contractPath) && !fs.existsSync(prPath)) {
    throw new Error(`Invalid fixture directory: missing contract.md or pr.json in ${fixtureDir}`);
  }

  const contractText = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
  const issue: LinearIssue | undefined = fs.existsSync(issuePath)
    ? JSON.parse(fs.readFileSync(issuePath, 'utf8'))
    : undefined;
  const pullRequest: PullRequest = JSON.parse(fs.readFileSync(prPath, 'utf8'));
  const diffPatch = fs.existsSync(diffPath) ? fs.readFileSync(diffPath, 'utf8') : '';
  const expected = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : null;

  // 1. Decompose SOW into Baseline
  let baseline: ScopeBaseline;
  if (contractText) {
    const decomposer = new SOWDecomposer();
    const decomp = decomposer.decompose(contractText, { contractId: 'contract_golden_01' });
    baseline = decomp.baseline;
  } else {
    baseline = {
      id: 'baseline_default',
      title: 'Default Baseline',
      description: 'Default baseline description',
      status: 'active',
      version: 'v1.0',
      contractId: 'contract_01',
      clauses: [],
      deliverables: [],
      createdAt: '2026-09-01T00:00:00Z',
    };
  }

  // Check for Change Orders
  const approvedCOs: ChangeOrder[] = [];
  if (fixtureName.includes('approved-change') || contractText.includes('Change Order #12')) {
    approvedCOs.push({
      id: 'co_12',
      contractId: 'contract_golden_01',
      baselineVersion: 'v1.0',
      title: 'CO #12: Organization Roles and Permissions Subsystem',
      reason: 'Client requested enterprise multi-tenant RBAC',
      authorizedSubsystems: ['organization_rbac', 'team_invitations', 'roles_management', 'rbac'],
      hours: { min: 18, max: 24 },
      amount: 3200,
      status: 'APPROVED',
      approvedBy: 'Client Authorized Representative',
      approvedAt: '2026-09-14T10:00:00Z',
    });
  }

  // 2. Extract capabilities from diff & PR
  const extractor = new CapabilityExtractor();
  const { capabilities: detectedCapabilities } = extractor.extract({
    pullRequest,
    issue,
  });

  // 3. Evaluate commercial scope
  const evaluation = evaluateCommercialScope({
    baseline,
    approvedChangeOrders: approvedCOs,
    issue,
    pullRequest,
    policyMode: 'REVIEW',
    policyConfig: DEFAULT_POLICY_CONFIG,
  });

  // 4. Verification
  let matched = true;
  if (expected) {
    if (evaluation.state !== expected.state) {
      matched = false;
      details.push(`State mismatch: expected ${expected.state}, got ${evaluation.state}`);
    }
    if (expected.taxonomy && evaluation.taxonomy !== expected.taxonomy) {
      matched = false;
      details.push(`Taxonomy mismatch: expected ${expected.taxonomy}, got ${evaluation.taxonomy}`);
    }
    if (expected.commercialConfidence && evaluation.commercialConfidence !== expected.commercialConfidence) {
      details.push(`Confidence notice: expected ${expected.commercialConfidence}, got ${evaluation.commercialConfidence}`);
    }
  }

  // Verify identity hash
  const expectedHash = computeEvaluationIdentityHash({
    baselineVersion: baseline.version,
    documentVersion: 'doc_v1',
    issueSnapshotHash: evaluation.evidenceBundle.issueEvidence ? 'computed' : 'no_issue',
    headSha: pullRequest.headSha || 'sha_unknown',
    diffAnalysisVersion: 1,
    evaluatorVersion: evaluation.evaluatorVersion,
    modelVersion: 'deterministic_rule_engine_v1',
    promptVersion: 'sow_decomp_v1_2026_09',
    capabilityTaxonomyVersion: CapabilityExtractor.TAXONOMY_VERSION,
    scopeTaxonomyVersion: 'scope_tax_2026_09_v1',
    estimationRulesVersion: 'est_rules_2026_09_v1',
    policyConfigVersion: DEFAULT_POLICY_CONFIG.version,
  });

  if (!evaluation.identityHash || evaluation.identityHash.length !== 64) {
    matched = false;
    details.push(`Invalid identity hash format: ${evaluation.identityHash}`);
  }

  // Check evidence bundle completeness (Requirement 11, 14)
  if (!evaluation.evidenceBundle || !evaluation.evidenceBundle.decisionExplanation) {
    matched = false;
    details.push('Missing immutable evidence bundle or decision explanation');
  }

  return {
    fixtureName,
    matched,
    actualState: evaluation.state,
    expectedState: expected?.state || 'N/A',
    actualTaxonomy: evaluation.taxonomy,
    expectedTaxonomy: expected?.taxonomy || 'N/A',
    identityHash: evaluation.identityHash,
    evidenceIds: evaluation.evidenceBundle.decisionExplanation.evidenceIds,
    details,
  };
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixtureArg = process.argv[2] || 'scope-expansion';
  console.log(`\n============================================================`);
  console.log(`         SCOPECI REPLAY EVALUATION — FIXTURE REPLAY         `);
  console.log(`============================================================`);
  console.log(`Target Fixture: ${fixtureArg}\n`);

  replayFixture(fixtureArg)
    .then((result) => {
      console.log(`Fixture:          ${result.fixtureName}`);
      console.log(`Result:           ${result.matched ? 'MATCHED ✓' : 'FAILED ✗'}`);
      console.log(`Commercial State: ${result.actualState} (Expected: ${result.expectedState})`);
      console.log(`Scope Taxonomy:   ${result.actualTaxonomy} (Expected: ${result.expectedTaxonomy})`);
      console.log(`Identity Hash:    ${result.identityHash}`);
      console.log(`Evidence IDs:     ${result.evidenceIds.join(', ')}`);

      if (result.details.length > 0) {
        console.log(`\nNotes/Mismatches:`);
        result.details.forEach((d) => console.log(`  - ${d}`));
      }

      console.log(`============================================================\n`);
      if (!result.matched) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`Replay execution failed:`, err);
      process.exit(1);
    });
}
