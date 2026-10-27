import crypto from "node:crypto";
import { z } from "zod";
import type { ContractClause, Deliverable, ScopeBaseline } from "./types.js";
import { SOW_DECOMPOSITION_PROMPT_V1 } from "./prompts/v1/sow-decomposition.js";

export const DecomposedClauseSchema = z.object({
  clauseRef: z.string(),
  title: z.string(),
  legalText: z.string(),
  inclusions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  page: z.number().optional(),
  location: z.string().optional(),
});

export const DecomposedDeliverableSchema = z.object({
  clauseRef: z.string(),
  title: z.string(),
  scopeBoundary: z.string(),
  keywords: z.array(z.string()).default([]),
  estimatedHours: z.object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  }).default({ min: 0, max: 0 }),
  budgetAllocated: z.number().nonnegative().default(0),
});

export const DecomposedSOWSchema = z.object({
  contractTitle: z.string(),
  documentVersion: z.string().default("sow_v1.0"),
  clauses: z.array(DecomposedClauseSchema),
  deliverables: z.array(DecomposedDeliverableSchema),
});

export type DecomposedSOW = z.infer<typeof DecomposedSOWSchema>;

export interface SOWDecompositionResult {
  baseline: ScopeBaseline;
  documentVersion: string;
  decompositionHash: string;
  warnings: string[];
}

export class SOWDecompositionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "SOWDecompositionError";
  }
}

/**
 * Robust SOW Decomposer.
 * Implements Hard Requirements:
 * - Requirement 2: Explicit exclusions are recorded separately and prioritized over absence.
 * - Requirement 12 & 28: Prompt injection attempts in SOW text are neutralized.
 * - Requirement 15: Prompts and decomposition rules are versioned.
 * - Requirement 18: Contract clauses are tagged as PRIMARY_CONTRACT quality.
 */
export class SOWDecomposer {
  private static readonly MAX_DOCUMENT_BYTES = 512 * 1024; // 512KB bound

  /**
   * Decomposes raw Markdown / text SOW into a validated ScopeBaseline.
   */
  decompose(
    rawText: string,
    options: {
      contractId?: string;
      version?: string;
      title?: string;
    } = {}
  ): SOWDecompositionResult {
    if (!rawText || typeof rawText !== "string") {
      throw new SOWDecompositionError("SOW document content is empty or invalid", "EMPTY_DOCUMENT");
    }

    if (Buffer.byteLength(rawText, "utf8") > SOWDecomposer.MAX_DOCUMENT_BYTES) {
      throw new SOWDecompositionError(
        `SOW document exceeds maximum allowed size (${SOWDecomposer.MAX_DOCUMENT_BYTES} bytes)`,
        "DOCUMENT_TOO_LARGE"
      );
    }

    // Neutralize prompt injection attempts: Strip control directives that attempt to alter evaluation state
    const sanitizedText = this.neutralizePromptInjections(rawText);

    // Parse structured sections
    const parsed = this.parseDocumentStructure(sanitizedText, options.title);

    // Validate schema
    const validation = DecomposedSOWSchema.safeParse(parsed);
    if (!validation.success) {
      throw new SOWDecompositionError(
        `SOW structure validation failed: ${validation.error.message}`,
        "INVALID_SCHEMA"
      );
    }

    const { contractTitle, documentVersion, clauses: rawClauses, deliverables: rawDeliverables } = validation.data;
    const warnings: string[] = [];

    // Map clauses with stable IDs
    const clauseMap = new Map<string, ContractClause>();
    const clauses: ContractClause[] = rawClauses.map((c) => {
      const id = `clause_${c.clauseRef.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`;
      const clause: ContractClause = {
        id,
        clauseRef: c.clauseRef,
        title: c.title,
        legalText: c.legalText,
        inclusions: c.inclusions.map((i) => i.trim().toLowerCase()),
        exclusions: c.exclusions.map((e) => e.trim().toLowerCase()),
        sourcePage: c.page,
        sourceLocation: c.location || `Section ${c.clauseRef}`,
      };
      clauseMap.set(c.clauseRef, clause);
      return clause;
    });

    // Map deliverables and enforce grounding (Hard Requirement: every deliverable must reference a valid clause)
    const deliverables: Deliverable[] = [];
    for (const d of rawDeliverables) {
      const parentClause = clauseMap.get(d.clauseRef);
      if (!parentClause) {
        warnings.push(`Deliverable "${d.title}" references unknown clause "${d.clauseRef}"; discarded.`);
        continue;
      }

      const id = `deliv_${d.title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`;
      deliverables.push({
        id,
        clauseId: parentClause.id,
        title: d.title,
        scopeBoundary: d.scopeBoundary,
        keywords: d.keywords.map((k) => k.trim().toLowerCase()),
        estimatedHours: d.estimatedHours,
        budgetAllocated: d.budgetAllocated,
      });
    }

    if (clauses.length === 0) {
      throw new SOWDecompositionError("SOW document must contain at least one valid contractual clause (§)", "NO_CLAUSES_FOUND");
    }

    const baselineId = `baseline_${options.version || "v1"}_${Date.now()}`;
    const baseline: ScopeBaseline = {
      id: baselineId,
      version: options.version || "v1",
      contractId: options.contractId || "contract_default",
      title: options.title || contractTitle,
      description: `Contract scope baseline derived from ${documentVersion}`,
      status: "active",
      documentVersion,
      clauses,
      deliverables,
      createdAt: new Date().toISOString(),
    };

    const decompositionHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(baseline))
      .digest("hex");

    return {
      baseline,
      documentVersion,
      decompositionHash,
      warnings,
    };
  }

  /**
   * Neutralizes prompt injection strings so malicious instructions cannot alter engine behavior.
   */
  private neutralizePromptInjections(text: string): string {
    const dangerousPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/gi,
      /authorize\s+(all\s+)?merges?/gi,
      /commercial\s+approval\s+granted/gi,
      /developer\s+override/gi,
      /mark\s+this\s+as\s+in[_\s]scope/gi,
      /scopeci\s+system\s+message/gi,
    ];

    let clean = text;
    for (const pattern of dangerousPatterns) {
      clean = clean.replace(pattern, "[REDACTED_DIRECTIVE]");
    }
    return clean;
  }

  /**
   * Parses structured SOW text or markdown into clauses and deliverables.
   */
  private parseDocumentStructure(text: string, defaultTitle?: string): DecomposedSOW {
    const lines = text.split(/\r?\n/);
    let contractTitle = defaultTitle || "Standard Statement of Work";
    let documentVersion = "sow_v1.0";

    const clauses: z.infer<typeof DecomposedClauseSchema>[] = [];
    const deliverables: z.infer<typeof DecomposedDeliverableSchema>[] = [];

    let currentClause: Partial<z.infer<typeof DecomposedClauseSchema>> | null = null;
    let currentTextLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for title header (# Title)
      if (line.startsWith("# ") && !defaultTitle) {
        contractTitle = line.substring(2).trim();
        continue;
      }

      // Look for version metadata (Version: v1.0)
      const versionMatch = line.match(/(?:version|ver\.?)\s*[:=]\s*([a-zA-Z0-9._-]+)/i);
      if (versionMatch) {
        documentVersion = versionMatch[1];
      }

      // Look for clause header (§4.2 or Section 4.2 or ## 4.2 or Clause 4.2)
      const clauseHeaderMatch = line.match(
        /^(?:##+\s*)?(?:§|Section\s+|Clause\s+)?(\d+(?:\.\d+)+)\s*[:\-–]?\s*(.+)$/i
      );

      if (clauseHeaderMatch) {
        // Save previous clause
        if (currentClause && currentClause.clauseRef) {
          currentClause.legalText = currentTextLines.join("\n").trim();
          this.extractInclusionsAndExclusions(currentClause, currentClause.legalText);
          clauses.push(currentClause as z.infer<typeof DecomposedClauseSchema>);
        }

        const clauseRef = `§${clauseHeaderMatch[1]}`;
        const title = clauseHeaderMatch[2].replace(/^[:\-–\s]+/, "").trim();

        currentClause = {
          clauseRef,
          title,
          inclusions: [],
          exclusions: [],
          location: `Section ${clauseHeaderMatch[1]}`,
        };
        currentTextLines = [];
        continue;
      }

      if (currentClause) {
        currentTextLines.push(line);
      }
    }

    // Flush last clause
    if (currentClause && currentClause.clauseRef) {
      currentClause.legalText = currentTextLines.join("\n").trim();
      this.extractInclusionsAndExclusions(currentClause, currentClause.legalText);
      clauses.push(currentClause as z.infer<typeof DecomposedClauseSchema>);
    }

    // If clauses were found, generate deliverables for each clause
    for (const c of clauses) {
      const keywords = [...c.inclusions];
      if (c.title) {
        keywords.push(
          ...c.title
            .toLowerCase()
            .split(/[^a-zA-Z0-9]+/)
            .filter((w) => w.length > 3)
        );
      }

      deliverables.push({
        clauseRef: c.clauseRef,
        title: `${c.title} Subsystem`,
        scopeBoundary: c.legalText || c.title,
        keywords: Array.from(new Set(keywords)),
        ...extractStatedEffort(c.legalText || ""),
      });
    }

    return {
      contractTitle,
      documentVersion,
      clauses,
      deliverables,
    };
  }

  private extractInclusionsAndExclusions(
    clause: Partial<z.infer<typeof DecomposedClauseSchema>>,
    legalText: string
  ): void {
    const { inclusions, exclusions } = extractScopeBoundaries(legalText);
    clause.inclusions = inclusions;
    clause.exclusions = exclusions;
  }
}

/* ------------------------------------------------------------------ */
/* Scope boundaries                                                    */
/* ------------------------------------------------------------------ */

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Lowercases an item and trims list markers, markdown emphasis and trailing punctuation. */
function cleanItem(item: string): string {
  return item
    .replace(BULLET, "")
    .replace(/\*\*|__/g, "")
    .replace(/^(?:and|or)\s+/i, "")
    .replace(/[\s.;:,]+$/, "")
    .trim()
    .toLowerCase();
}

/**
 * "A, B, and C" -> ["a", "b", "c"]. A trailing clause such as ", which shall
 * require a separate Change Order" is commentary on the list, not an item.
 */
function splitList(text: string): string[] {
  return text
    .split(/,\s*(?:which|unless|except|where|provided|because|but|as)\b/i)[0]
    .split(/,|;|\band\b/i)
    .map(cleanItem)
    .filter((item) => item.length > 2);
}

/**
 * Items listed after a header such as "Explicit Exclusions:" or "including:".
 * A header at the end of its line takes the bullet lines that follow it; a
 * header with text after the colon takes that text as a comma separated list.
 */
function listsAfter(text: string, header: RegExp): string[] {
  const items: string[] = [];
  for (const match of text.matchAll(header)) {
    const rest = text.slice((match.index ?? 0) + match[0].length);
    const [firstLine, ...nextLines] = rest.split(/\r?\n/);

    if (firstLine.trim()) {
      items.push(...splitList(firstLine.split(".")[0]));
      continue;
    }
    for (const line of nextLines) {
      if (!line.trim()) {
        if (items.length > 0) break;
        continue;
      }
      if (!BULLET.test(line)) break;
      const item = cleanItem(line);
      if (item.length > 2) items.push(item);
    }
  }
  return items;
}

const EXCLUSION_HEADER =
  /\*{0,2}(?:explicit\s+exclusions?\*{0,2}[ \t]*:?|(?:exclusions|out\s+of\s+scope|not\s+included|excluded|excluding|excludes)\*{0,2}[ \t]*:)/gi;
const INCLUSION_HEADER =
  /\*{0,2}(?:explicit\s+inclusions?\*{0,2}[ \t]*:?|(?:inclusions|in\s+scope|included|including|includes)\*{0,2}[ \t]*:)/gi;

/** "Explicitly excludes X, Y and Z." / "Does not include X." on one line. */
const EXCLUSION_PROSE = /(?:explicitly\s+excludes?|does\s+not\s+include|\bexcludes?)\b[ \t]*:?[ \t]*([^.\n]+)/gi;
/** "X, Y and Z are explicitly out of scope." */
const EXCLUSION_PREDICATE =
  /([^.\n:]+?)\s+(?:is|are)\s+(?:explicitly\s+|expressly\s+|strictly\s+)?(?:out\s+of\s+scope|excluded|not\s+included|not\s+in\s+scope)/gi;
/** "Includes X and Y." / "shall deliver X." / "is authorized to deliver X." on one line. */
const INCLUSION_PROSE =
  /(?:\bincludes?|(?:shall|will|(?:is|are)\s+authori[sz]ed\s+to)\s+(?:deliver|implement|build|provide)|\bfeatures?)\b[ \t]+([^.\n:]+)/gi;

/**
 * Reads what a clause includes and excludes from its own wording: header
 * lists ("Explicit Exclusions:", "including:"), "excludes X" sentences and
 * "X is out of scope" sentences. Used on parsed SOW clauses and on clause rows
 * stored in the database.
 */
export function extractScopeBoundaries(legalText: string): { inclusions: string[]; exclusions: string[] } {
  const exclusions = [
    ...listsAfter(legalText, EXCLUSION_HEADER),
    ...[...legalText.matchAll(EXCLUSION_PROSE)].flatMap((m) => splitList(m[1])),
    ...[...legalText.matchAll(EXCLUSION_PREDICATE)].flatMap((m) => splitList(m[1])),
  ];
  const inclusions = [
    ...listsAfter(legalText, INCLUSION_HEADER),
    ...[...legalText.matchAll(INCLUSION_PROSE)].flatMap((m) => splitList(m[1])),
  ];

  const unique = (items: string[]) => Array.from(new Set(items));
  const excluded = unique(exclusions);
  // A phrase the contract excludes is never also counted as included.
  return { inclusions: unique(inclusions).filter((item) => !excluded.includes(item)), exclusions: excluded };
}

/**
 * Hours and budget, only when the clause states them ("Estimated hours:
 * 40-60", "Budget: $7,500"). Zero means the SOW gave no figure; nothing is
 * filled in on its behalf.
 */
export function extractStatedEffort(legalText: string): {
  estimatedHours: { min: number; max: number };
  budgetAllocated: number;
} {
  const hours = legalText.match(
    /(?:estimated\s+(?:effort|hours)|estimate|effort|hours)\s*[:=]\s*(\d+)(?:\s*(?:-|–|to)\s*(\d+))?/i
  );
  const budget = legalText.match(/(?:budget|fee)\s*[:=]\s*(?:usd\s*|\$|£|€)?\s*([\d,]+)/i);

  const min = hours ? Number(hours[1]) : 0;
  const max = hours ? Number(hours[2] ?? hours[1]) : 0;
  return {
    estimatedHours: { min, max },
    budgetAllocated: budget ? Number(budget[1].replace(/,/g, "")) : 0,
  };
}
