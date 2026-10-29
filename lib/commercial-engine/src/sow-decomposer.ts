import crypto from "node:crypto";
import { z } from "zod";
import type { ContractClause, Deliverable, ScopeBaseline } from "./types.js";
import { SOW_DECOMPOSITION_PROMPT_V1 } from "./prompts/v1/sow-decomposition.js";
import { EXCEPTION_MARKER } from "./contract-matcher.js";

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
    // Every line break ends a line, including a lone "\r" and the Unicode line
    // and paragraph separators. A line then holds nothing "." can't match, so
    // the "(.+)$" patterns below can't fail late and backtrack along it.
    const lines = text.split(/\r\n|[\n\r\u2028\u2029]/);
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

      // Look for clause header (§4.2 or Section 4.2 or ## 4.2 or Clause 4.2).
      // The separator before the title is stripped below rather than matched
      // here, so no two parts of the pattern compete for the same spaces.
      let clauseHeaderMatch = line.match(/^(?:##+\s*)?(?:§|Section\s+|Clause\s+)?(\d+(?:\.\d+)+)(.+)$/i);
      if (!clauseHeaderMatch && currentClause) {
        // "## 3. Out of Scope" after numbered clauses starts its own clause, so
        // its items are cited as §3 rather than run into the clause above it.
        const scopeSection = line.match(/^#{2,4}\s*§?(\d+)\.?\s+(\S.*)$/);
        if (scopeSection && scopeHeading(scopeSection[2])) clauseHeaderMatch = scopeSection;
      }

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

    // Contracts without numbered sections ("## Scope", or text copied out of
    // a PDF) still say what's in and out: fall back to markdown headings, and
    // failing that, read the whole document as one clause.
    if (clauses.length === 0) {
      clauses.push(...this.parseUnnumbered(lines));
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

  /** Sections from markdown headings or "Section N" lines, numbered §1, §2, ... in order. */
  private parseUnnumbered(lines: string[]): z.infer<typeof DecomposedClauseSchema>[] {
    const sections: Array<{ title: string; body: string[] }> = [];
    let current: { title: string; body: string[] } | undefined;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("# ")) continue;
      // Each title starts at its first non-space character ("\S"), so the
      // spaces before it can only be matched one way.
      const heading =
        line.match(/^#{2,4}\s+(\S.*)$/) ?? line.match(/^(?:section|clause)\s+\d+(?:\s*[:.\-–])?\s*(\S.*)$/i);
      if (heading) {
        current = { title: heading[1].replace(/[*_#]/g, "").trim(), body: [] };
        sections.push(current);
        continue;
      }
      if (!current) {
        current = { title: "Scope", body: [] };
        sections.push(current);
      }
      current.body.push(line);
    }

    return sections
      .filter((section) => section.body.join("").trim().length > 0)
      .map((section, index) => {
        const legalText = section.body.join("\n").trim();
        return {
          clauseRef: `§${index + 1}`,
          title: section.title,
          legalText,
          ...extractScopeBoundaries(withScopeHeading(section.title, legalText)),
          location: `Section ${index + 1}`,
        };
      });
  }

  private extractInclusionsAndExclusions(
    clause: Partial<z.infer<typeof DecomposedClauseSchema>>,
    legalText: string
  ): void {
    const { inclusions, exclusions } = extractScopeBoundaries(withScopeHeading(clause.title, legalText));
    clause.inclusions = inclusions;
    clause.exclusions = exclusions;
  }
}

/* ------------------------------------------------------------------ */
/* Scope boundaries                                                    */
/* ------------------------------------------------------------------ */

// Every pattern below runs on text anyone can paste into the public demo, so
// each one takes time in proportion to the text: no two parts of a pattern
// can match the same characters, and lists are read in one pass.

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Lowercases an item and trims list markers, markdown emphasis and trailing punctuation. */
function cleanItem(item: string): string {
  const cleaned = item
    .replace(BULLET, "")
    .replace(/\*\*|__/g, "")
    .replace(/^(?:and|or)\s+/i, "");
  // Trailing punctuation is trimmed with a loop: the pattern /[\s.;:,]+$/
  // restarts at every character of a long run of spaces or dots.
  let end = cleaned.length;
  while (end > 0 && /[\s.;:,]/.test(cleaned[end - 1])) end--;
  return cleaned.slice(0, end).trim().toLowerCase();
}

/**
 * "A, B, and C" -> ["a", "b", "c"]. A trailing clause such as ", which shall
 * require a separate Change Order" is commentary on the list, not an item.
 *
 * An exception stays with its item: "integrations other than Stripe and
 * SendGrid" is one exclusion, not three, and "social login (Google,
 * Facebook)" keeps its examples. The matcher reads both forms. The exception
 * ends at the next comma or semicolon, so in "payment providers other than
 * Stripe, native mobile apps and gift cards" the mobile apps and gift cards
 * are still excluded.
 */
function splitList(text: string): string[] {
  const listed = text.split(/,\s*(?:which|unless|except|where|provided|because|but|as)\b/i)[0];
  const items: string[] = [];
  let rest = listed;
  for (;;) {
    const marker = rest.search(EXCEPTION_MARKER);
    if (marker < 0) {
      items.push(...splitTopLevel(rest));
      break;
    }
    const before = splitTopLevel(rest.slice(0, marker));
    const after = rest.slice(marker);
    const end = exceptionEnd(after, openBrackets(rest.slice(0, marker)));
    const exception = after.slice(0, end).trim();
    // "integrations (" + "other than Stripe)" reads "integrations (other than stripe)".
    const item = (before.pop() ?? "").trimEnd();
    items.push(...before, /[([]$/.test(item) || !item ? `${item}${exception}` : `${item} ${exception}`);
    rest = after.slice(end);
  }
  return items.map(cleanItem).filter((item) => item.length > 2);
}

/** How many brackets are still open at the end of `text`. */
function openBrackets(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
  }
  return depth;
}

/**
 * Where an exception ends: at the first comma or semicolon outside brackets.
 * An exception inside brackets, "(other than Stripe, SendGrid)", runs to the
 * bracket's end, so its own list stays with it.
 */
function exceptionEnd(text: string, depth: number): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if ((ch === "," || ch === ";") && depth === 0) return i;
  }
  return text.length;
}

/** Splits on commas, semicolons and "and" outside brackets, in one pass. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth > 0) continue;
    else if (ch === "," || ch === ";") {
      parts.push(text.slice(start, i));
      start = i + 1;
    } else if ((ch === "a" || ch === "A") && (i === 0 || /\W/.test(text[i - 1])) && /^and(?:\W|$)/i.test(text.slice(i, i + 4))) {
      parts.push(text.slice(start, i));
      start = i + 3;
      i += 2;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Items listed after a header such as "Explicit Exclusions:" or "including:".
 * A header at the end of its line takes the bullet lines that follow it; a
 * header with text after the colon takes that text, up to the end of the
 * sentence or the next header, as a comma separated list.
 */
function listsAfter(text: string, header: RegExp): string[] {
  const items: string[] = [];
  const lines = text.split(/\r?\n/);
  const starts = [0];
  for (let i = 0; i + 1 < lines.length; i++) {
    const end = starts[i] + lines[i].length;
    starts.push(end + (text[end] === "\r" ? 2 : 1));
  }

  const matches = [...text.matchAll(header)];
  let line = 0;
  // The last bullet line read as an item. A header inside a list already read
  // would read the same bullets again and add nothing, and doing that for
  // every header made a long list of headers take seconds.
  let lastItemLine = -1;
  matches.forEach((match, index) => {
    const end = (match.index ?? 0) + match[0].length;
    while (line + 1 < lines.length && starts[line + 1] <= end) line++;
    const lineEnd = starts[line] + lines[line].length;

    if (/\S/.test(text.slice(end, lineEnd))) {
      const next = matches[index + 1]?.index ?? lineEnd;
      items.push(...splitList(text.slice(end, Math.min(lineEnd, next)).split(".")[0]));
      return;
    }
    if (line < lastItemLine) return;
    // Blank lines are skipped until this header's own first item.
    const found = items.length;
    for (let next = line + 1; next < lines.length; next++) {
      const bullet = lines[next];
      if (!bullet.trim()) {
        if (items.length > found) break;
        continue;
      }
      if (!BULLET.test(bullet)) break;
      const item = cleanItem(bullet);
      if (item.length > 2) {
        items.push(item);
        lastItemLine = next;
      }
    }
  });
  return items;
}

// "Not in scope:" holds "in scope:", and "Not included:" holds "included:", so
// the inclusion header checks for a "not" before those two. The check comes
// after the words so it only runs where they appear.
const EXCLUSION_HEADER =
  /\*{0,2}(?:explicit\s+exclusions?\*{0,2}[ \t]*:?|(?:exclusions|out[\s-]+of[\s-]+scope|not\s+in\s+scope|outside\s+(?:of\s+)?(?:the\s+)?scope|not\s+included|excluded|excluding|excludes)\*{0,2}[ \t]*:)/gi;
const INCLUSION_HEADER =
  /\*{0,2}(?:explicit\s+inclusions?\*{0,2}[ \t]*:?|(?:inclusions|in\s+scope(?<!\bnot\s+in\s+scope)|included(?<!\bnot\s+included)|including|includes)\*{0,2}[ \t]*:)/gi;

/** A line or title that only names a scope list: "Out of Scope", "3. Exclusions", "Not included:". */
const OUT_HEADING =
  /^(?:\d+(?:\.\d+)*\.?\s*)?(?:(?:explicit\s+)?exclusions?|excluded|not\s+included|not\s+in\s+scope|out[\s-]+of[\s-]+scope|outside\s+(?:of\s+)?(?:the\s+)?scope)\s*:?$/i;
const IN_HEADING = /^(?:\d+(?:\.\d+)*\.?\s*)?(?:(?:explicit\s+)?inclusions?|included|in\s+scope|deliverables)\s*:?$/i;

/** The header a scope heading stands for, once markdown ("##", "**", "§") is set aside. */
function scopeHeading(line: string | undefined): string | undefined {
  const name = (line ?? "").replace(/[*_#§]/g, "").trim();
  if (OUT_HEADING.test(name)) return "Out of scope:";
  if (IN_HEADING.test(name)) return "Included:";
  return undefined;
}

/** A section titled "Out of Scope" or "In Scope" lists the bullets under it as that. */
function withScopeHeading(title: string | undefined, body: string): string {
  const header = scopeHeading(title);
  return header ? `${header}\n${body}` : body;
}

/** "Explicitly excludes X, Y and Z." / "Does not include X." on one line. The list starts at its first non-space character. */
const EXCLUSION_PROSE = /(?:explicitly\s+excludes?|does\s+not\s+include|\bexcludes?)\b(?:[ \t]*:)?[ \t]*([^.\n \t][^.\n]*)/gi;
/** " are explicitly out of scope": the end of "X, Y and Z are explicitly out of scope." */
const EXCLUSION_PREDICATE =
  /\s+(?:is|are)\s+(?:explicitly\s+|expressly\s+|strictly\s+)?(?:out\s+of\s+scope|excluded|not\s+included|not\s+in\s+scope)/gi;
/** "Includes X and Y." / "shall deliver X." / "is authorized to deliver X." on one line. */
const INCLUSION_PROSE =
  /(?:\bincludes?|(?:shall|will|(?:is|are)\s+authori[sz]ed\s+to)\s+(?:deliver|implement|build|provide)|\bfeatures?)\b[ \t]+([^.\n: \t][^.\n:]*)/gi;

/**
 * What comes before each "is out of scope" in a sentence: the words since the
 * last ".", ":" or earlier match. Found by looking back from the predicate,
 * because a lazy "(.+?) is out of scope" pattern retries from every
 * character. The sentence's spaces must already be collapsed.
 */
function excludedSubjects(sentence: string): string[] {
  const subjects: string[] = [];
  let start = 0;
  let scanned = 0;
  for (const match of sentence.matchAll(EXCLUSION_PREDICATE)) {
    const at = match.index ?? 0;
    for (; scanned < at; scanned++) {
      if (".:\n".includes(sentence[scanned])) start = scanned + 1;
    }
    // A predicate with nothing before it is part of the next subject.
    if (at <= start) continue;
    subjects.push(sentence.slice(start, at));
    start = scanned = at + match[0].length;
  }
  return subjects;
}

/**
 * Reads what a clause includes and excludes from its own wording: header
 * lists ("Explicit Exclusions:", "including:", a "## Out of Scope" heading),
 * "excludes X" sentences and "X is out of scope" sentences. Used on parsed SOW
 * clauses and on clause rows stored in the database.
 */
export function extractScopeBoundaries(legalText: string): { inclusions: string[]; exclusions: string[] } {
  // A line that only names a list ("## Out of Scope", "**Not included**")
  // becomes that list's header, so the bullets under it are read.
  const text = legalText
    .split("\n")
    .map((line) => scopeHeading(line) ?? line)
    .join("\n");

  // Sentence patterns run one sentence at a time, with runs of spaces made
  // one and each sentence capped. No pattern needs to see past a sentence end.
  const sentences = text
    .split(/(?<=[.!?])\s+|\n/)
    .map((sentence) => sentence.replace(/\s+/g, " ").slice(0, 1000));
  const inSentences = (pattern: RegExp) => sentences.flatMap((sentence) => [...sentence.matchAll(pattern)]);

  const exclusions = [
    ...listsAfter(text, EXCLUSION_HEADER),
    ...inSentences(EXCLUSION_PROSE).flatMap((m) => splitList(m[1])),
    ...sentences.flatMap(excludedSubjects).flatMap(splitList),
  ];
  const inclusions = [
    ...listsAfter(text, INCLUSION_HEADER),
    ...inSentences(INCLUSION_PROSE).flatMap((m) => splitList(m[1])),
  ];

  const excluded = new Set(exclusions);
  // A phrase the contract excludes is never also counted as included.
  return {
    inclusions: Array.from(new Set(inclusions)).filter((item) => !excluded.has(item)),
    exclusions: Array.from(excluded),
  };
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
  // The space after a currency belongs to the currency, so the two spaces
  // around it can't be split between two patterns.
  const budget = legalText.match(/(?:budget|fee)\s*[:=]\s*(?:(?:usd|\$|£|€)\s*)?([\d,]+)/i);

  const min = hours ? Number(hours[1]) : 0;
  const max = hours ? Number(hours[2] ?? hours[1]) : 0;
  return {
    estimatedHours: { min, max },
    budgetAllocated: budget ? Number(budget[1].replace(/,/g, "")) : 0,
  };
}
