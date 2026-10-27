import type {
  ContractClause,
  EvidenceSourceQuality,
  LinearIssue,
  PullRequest,
  ScopeBaseline,
} from "./types.js";

/**
 * Contract Phrase Matcher.
 *
 * The CapabilityExtractor only knows a handful of capability names, so on its
 * own it cannot see that `src/giftcards/redeem.ts` builds the "Gift cards" a
 * statement of work excludes. This module compares the SOW's own inclusion and
 * exclusion phrases with words taken from the pull request and its linked
 * issue, so whatever wording a contract uses can be matched.
 *
 * It is deliberately literal: words are split, normalised and lightly stemmed,
 * never interpreted. Where a word was found matters as much as whether it was:
 * changed file paths and titles say what was built ("code" and "title"
 * evidence), while descriptions only say what was talked about ("text").
 */

export type EvidenceStrength = "code" | "title" | "text";

export interface PhraseEvidence {
  location: string;
  strength: EvidenceStrength;
  sourceQuality: EvidenceSourceQuality;
}

export interface ContractPhraseMatch {
  clause: ContractClause;
  kind: "inclusion" | "exclusion";
  /** The SOW item as recorded on the clause, e.g. "team invitations and enterprise member provisioning". */
  phrase: string;
  /** The part of that item that matched, e.g. "team invitations". */
  matchedPart: string;
  /** Normalised words of the part that were found. */
  matchedTerms: string[];
  /** Share of the part's words that were found, 0 to 1. */
  coverage: number;
  /** Found in changed files or titles, not only in descriptions. */
  strong: boolean;
  evidence: PhraseEvidence[];
}

export interface ContractMatchInput {
  baseline: ScopeBaseline;
  pullRequest: PullRequest;
  issue?: LinearIssue;
  /**
   * Set for pull requests that only touch tests, docs, dependencies or build
   * files. Their titles then count as descriptions: "bump saml library" is
   * worth a review, but nothing new was built.
   */
  maintenanceOnly?: boolean;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "its", "of", "on", "or", "out", "the", "this", "that", "to", "via", "with", "without",
  "only", "not", "no", "per", "than", "then", "will", "shall", "must", "may", "can",
]);

/**
 * Words that never decide scope on their own: code layout, commit verbs and
 * contract boilerplate. They are dropped from SOW phrases, so "Custom tenant
 * roles" is matched on "tenant" and "roles".
 */
const GENERIC = new Set([
  // code layout
  "src", "lib", "libs", "app", "apps", "api", "index", "main", "test", "tests", "spec",
  "specs", "util", "utils", "helper", "helpers", "common", "core", "shared", "component",
  "components", "page", "pages", "view", "views", "route", "routes", "controller",
  "controllers", "service", "services", "model", "models", "type", "types", "config",
  "configs", "db", "schema", "schemas", "migration", "migrations", "middleware", "public",
  "static", "asset", "assets", "style", "styles", "script", "scripts", "doc", "docs",
  "readme", "package", "lock", "json", "yaml", "yml", "ts", "tsx", "js", "jsx", "mjs",
  "sql", "md", "css", "scss", "html", "py", "rb", "go", "java", "kt", "swift",
  // commit verbs
  "feat", "fix", "fixes", "chore", "refactor", "perf", "add", "adds", "added", "update",
  "updates", "updated", "implement", "implements", "implementation", "new", "make",
  "create", "change", "changes", "improve", "wip",
  // contract boilerplate
  "support", "supported", "custom", "basic", "standard", "advanced", "full", "granular",
  "simple", "general", "system", "systems", "module", "modules", "subsystem", "feature",
  "features", "functionality", "integration", "integrations", "management", "workflow",
  "workflows", "flow", "flows", "user", "users", "data", "level", "multi", "enterprise",
  "single", "end", "based", "any", "all", "other", "such", "including", "include",
  "includes", "excluding", "exclude", "excludes", "explicit", "explicitly", "scope",
  "delivery", "deliver", "deliverable", "work", "client", "agency", "provider", "project",
  "phase", "milestone", "anything", "everything", "else", "listed", "above", "below",
  "here", "following", "item", "items", "exclusion", "exclusions", "inclusion", "inclusions",
]);

/** Short forms developers use in paths and branch names. */
const ABBREVIATIONS: Record<string, string> = {
  org: "organization",
  orgs: "organization",
  auth: "authentication",
  perm: "permission",
  perms: "permission",
  i18n: "internationalization",
  l10n: "localization",
};

const IRREGULAR: Record<string, string> = {
  matrices: "matrix",
  indices: "index",
  indexes: "index",
  children: "child",
  people: "person",
  programme: "program",
  programmes: "program",
  catalogue: "catalog",
  catalogues: "catalog",
};

/**
 * Light suffix stripping, applied identically to contract and code words, so
 * "invitations", "invite" and "invites" all become "invit". Consistency
 * matters more here than linguistic correctness.
 */
export function stemWord(word: string): string {
  let w = ABBREVIATIONS[word] ?? word;
  if (IRREGULAR[w]) return IRREGULAR[w];
  w = w.replace(/isation/g, "ization");

  const strip = (suffix: string, replacement = ""): boolean => {
    if (!w.endsWith(suffix) || w.length - suffix.length < 3) return false;
    w = w.slice(0, -suffix.length) + replacement;
    return true;
  };

  if (strip("ies", "y")) {
    // categories -> category
  } else if (strip("ations") || strip("ation") || strip("ings") || strip("ing") || strip("ed")) {
    // invitations -> invit, pricing -> pric, added -> add
  } else if (/(ss|x|z|ch|sh)es$/.test(w)) {
    strip("es");
  } else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) {
    strip("s");
  }

  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Splits camelCase, PascalCase, hyphens and underscores; lowercases. */
function splitWords(chunk: string): string[] {
  return chunk
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((part) => part.length > 0 && !/^\d+$/.test(part));
}

/**
 * Normalised tokens for a path, title or description. A compound such as
 * `gift-cards` or `giftCards` yields its parts and also the joined form, so it
 * matches a contract that writes "giftcards" or "gift cards".
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const chunk of text.split(/[^A-Za-z0-9_-]+/)) {
    const parts = splitWords(chunk);
    if (parts.length === 0) continue;
    for (const part of parts) {
      if (!STOPWORDS.has(part)) tokens.add(stemWord(part));
    }
    if (parts.length > 1) tokens.add(parts.map(stemWord).join(""));
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Contract phrases                                                    */
/* ------------------------------------------------------------------ */

/** One word of a contract phrase. It is found when every token of any one form is present. */
interface Term {
  forms: string[][];
}

/**
 * Terms of one phrase part. A hyphenated word with a short or stop-word part,
 * such as "sign-on", only matches as a whole ("signon"), so "sign-in" code
 * can't satisfy an exclusion of single sign-on.
 */
function termsOf(part: string): Term[] {
  const terms: Term[] = [];
  for (const chunk of part.split(/[^A-Za-z0-9_-]+/)) {
    const words = splitWords(chunk);
    if (words.length === 0) continue;

    if (words.length === 1) {
      const [word] = words;
      if (STOPWORDS.has(word) || GENERIC.has(word) || word.length < 3) continue;
      terms.push({ forms: [[stemWord(word)]] });
      continue;
    }

    const content = words.filter((word) => !GENERIC.has(word));
    if (content.length === 0) continue;
    const compact = words.map(stemWord).join("");
    const binding = content.some((word) => STOPWORDS.has(word) || word.length < 3);
    terms.push({ forms: binding ? [[compact]] : [[compact], content.map(stemWord)] });
  }
  return terms;
}

/** "Team invitations and enterprise member provisioning" -> two parts. */
function partsOf(phrase: string): string[] {
  return phrase
    .split(/[,;/()&]|\s+(?:and|or)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/* ------------------------------------------------------------------ */
/* Pull request evidence                                               */
/* ------------------------------------------------------------------ */

interface EvidenceDoc extends PhraseEvidence {
  tokens: Set<string>;
}

function buildDocs(pullRequest: PullRequest, issue: LinearIssue | undefined, maintenanceOnly: boolean): EvidenceDoc[] {
  const docs: EvidenceDoc[] = [];
  const titleStrength: EvidenceStrength = maintenanceOnly ? "text" : "title";
  const add = (location: string, text: string | undefined, strength: EvidenceStrength, sourceQuality: EvidenceSourceQuality) => {
    if (text && text.trim()) docs.push({ location, strength, sourceQuality, tokens: tokenize(text) });
  };

  // Deleted files are work being removed, not built.
  for (const file of pullRequest.changedFiles) {
    if (file.status !== "deleted") add(file.path, file.path, "code", "GITHUB_DIFF");
  }
  if (pullRequest.detectedSubsystems?.length) {
    add("diff subsystems", pullRequest.detectedSubsystems.join(" "), "code", "GITHUB_DIFF");
  }
  add(`PR #${pullRequest.number} title`, pullRequest.title, titleStrength, "GITHUB_PR");
  const branch = pullRequest.branch ?? pullRequest.headBranch;
  add(`branch ${branch}`, branch, titleStrength, "GITHUB_PR");
  add(`PR #${pullRequest.number} description`, pullRequest.body, "text", "GITHUB_PR");

  if (issue) {
    add(`${issue.id} title`, issue.title, titleStrength, "LINEAR_ISSUE");
    add(`${issue.id} description`, issue.description, "text", "LINEAR_ISSUE");
    add(`${issue.id} labels`, issue.labels?.join(" "), "text", "LINEAR_ISSUE");
  }
  return docs;
}

const STRENGTH_ORDER: Record<EvidenceStrength, number> = { code: 0, title: 1, text: 2 };

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/**
 * How many of a part's terms must be found.
 * - Exclusions are strict, because a hit turns into CHANGE_REQUIRED: every
 *   term of a one- or two-word part, two thirds of a longer one.
 * - Inclusions are only positive evidence once nothing excluded was found:
 *   half the terms, at least one of them in code or a title.
 */
function requiredTerms(kind: ContractPhraseMatch["kind"], termCount: number): number {
  if (kind === "inclusion") return Math.ceil(termCount / 2);
  return termCount <= 2 ? termCount : Math.ceil((2 * termCount) / 3);
}

function satisfiedForm(term: Term, tokens: Set<string>): string[] | undefined {
  return term.forms.find((form) => form.every((token) => tokens.has(token)));
}

function matchPart(
  clause: ContractClause,
  kind: ContractPhraseMatch["kind"],
  phrase: string,
  part: string,
  docs: EvidenceDoc[],
): ContractPhraseMatch | undefined {
  const terms = termsOf(part);
  if (terms.length === 0) return undefined;

  const strongDocs = docs.filter((doc) => doc.strength !== "text");
  const union = (from: EvidenceDoc[]) => new Set(from.flatMap((doc) => [...doc.tokens]));
  const strongTokens = union(strongDocs);
  const allTokens = union(docs);

  // "gift cards" also matches a single `giftcards` directory. The separate
  // words are kept alongside, so a change order that says "gift cards" can
  // still be compared with the match.
  const compactPart = terms.map((term) => term.forms[0].join("")).join("");
  const found = (tokens: Set<string>) =>
    terms.length > 1 && tokens.has(compactPart)
      ? terms.map((term) => [...term.forms[0], compactPart])
      : terms.map((term) => satisfiedForm(term, tokens)).filter((form): form is string[] => Boolean(form));

  const foundStrong = found(strongTokens);
  const foundAll = found(allTokens);
  const required = requiredTerms(kind, terms.length);

  let strong: boolean;
  let used: string[][];
  if (kind === "inclusion") {
    if (foundAll.length < required || foundStrong.length === 0) return undefined;
    strong = foundStrong.length >= required;
    used = foundAll;
  } else if (foundStrong.length >= required) {
    strong = true;
    used = foundStrong;
  } else if (foundAll.length >= required) {
    strong = false;
    used = foundAll;
  } else {
    return undefined;
  }

  const matchedTerms = [...new Set(used.flat())];
  const evidence = (strong ? strongDocs : docs)
    .filter((doc) => matchedTerms.some((token) => doc.tokens.has(token)))
    .sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength])
    .map(({ location, strength, sourceQuality }) => ({ location, strength, sourceQuality }));

  return {
    clause,
    kind,
    phrase,
    matchedPart: part,
    matchedTerms,
    coverage: Math.min(1, used.length / terms.length),
    strong,
    evidence,
  };
}

/** Prefers strong over weak, then the better-covered part. */
function better(a: ContractPhraseMatch | undefined, b: ContractPhraseMatch): ContractPhraseMatch {
  if (!a) return b;
  if (a.strong !== b.strong) return a.strong ? a : b;
  return b.coverage > a.coverage ? b : a;
}

/**
 * Returns at most one match per SOW item: the best-matching part of each
 * inclusion and exclusion phrase on every clause of the baseline.
 */
export function matchContractPhrases(input: ContractMatchInput): ContractPhraseMatch[] {
  const docs = buildDocs(input.pullRequest, input.issue, input.maintenanceOnly ?? false);
  const matches: ContractPhraseMatch[] = [];

  for (const clause of input.baseline.clauses) {
    for (const [kind, phrases] of [
      ["exclusion", clause.exclusions],
      ["inclusion", clause.inclusions],
    ] as const) {
      for (const phrase of phrases) {
        let best: ContractPhraseMatch | undefined;
        for (const part of partsOf(phrase)) {
          const match = matchPart(clause, kind, phrase, part, docs);
          if (match) best = better(best, match);
        }
        if (best) matches.push(best);
      }
    }
  }
  return matches;
}

/**
 * Whether `text` (a change order's title, reason and authorised subsystems)
 * names at least half of the words a match was made on.
 */
export function textCoversMatch(text: string, match: ContractPhraseMatch): boolean {
  const tokens = tokenize(text);
  const named = match.matchedTerms.filter((term) => tokens.has(term)).length;
  return named >= Math.max(1, Math.ceil(match.matchedTerms.length / 2));
}

/**
 * Whether a contract phrase names a capability, e.g. "member invitations"
 * for `team_invitations`: at least half of the capability's words appear in
 * the phrase. Only used to recognise included work; exclusions keep their
 * stricter matching.
 */
export function phraseNamesCapability(phrase: string, capabilityName: string): boolean {
  const phraseTokens = tokenize(phrase);
  const words = splitWords(capabilityName)
    .filter((word) => !STOPWORDS.has(word) && !GENERIC.has(word))
    .map(stemWord);
  if (words.length === 0) return false;
  const named = words.filter((word) => phraseTokens.has(word)).length;
  return named >= Math.ceil(words.length / 2);
}
