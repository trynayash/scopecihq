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
   * files. Their titles and files then count as descriptions: "bump saml
   * library" or `docs/gift-cards.md` is worth a review, but nothing new was
   * built.
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
 * contract boilerplate. They are dropped from SOW phrases, so "Tenant roles
 * module" is matched on "tenant" and "roles". A phrase made only of them,
 * such as "Data migration", is matched as a whole phrase instead.
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

/**
 * Generic words that carry an exclusion's meaning: excluding "Multi-currency
 * pricing" or "Advanced search" leaves single-currency pricing and basic
 * search in scope. Exclusions keep them as words that must be found;
 * inclusions drop them like any other generic word.
 */
const QUALIFIERS = new Set([
  "multi", "single", "advanced", "basic", "custom", "standard", "full", "granular", "enterprise", "simple",
]);

/** Words that only pad a phrase, as in "multi-user support". */
const FILLER = new Set(["support", "supported", "functionality", "feature", "features"]);

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
  // Own keys only: "constructor" in a pull request is a word, not a key of
  // Object.prototype.
  let w = Object.hasOwn(ABBREVIATIONS, word) ? ABBREVIATIONS[word] : word;
  if (Object.hasOwn(IRREGULAR, w)) return IRREGULAR[w];
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
    // "XMLParser" -> "XML Parser". A lookahead, so a long run of capitals
    // is split in one pass instead of being backtracked over.
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ")
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

/**
 * Adjacent word pairs of prose, such as "data migr" for "Data migration:
 * import". Punctuation and "and"/"or" end a run, so "user data, migration
 * notes" holds no "data migr". Used to find phrases of generic words in
 * titles and descriptions.
 */
function wordPairs(text: string): Set<string> {
  const pairs = new Set<string>();
  for (const run of text.split(/[.,;:!?()[\]{}"|\n]+/)) {
    let previous: string | undefined;
    for (const chunk of run.split(/[^A-Za-z0-9_-]+/)) {
      for (const word of splitWords(chunk)) {
        if (word === "and" || word === "or") {
          previous = undefined;
          continue;
        }
        if (STOPWORDS.has(word)) continue;
        const stem = stemWord(word);
        if (previous) pairs.add(`${previous} ${stem}`);
        previous = stem;
      }
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------ */
/* Contract phrases                                                    */
/* ------------------------------------------------------------------ */

/** One word of a contract phrase. It is found when every token of any one form is present. */
interface Term {
  forms: string[][];
  /** Made only of qualifiers ("custom"): never enough on its own. */
  qualifier?: boolean;
  /**
   * A phrase of generic words ("data migration"), found only inside one
   * document: as one word in a path or branch (`data-migration`,
   * `dataMigration`), or as adjacent words in a title or description.
   */
  phrase?: { words: string[]; pairs: string[] };
}

/**
 * Terms of one phrase part. A hyphenated word with a short or stop-word part,
 * such as "sign-on", only matches as a whole ("signon"), so "sign-in" code
 * can't satisfy an exclusion of single sign-on.
 */
function termsOf(part: string, kind: ContractPhraseMatch["kind"]): Term[] {
  const generic = (word: string) => GENERIC.has(word) && !(kind === "exclusion" && QUALIFIERS.has(word));
  const terms: Term[] = [];
  for (const chunk of part.split(/[^A-Za-z0-9_-]+/)) {
    const words = splitWords(chunk);
    if (words.length === 0) continue;

    if (words.length === 1) {
      const [word] = words;
      if (STOPWORDS.has(word) || generic(word) || word.length < 3) continue;
      terms.push({ forms: [[stemWord(word)]], qualifier: QUALIFIERS.has(word) });
      continue;
    }

    const content = words.filter((word) => !generic(word));
    if (content.length === 0) continue;
    const compact = words.map(stemWord).join("");
    const binding = content.some((word) => STOPWORDS.has(word) || word.length < 3);
    terms.push({
      forms: binding ? [[compact]] : [[compact], content.map(stemWord)],
      qualifier: content.every((word) => QUALIFIERS.has(word)),
    });
  }
  if (!terms.every((term) => term.qualifier)) return terms;

  // Nothing but generic words and qualifiers: "Data migration", "Custom
  // integrations". Only the words together mean something, so they are
  // matched as one phrase. A single such word ("Integrations") is too broad
  // to check at all.
  const words = splitWords(part.replace(/[^A-Za-z0-9_-]+/g, " "))
    .filter((word) => !STOPWORDS.has(word) && !FILLER.has(word) && word.length >= 3)
    .map(stemWord);
  if (words.length < 2) return [];
  return [
    {
      forms: [[words.join("")]],
      phrase: { words, pairs: words.slice(1).map((word, i) => `${words[i]} ${word}`) },
    },
  ];
}

/** A term found when any word of `text` is. */
function anyWordOf(text: string): Term | undefined {
  const tokens = [...tokenize(text)].filter((token) => token.length >= 3);
  return tokens.length > 0 ? { forms: tokens.map((token) => [token]) } : undefined;
}

/** Whether one names the other by its initials: "single sign-on" and "sso", "rbac" and "role-based access control". */
function abbreviates(head: string, example: string): boolean {
  const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const initials = (words: string[]) => words.map((word) => word[0]).join("");
  const headWords = wordsOf(head);
  const exampleWords = wordsOf(example);
  if (exampleWords.length === 1) {
    const [short] = exampleWords;
    return short.length >= 2 && initials(headWords).endsWith(short);
  }
  return headWords.includes(initials(exampleWords));
}

/** One part of an SOW item, with what it needs around it. */
interface PhrasePart {
  text: string;
  /** For a bracketed example, any word of what it is an example of. */
  head?: Term;
  /** What the item says it leaves out ("other than Stripe"), one term list each. */
  except: Term[][];
  /** The same text, head and exceptions match the same way, so a match is worked out once. */
  key: string;
}

/**
 * "Payment providers other than Stripe": what follows the marker is not part
 * of the item. Exported so the SOW parser can keep such an item whole.
 */
export const EXCEPTION_MARKER = /\b(?:other\s+than|except(?:\s+for)?|besides|apart\s+from|aside\s+from|but\s+not)\b/i;
const LIST_SEPARATOR = /[,;/&]|\s+(?:and|or)\s+/i;

function listItems(text: string): string[] {
  return text
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * "Team invitations and enterprise member provisioning" -> two parts.
 * "Social login (Google, Facebook)" -> "social login", and "google" and
 * "facebook", each of which also needs "social" or "login" next to it.
 */
function partsOf(phrase: string): PhrasePart[] {
  const [kept, ...exceptions] = phrase.replace(/\u0000/g, " ").split(EXCEPTION_MARKER);
  const exceptionItems = exceptions.flatMap(listItems);
  const except = exceptionItems.map((item) => termsOf(item, "inclusion")).filter((terms) => terms.length > 0);
  const part = (text: string, head?: string): PhrasePart => ({
    text,
    head: head ? anyWordOf(head) : undefined,
    except,
    key: [text, head ?? "", ...exceptionItems].join("\u0001"),
  });

  // Brackets come out first, so a list inside them doesn't split the item around them.
  const brackets: string[] = [];
  const flat = kept.replace(/\(([^)]*)\)?/g, (_, inner: string) => `\u0000${brackets.push(inner) - 1}\u0000`);
  const parts: PhrasePart[] = [];
  for (const piece of listItems(flat)) {
    const head = piece.replace(/\u0000\d+\u0000/g, " ").trim();
    if (head) parts.push(part(head));
    for (const [, index] of piece.matchAll(/\u0000(\d+)\u0000/g)) {
      const examples = listItems(brackets[Number(index)] ?? "");
      // "Single sign-on (SSO)": another name for the head, which counts on its own.
      if (examples.length === 1 && head && abbreviates(head, examples[0])) {
        parts.push(part(examples[0]));
        continue;
      }
      // "Social login (Google, Facebook)": examples count only next to a word of their head.
      for (const text of examples) parts.push(part(text, head || undefined));
    }
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/* Pull request evidence                                               */
/* ------------------------------------------------------------------ */

interface EvidenceDoc extends PhraseEvidence {
  tokens: Set<string>;
  /** Adjacent word pairs, for titles and descriptions. */
  pairs?: Set<string>;
}

/** Documents read together, with every token they hold. */
interface Scope {
  tokens: Set<string>;
  /** The titles and descriptions among them. */
  prose: EvidenceDoc[];
}

interface Evidence {
  docs: EvidenceDoc[];
  strongDocs: EvidenceDoc[];
  /** Everything the pull request and its issue say. */
  all: Scope;
  /** Only what was built or named in a title. */
  strong: Scope;
  /**
   * Where a strong exclusion's words have to be found together: each changed
   * file on its own, and the titles and branch read as one.
   */
  groups: Scope[];
  /** The groups holding each token, so a part is only compared with groups that hold its words. */
  groupsOf: Map<string, Set<number>>;
  /** The groups each term was found in, worked out once per term. */
  termGroups: Map<string, number[]>;
  /** Per group, how many of the current part's terms it holds; all zero between parts. */
  counts: Int32Array;
}

/** "Revert …", "Removes …", "chore(cart): drop …": the pull request takes work out. */
const REMOVAL =
  /^\s*(?:[a-z]+(?:\([^)]*\))?!?:\s*)?(?:revert(?:s|ed)?|remov(?:e|es|ed)|delet(?:e|es|ed)|drop(?:s|ped)?)(?![\w-])/i;

function buildDocs(pullRequest: PullRequest, issue: LinearIssue | undefined, maintenanceOnly: boolean): EvidenceDoc[] {
  const docs: EvidenceDoc[] = [];
  // Tests, docs, dependencies and build files build nothing new, so nothing
  // in such a pull request is strong evidence. One that removes or reverts
  // work names that work in its title without building it: its titles count
  // as descriptions, and only the files it adds or changes can show it.
  const removing = REMOVAL.test(pullRequest.title ?? "");
  const titleStrength: EvidenceStrength = maintenanceOnly || removing ? "text" : "title";
  const pathStrength: EvidenceStrength = maintenanceOnly ? "text" : "code";
  const add = (
    location: string,
    text: string | undefined,
    strength: EvidenceStrength,
    sourceQuality: EvidenceSourceQuality,
    prose = false,
  ) => {
    if (!text || !text.trim()) return;
    docs.push({ location, strength, sourceQuality, tokens: tokenize(text), ...(prose ? { pairs: wordPairs(text) } : {}) });
  };

  // Deleted files are work being removed, not built.
  for (const file of pullRequest.changedFiles) {
    if (file.status !== "deleted") add(file.path, file.path, pathStrength, "GITHUB_DIFF");
  }
  if (pullRequest.detectedSubsystems?.length) {
    add("diff subsystems", pullRequest.detectedSubsystems.join(" "), pathStrength, "GITHUB_DIFF");
  }
  add(`PR #${pullRequest.number} title`, pullRequest.title, titleStrength, "GITHUB_PR", true);
  const branch = pullRequest.branch ?? pullRequest.headBranch;
  add(`branch ${branch}`, branch, titleStrength, "GITHUB_PR");
  add(`PR #${pullRequest.number} description`, pullRequest.body, "text", "GITHUB_PR", true);

  if (issue) {
    add(`${issue.id} title`, issue.title, titleStrength, "LINEAR_ISSUE", true);
    add(`${issue.id} description`, issue.description, "text", "LINEAR_ISSUE", true);
    add(`${issue.id} labels`, issue.labels?.join(", "), "text", "LINEAR_ISSUE", true);
  }
  return docs;
}

function scopeOf(docs: EvidenceDoc[]): Scope {
  const tokens = docs.length === 1 ? docs[0].tokens : new Set(docs.flatMap((doc) => [...doc.tokens]));
  return { tokens, prose: docs.filter((doc) => doc.pairs) };
}

/** The pull request's documents and the token sets every SOW part is checked against, built once. */
function gatherEvidence(pullRequest: PullRequest, issue: LinearIssue | undefined, maintenanceOnly: boolean): Evidence {
  const docs = buildDocs(pullRequest, issue, maintenanceOnly);
  const strongDocs = docs.filter((doc) => doc.strength !== "text");
  const named = strongDocs.filter((doc) => doc.strength === "title");
  const groups = [
    ...strongDocs.filter((doc) => doc.strength === "code").map((doc) => scopeOf([doc])),
    ...(named.length > 0 ? [scopeOf(named)] : []),
  ];
  const groupsOf = new Map<string, Set<number>>();
  groups.forEach((group, index) => {
    for (const token of group.tokens) {
      let holding = groupsOf.get(token);
      if (!holding) groupsOf.set(token, (holding = new Set()));
      holding.add(index);
    }
  });
  return {
    docs,
    strongDocs,
    all: scopeOf(docs),
    strong: scopeOf(strongDocs),
    groups,
    groupsOf,
    termGroups: new Map(),
    counts: new Int32Array(groups.length),
  };
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

/** A phrase of generic words in one document: one word anywhere, or adjacent words in prose. */
function phraseIn(term: Term, doc: EvidenceDoc): boolean {
  const { phrase } = term;
  if (!phrase) return false;
  return doc.tokens.has(term.forms[0][0]) || (doc.pairs !== undefined && phrase.pairs.every((pair) => doc.pairs!.has(pair)));
}

/** The tokens a term was found by in a scope, if it was. */
function termIn(term: Term, scope: Scope): string[] | undefined {
  const { phrase } = term;
  if (!phrase) return satisfiedForm(term, scope.tokens);
  const [compact] = term.forms[0];
  // Never across documents: each prose document is checked on its own.
  const found = scope.tokens.has(compact) || scope.prose.some((doc) => phraseIn(term, doc));
  return found ? [compact, ...phrase.words] : undefined;
}

const NO_GROUPS: ReadonlySet<number> = new Set();

/** The groups that hold a term, worked out from the token index rather than group by group. */
function groupsHolding(term: Term, evidence: Evidence): number[] {
  const key = `${term.phrase ? "phrase:" : ""}${term.forms.map((form) => form.join(" ")).join("|")}`;
  const known = evidence.termGroups.get(key);
  if (known) return known;
  const holding = new Set<number>();
  for (const form of term.forms) {
    const [fewest, ...rest] = form
      .map((token) => evidence.groupsOf.get(token) ?? NO_GROUPS)
      .sort((a, b) => a.size - b.size);
    for (const group of fewest) if (rest.every((groups) => groups.has(group))) holding.add(group);
  }
  if (term.phrase) {
    evidence.groups.forEach((group, index) => {
      if (group.prose.some((doc) => phraseIn(term, doc))) holding.add(index);
    });
  }
  const found = [...holding];
  evidence.termGroups.set(key, found);
  return found;
}

/**
 * The group holding the most of a part's terms, if one holds enough and
 * fits: counted from each term's groups, so only groups that hold some of
 * the words are looked at.
 */
function bestGroup(
  terms: Term[],
  compactPart: string | undefined,
  required: number,
  fits: (group: Scope) => boolean,
  evidence: Evidence,
): Scope | undefined {
  const { counts } = evidence;
  const touched: number[] = [];
  const count = (groups: Iterable<number>, to?: number) => {
    for (const group of groups) {
      if (counts[group] === 0) touched.push(group);
      counts[group] = to ?? counts[group] + 1;
    }
  };
  for (const term of terms) count(groupsHolding(term, evidence));
  // A group holding `giftcards` holds every word of "gift cards".
  if (compactPart) count(evidence.groupsOf.get(compactPart) ?? NO_GROUPS, terms.length);

  let best: number | undefined;
  for (const group of touched) {
    if (counts[group] < required || !fits(evidence.groups[group])) continue;
    const lead = best === undefined ? 0 : counts[best];
    if (counts[group] > lead || (counts[group] === lead && best !== undefined && group < best)) best = group;
  }
  for (const group of touched) counts[group] = 0;
  return best === undefined ? undefined : evidence.groups[best];
}

interface Found {
  term: Term;
  form: string[];
}

/** A part's match before its evidence is listed, which only happens for the best part of an item. */
interface PartMatch {
  part: string;
  found: Found[];
  coverage: number;
  strong: boolean;
}

function matchPart(kind: ContractPhraseMatch["kind"], part: PhrasePart, evidence: Evidence): PartMatch | undefined {
  const terms = termsOf(part.text, kind);
  if (terms.length === 0) return undefined;
  const required = requiredTerms(kind, terms.length);

  // "gift cards" also matches a single `giftcards` directory. The separate
  // words are kept alongside, so a change order that says "gift cards" can
  // still be compared with the match.
  const compactPart = terms.length > 1 ? terms.map((term) => term.forms[0].join("")).join("") : undefined;
  const find = (scope: Scope): Found[] =>
    terms.flatMap((term): Found[] => {
      if (compactPart && scope.tokens.has(compactPart)) return [{ term, form: [...term.forms[0], compactPart] }];
      const form = termIn(term, scope);
      return form ? [{ term, form }] : [];
    });
  // A bracketed example counts only next to a word of its head: "facebook"
  // in "social login (google, facebook)" also needs "social" or "login".
  const headIn = (scope: Scope): Found[] | undefined => {
    if (!part.head) return [];
    const form = termIn(part.head, scope);
    return form ? [{ term: part.head, form }] : undefined;
  };
  // Evidence that names an exception ("other than Stripe") is about the exception.
  const namesException = (scope: Scope) => part.except.some((exception) => exception.every((term) => termIn(term, scope)));
  const result = (found: Found[], head: Found[], strong: boolean): PartMatch => ({
    part: part.text,
    found: [...found, ...head],
    coverage: Math.min(1, found.length / terms.length),
    strong,
  });

  const foundAll = find(evidence.all);
  const headAll = headIn(evidence.all);
  if (foundAll.length < required || !headAll) return undefined;
  const foundStrong = find(evidence.strong);

  if (kind === "inclusion") {
    if (foundStrong.length === 0 || namesException(evidence.strong)) return undefined;
    return result(foundAll, headAll, foundStrong.length >= required);
  }

  // An exclusion turns into a change order, so its words have to be found
  // together: in one changed file, or in the titles and branch. Words spread
  // over unrelated files ("gift-wrap.tsx" and "card-payment-form.tsx") are
  // only a question for a person.
  if (foundStrong.length >= required) {
    const fits = (group: Scope) => headIn(group) !== undefined && !namesException(group);
    const group = bestGroup(terms, compactPart, required, fits, evidence);
    if (group) return result(find(group), headIn(group) ?? [], true);
  }
  if (namesException(evidence.all)) return undefined;
  return result(foundAll, headAll, false);
}

/** Prefers strong over weak, then the better-covered part. */
function better(a: PartMatch | undefined, b: PartMatch): PartMatch {
  if (!a) return b;
  if (a.strong !== b.strong) return a.strong ? a : b;
  return b.coverage > a.coverage ? b : a;
}

/** The documents a match was made on, best first. */
function evidenceOf(match: PartMatch, evidence: Evidence): PhraseEvidence[] {
  const tokens = [...new Set(match.found.filter(({ term }) => !term.phrase).flatMap(({ form }) => form))];
  const phrases = match.found.filter(({ term }) => term.phrase).map(({ term }) => term);
  return (match.strong ? evidence.strongDocs : evidence.docs)
    .filter((doc) => tokens.some((token) => doc.tokens.has(token)) || phrases.some((term) => phraseIn(term, doc)))
    .sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength])
    .map(({ location, strength, sourceQuality }) => ({ location, strength, sourceQuality }));
}

/**
 * Returns at most one match per SOW item: the best-matching part of each
 * inclusion and exclusion phrase on every clause of the baseline.
 */
export function matchContractPhrases(input: ContractMatchInput): ContractPhraseMatch[] {
  // Built once: every part of every SOW item is checked against the same sets.
  const evidence = gatherEvidence(input.pullRequest, input.issue, input.maintenanceOnly ?? false);
  const matches: ContractPhraseMatch[] = [];
  // Parts repeated across items and clauses are matched once.
  const known = new Map<string, PartMatch | undefined>();

  for (const clause of input.baseline.clauses) {
    for (const [kind, phrases] of [
      ["exclusion", clause.exclusions],
      ["inclusion", clause.inclusions],
    ] as const) {
      for (const phrase of phrases) {
        let best: PartMatch | undefined;
        for (const part of partsOf(phrase)) {
          const key = `${kind}\u0001${part.key}`;
          const match = known.has(key) ? known.get(key) : matchPart(kind, part, evidence);
          known.set(key, match);
          if (match) best = better(best, match);
        }
        if (!best) continue;
        matches.push({
          clause,
          kind,
          phrase,
          matchedPart: best.part,
          matchedTerms: [...new Set(best.found.flatMap(({ form }) => form))],
          coverage: best.coverage,
          strong: best.strong,
          // Listed once per item, for the part it is reported by.
          evidence: evidenceOf(best, evidence),
        });
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
  return namesHalf(tokenize(phrase), capabilityName);
}

/** The content words of a capability name: "team_invitations" -> team, invit. */
function capabilityNameWords(capabilityName: string): string[] {
  return splitWords(capabilityName)
    .filter((word) => !STOPWORDS.has(word) && !GENERIC.has(word))
    .map(stemWord);
}

function namesHalf(phraseTokens: Set<string>, capabilityName: string): boolean {
  const words = capabilityNameWords(capabilityName);
  if (words.length === 0) return false;
  const named = words.filter((word) => phraseTokens.has(word)).length;
  return named >= Math.ceil(words.length / 2);
}

/**
 * Words each built-in capability is detected by (see CapabilityExtractor),
 * with the qualifiers that are part of what it is: organization RBAC is
 * multi-tenant, SSO is enterprise single sign-on.
 */
const CAPABILITY_WORDS: Record<string, string> = {
  organization_rbac: "organization rbac roles permissions membership tenant tenancy access control multi",
  team_invitations: "team invitations invite member teammates",
  password_reset: "password reset forgot",
  enterprise_sso_saml: "enterprise single sso saml okta federation federated scim signon",
  authentication: "authentication login logout password session signin signout",
  audit_logging: "audit activity logging",
  export_utility: "export csv download",
};

export interface CapabilityNames {
  /**
   * Whether some part of an SOW item is made only of words the capability is
   * known by. "SAML-based single sign-on" names enterprise_sso_saml;
   * "two-factor authentication" doesn't name authentication, and "invitations
   * via SMS" doesn't name team_invitations: those exclude a narrower thing,
   * which the phrase matcher checks on its own words.
   */
  item(kind: ContractPhraseMatch["kind"], phrase: string, capabilityName: string): boolean;
  /**
   * Whether every word of the capability's name is in the phrase: "Audit
   * Logging" names audit_logging, "Team Dashboard" doesn't name
   * team_invitations. For deliverable titles and keywords.
   */
  wholly(phrase: string, capabilityName: string): boolean;
  /** At least half of the capability's words, as phraseNamesCapability. */
  partly(phrase: string, capabilityName: string): boolean;
}

/**
 * Compares SOW wording with capability names, remembering each phrase's
 * words, so a large scope is read once per evaluation rather than once per
 * capability.
 */
export function capabilityNames(): CapabilityNames {
  const tokens = new Map<string, Set<string>>();
  const tokensOf = (phrase: string) => {
    let found = tokens.get(phrase);
    if (!found) tokens.set(phrase, (found = tokenize(phrase)));
    return found;
  };
  const items = new Map<string, Term[][]>();
  const termsOfItem = (kind: ContractPhraseMatch["kind"], phrase: string) => {
    const key = `${kind}:${phrase}`;
    let found = items.get(key);
    if (!found) {
      found = partsOf(phrase).flatMap((part) => {
        const own = termsOf(part.text, kind);
        if (own.length === 0) return [];
        return [part.head ? [...own, part.head] : own];
      });
      items.set(key, found);
    }
    return found;
  };
  const vocabularyOf = (capabilityName: string) =>
    tokensOf([capabilityName, Object.hasOwn(CAPABILITY_WORDS, capabilityName) ? CAPABILITY_WORDS[capabilityName] : ""].join(" "));

  return {
    item(kind, phrase, capabilityName) {
      const vocabulary = vocabularyOf(capabilityName);
      return termsOfItem(kind, phrase).some((terms) => terms.every((term) => satisfiedForm(term, vocabulary)));
    },
    wholly(phrase, capabilityName) {
      const words = capabilityNameWords(capabilityName).filter((word) => word !== "utility");
      const phraseTokens = tokensOf(phrase);
      return words.length > 0 && words.every((word) => phraseTokens.has(word));
    },
    partly(phrase, capabilityName) {
      return namesHalf(tokensOf(phrase), capabilityName);
    },
  };
}
