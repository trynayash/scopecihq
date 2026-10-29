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
  /**
   * A weak exclusion match on a bracketed example without what it is an
   * example of: "paypal" for "additional payment providers (paypal, klarna)".
   * Holds that head, "additional payment providers".
   */
  missingHead?: string;
  /**
   * A weak exclusion match on an item's words without its qualifier:
   * currency pricing built against excluded "multi-currency pricing". Holds
   * the qualifier ("multi") and the item without it ("currency pricing").
   */
  missingQualifier?: { qualifier: string; plain: string };
  /**
   * A weak exclusion match an exception leaves open. `listedAfter`: the item
   * was listed after the exception ("other than Stripe, gift cards") and may
   * belong to it. Otherwise the pull request also names the exception, or
   * names it without its qualifier ("reports" for "other than standard
   * reports"), so it may be the work the contract allows.
   */
  exceptionQuestion?: { exception: string; listedAfter: boolean };
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

// "etc" ends a list ("gift cards, loyalty points, etc."); as a word it would
// match every etc/ directory (app/etc/config.php, docker/etc/nginx).
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "its", "of", "on", "or", "out", "the", "this", "that", "to", "via", "with", "without",
  "only", "not", "no", "per", "than", "then", "will", "shall", "must", "may", "can", "etc",
]);

/**
 * "Multi-currency" written with a typographic hyphen (U+2010, U+2011, or an
 * en dash between letters), as PDFs, Word and AI drafts write it, reads like
 * the ASCII "multi-currency". A soft hyphen (U+00AD) is not a character at all.
 */
export function plainHyphens(text: string): string {
  if (!/[\u00ad\u2010-\u2013]/.test(text)) return text;
  return text.replace(/\u00ad/g, "").replace(/[\u2010\u2011]|(?<=[A-Za-z])[\u2012\u2013](?=[A-Za-z])/g, "-");
}

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

/**
 * "Additional payment providers", "other payment gateways": what the SOW
 * already includes (the Stripe provider) is not one of them. Work that never
 * says the word may be either, so it is a question for a person. These stay
 * out of QUALIFIERS: an included "payment gateway integration (stripe)" must
 * not clear an Adyen gateway the way a plain variant clears its qualified one.
 */
const ADDITIVE = /\b(?:other|additional|alternative|further|extra)\b/i;
const ADDITIVE_WORDS = new RegExp(ADDITIVE.source, "gi");

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
  for (const chunk of plainHyphens(text).split(/[^A-Za-z0-9_-]+/)) {
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
  for (const run of plainHyphens(text).split(/[.,;:!?()[\]{}"|\n]+/)) {
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
  /** The words `head` is made from, as the SOW wrote them. */
  headText?: string;
  /**
   * What the item says it leaves out ("other than Stripe"), one term list
   * each. A qualified exception keeps its qualifier: "other than standard
   * reports" leaves out standard reports, not every report.
   */
  except: Term[][];
  /** Qualified exceptions without their qualifier: "report" for "other than standard reports". */
  plainExcept: Term[][];
  /** The exceptions as the SOW wrote them, for the reason given to a person. */
  exceptText?: string;
  /** The same text, head and exceptions match the same way, so a match is worked out once. */
  key: string;
  /** Listed after an exception, so it may be excluded or part of the exception: only ever a question. */
  weakOnly?: boolean;
}

/**
 * "Payment providers other than Stripe": what follows the marker is not part
 * of the item. Exported so the SOW parser can keep such an item whole. The
 * boilerplate "including but not limited to" names examples of the item, not
 * exceptions to it. "Excluding" and "not including" before VAT, tax or
 * shipping describe a price ("B2B prices excluding VAT"), not an exception.
 * "Save for" is left out: "save for later" is a feature.
 */
export const EXCEPTION_MARKER =
  /\b(?:other\s+than|except(?:\s+for)?|with\s+the\s+exception\s+of|(?:excluding|not\s+including)(?!\s+(?:vat|gst|tax(?:es)?|sales\s+tax|shipping)\b)|besides|apart\s+from|aside\s+from|but\s+not(?!\s+(?:necessarily\s+)?(?:limited|restricted)\b))\b/i;
const EXCEPTION_MARKERS = new RegExp(EXCEPTION_MARKER.source, "gi");
/** "(including) but not limited to": padding before a list of examples. */
const NOT_LIMITED_TO = /\bbut\s+not\s+(?:necessarily\s+)?(?:limited|restricted)\s+to\b/gi;
const LIST_SEPARATOR = /[,;/&]|\s+(?:and|or)\s+/i;
/** "such as", "e.g.", "for example": what follows names examples of what precedes it. */
const INTRODUCER = String.raw`(?:such\s+as|including|like|for\s+(?:example|instance)|e\.?\s?g\.?|namely)`;
/**
 * "third-party integrations such as salesforce": the first introducer after a
 * word. Found with one forward search, never a lazy prefix, so a long run of
 * spaces is read once.
 */
const EXAMPLE_INTRODUCER = new RegExp(String.raw`(?<=\S)\s+${INTRODUCER}[\s,:]+(?=\S)`, "i");
/** "(for example google, facebook)" -> "google, facebook". */
const EXAMPLES_FIRST = new RegExp(String.raw`^\s*${INTRODUCER}[\s,:]+`, "i");

/**
 * A bracket that never closes, "payment providers (other than Stripe, gift
 * cards and loyalty points", reads as if it were not there, so the list after
 * it splits the way it would without the bracket. One pass.
 */
export function withoutUnclosedBrackets(text: string): string {
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") open.push(i);
    else if ((ch === ")" || ch === "]") && open.length > 0) open.pop();
  }
  if (open.length === 0) return text;
  let out = "";
  let from = 0;
  for (const at of open) {
    out += `${text.slice(from, at).trimEnd()} `;
    from = at + 1;
  }
  return out + text.slice(from);
}

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
  // "CRM integrations, including but not limited to Salesforce": the padding
  // is dropped, so "salesforce" isn't held to words no pull request uses.
  const [kept, exceptionItems, laterExamples] = splitException(
    plainHyphens(phrase).replace(/\u0000/g, " ").replace(NOT_LIMITED_TO, ","),
  );
  // "Reports other than standard reports": the exception keeps its qualifier,
  // or it would name every report. Work named without the qualifier may be
  // either, so it is a question for a person (plainExcept), not in scope.
  let except = NO_EXCEPTIONS;
  let plainExcept = NO_EXCEPTIONS;
  for (const item of exceptionItems) {
    const plain = termsOf(item, "inclusion");
    if (plain.length === 0) continue;
    if (except === NO_EXCEPTIONS) except = [];
    const qualified = termsOf(item, "exclusion");
    if (qualified.length > 0 && termsKey(qualified) !== termsKey(plain)) {
      except.push(qualified);
      if (plainExcept === NO_EXCEPTIONS) plainExcept = [];
      plainExcept.push(plain);
    } else except.push(plain);
  }
  const named = exceptionItems.slice(0, 3).map((item) => item.replace(/^(?:the|a|an)\s+/i, ""));
  const exceptText =
    named.length === 0 ? undefined : `${named.join(" and ")}${exceptionItems.length > named.length ? " and others" : ""}`;
  // Every example in a bracket shares its head's words, worked out once.
  const heads = new Map<string, Term | undefined>();
  const headTerm = (head: string) => {
    if (!heads.has(head)) heads.set(head, anyWordOf(head));
    return heads.get(head);
  };
  // The parts of one item share its exceptions, so a part is known by its
  // text, head and weakness; the matcher keys its cache by the exceptions too.
  const part = (text: string, head?: string, weakOnly?: boolean): PhrasePart => ({
    text,
    head: head ? headTerm(head) : undefined,
    headText: head || undefined,
    except,
    plainExcept,
    exceptText,
    weakOnly,
    key: [text, head ?? "", weakOnly ? "weak" : ""].join("\u0001"),
  });

  // Brackets come out first, so a list inside them doesn't split the item around them.
  const brackets: string[] = [];
  const flat = oneLevelOfBrackets(kept).replace(/\(([^)]*)\)?/g, (_, inner: string) => `\u0000${brackets.push(inner) - 1}\u0000`);
  const parts: PhrasePart[] = [];
  for (const piece of listItems(flat)) {
    const head = piece.replace(/\u0000\d+\u0000/g, " ").trim();
    if (head) parts.push(part(head));
    // "Third-party integrations such as Salesforce": the first example also
    // counts on its own, next to a word of what it is an example of, as a
    // bracketed example does. The whole piece is still matched as before.
    const introducer = EXAMPLE_INTRODUCER.exec(head);
    if (introducer && !/(?:^|\W)not$/i.test(head.slice(Math.max(0, introducer.index - 4), introducer.index))) {
      parts.push(part(head.slice(introducer.index + introducer[0].length), head.slice(0, introducer.index)));
    }
    for (const [, index] of piece.matchAll(/\u0000(\d+)\u0000/g)) {
      const examples = listItems((brackets[Number(index)] ?? "").replace(EXAMPLES_FIRST, ""));
      // "Single sign-on (SSO)": another name for the head, which counts on its own.
      if (examples.length === 1 && head && abbreviates(head, examples[0])) {
        parts.push(part(examples[0]));
        continue;
      }
      // "Social login (Google, Facebook)": examples count only next to a word of their head.
      for (const text of examples) parts.push(part(text, head || undefined));
    }
  }
  // "providers other than stripe (paypal, klarna)": the bracket may name what
  // is excluded or what is excepted; either way it is a question for a person.
  for (const text of laterExamples) parts.push(part(text, undefined, true));
  // "a other than b, a other than c": the same part is matched once.
  const seen = new Set<string>();
  return parts.filter((p) => !seen.has(p.key) && Boolean(seen.add(p.key)));
}

const isOpen = (ch: string) => ch === "(" || ch === "[";
const isClose = (ch: string) => ch === ")" || ch === "]";

/**
 * "CRM (Salesforce (Sales Cloud), HubSpot)" -> "CRM (Salesforce , HubSpot)" and
 * "providers [PayPal, Klarna]" -> "providers (PayPal, Klarna)": one level of
 * round brackets, which is what bracketed examples are read from. One pass.
 */
function oneLevelOfBrackets(text: string): string {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!isOpen(ch) && !isClose(ch)) continue;
    if (depth <= 1) out.push(text.slice(from, i));
    from = i + 1;
    if (isOpen(ch)) {
      if (++depth === 1) out.push("(");
    } else if (depth > 0 && --depth === 0) out.push(")");
  }
  if (depth <= 1) out.push(text.slice(from));
  return out.join("");
}

/** The exceptions of an item that has none, shared, so such parts are matched once across items. */
const NO_EXCEPTIONS: Term[][] = [];

/** Where the bracket open at `from` closes: the index of its ")" or "]", or the end of `text`. */
function closingBracket(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (isOpen(text[i])) depth++;
    else if (isClose(text[i])) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return text.length;
}

/** The first "," or ";" outside brackets at or after `from`, or the end of `text`. */
function topLevelEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (isOpen(ch)) depth++;
    else if (isClose(ch)) depth = Math.max(0, depth - 1);
    else if ((ch === "," || ch === ";") && depth === 0) return i;
  }
  return text.length;
}

/** "other than" lists: "stripe and sendgrid" -> ["stripe", "sendgrid"]; a role in brackets ("Stripe (payments)") only describes. */
function excepted(text: string): string[] {
  return text
    .replace(/\([^()]*\)|\[[^[\]]*\]/g, " ")
    .split(EXCEPTION_MARKER)
    .flatMap(listItems);
}

/**
 * Item, exception items, and items that may be either excluded or excepted
 * (a question for a person). Read the way the SOW parser reads an exception:
 * - inside a bracket, "integrations (other than Stripe (payments) and
 *   SendGrid) and gift cards", it ends with its own bracket;
 * - otherwise it ends at the next "," or ";" outside brackets. What follows a
 *   "," may list more exceptions ("other than Stripe, SendGrid") or more
 *   excluded work ("other than Stripe, gift cards"); nothing says which, so
 *   it is only ever a question. After a ";" with no other exception, the
 *   items are excluded as usual.
 * - "other than stripe (paypal, klarna)": the bracket may name what is
 *   excluded or what is excepted, a question either way; so are items joined
 *   to it by "and" ("stripe (payments) and sendgrid (email)").
 * A bracket that never closes reads as if it were not there. Each marker and
 * bracket is read once, so a long item takes time in proportion to it.
 */
function splitException(phrase: string): [string, string[], string[]] {
  if (phrase.search(EXCEPTION_MARKER) < 0) return [phrase, [], []];
  const text = withoutUnclosedBrackets(phrase);
  const except: string[] = [];
  const weak: string[] = [];
  let kept = "";
  let pos = 0;
  let depth = 0;
  for (;;) {
    EXCEPTION_MARKERS.lastIndex = pos;
    const found = EXCEPTION_MARKERS.exec(text);
    if (!found) {
      kept += text.slice(pos);
      break;
    }
    for (let i = pos; i < found.index; i++) {
      if (isOpen(text[i])) depth++;
      else if (isClose(text[i])) depth = Math.max(0, depth - 1);
    }
    kept += text.slice(pos, found.index);
    const start = found.index + found[0].length;

    if (depth > 0) {
      // "integrations (other than stripe) and gift cards": the exception ends with its bracket.
      const close = closingBracket(text, start);
      except.push(...excepted(text.slice(start, close)));
      pos = close;
      continue;
    }

    const end = topLevelEnd(text, start);
    let exception = text.slice(start, end);
    // "integrations besides stripe such as salesforce and hubspot": the
    // examples may be of what is excluded or of the exception, a question.
    const introducer = EXAMPLE_INTRODUCER.exec(exception);
    if (introducer) {
      weak.push(...listItems(exception.slice(introducer.index + introducer[0].length).replace(/[()[\]]/g, ",")));
      exception = exception.slice(0, introducer.index);
    }
    const open = exception.search(/[([]/);
    if (open < 0) except.push(...excepted(exception));
    else {
      const close = closingBracket(exception, open + 1);
      except.push(...excepted(exception.slice(0, open)));
      weak.push(...listItems(exception.slice(open + 1, close)));
      const tail = exception.slice(close + 1);
      const tailMarker = tail.search(EXCEPTION_MARKER);
      if (/^\s*(?:and|or|&)\s/i.test(tail)) weak.push(...listItems(tail.replace(/[()[\]]/g, ",")));
      else if (tailMarker < 0) kept += ` ${tail}`;
      else {
        // "cms other than contentful (headless) except blogs"
        kept += ` ${tail.slice(0, tailMarker)}`;
        except.push(...excepted(tail.slice(tailMarker).replace(EXCEPTION_MARKER, "")));
      }
    }

    const rest = text.slice(end);
    if (rest.startsWith(";") && rest.search(EXCEPTION_MARKER) < 0) {
      // "payment providers other than Stripe; gift cards": a new item.
      kept += ` ${rest}`;
    } else {
      for (const item of listItems(rest.replace(/[()[\]]/g, ","))) {
        const marker = item.search(EXCEPTION_MARKER);
        if (marker < 0) weak.push(item);
        else {
          // "…, analytics other than Plausible": Plausible is allowed too.
          if (marker > 0) weak.push(item.slice(0, marker));
          except.push(...excepted(item.slice(marker).replace(EXCEPTION_MARKER, "")));
        }
      }
    }
    break;
  }
  // "…, such as PayPal or Klarna": the examples, without the word that introduces them.
  const weakItems = weak.map((item) => item.replace(EXAMPLES_FIRST, "").trim()).filter(Boolean);
  return [kept, [...new Set(except.map((item) => item.trim()).filter(Boolean))], [...new Set(weakItems)]];
}

/* ------------------------------------------------------------------ */
/* Pull request evidence                                               */
/* ------------------------------------------------------------------ */

interface EvidenceDoc extends PhraseEvidence {
  tokens: Set<string>;
  /** Adjacent word pairs, for titles and descriptions. */
  pairs?: Set<string>;
  /** How a match lists this document, built once and shared by every match. */
  entry: PhraseEvidence;
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
  /** `docs` and `strongDocs` best first (code, then titles, then text), sorted once. */
  ordered: { all: EvidenceDoc[]; strong: EvidenceDoc[] };
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
  termGroups: Map<string, ReadonlySet<number>>;
  /** Per item, the groups that name one of its exceptions; the parts of an item share its list. */
  exceptGroups: WeakMap<Term[][], ReadonlySet<number>>;
  /** Per item's exceptions and scope, whether the scope names one of them. */
  exceptNamed: WeakMap<Term[][], Map<Scope, boolean>>;
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
    docs.push({
      location,
      strength,
      sourceQuality,
      entry: { location, strength, sourceQuality },
      tokens: tokenize(text),
      ...(prose ? { pairs: wordPairs(text) } : {}),
    });
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
    ordered: { all: bestFirst(docs), strong: bestFirst(strongDocs) },
    all: scopeOf(docs),
    strong: scopeOf(strongDocs),
    groups,
    groupsOf,
    termGroups: new Map(),
    exceptGroups: new WeakMap(),
    exceptNamed: new WeakMap(),
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
function groupsHolding(term: Term, evidence: Evidence): ReadonlySet<number> {
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
  evidence.termGroups.set(key, holding);
  return holding;
}

/** Whether a scope names every term of one of an item's exceptions, worked out once per item and scope. */
function namesAny(exceptions: Term[][], scope: Scope, evidence: Evidence): boolean {
  if (exceptions.length === 0) return false;
  let byScope = evidence.exceptNamed.get(exceptions);
  if (!byScope) evidence.exceptNamed.set(exceptions, (byScope = new Map()));
  let named = byScope.get(scope);
  if (named === undefined) {
    named = exceptions.some((exception) => exception.every((term) => termIn(term, scope)));
    byScope.set(scope, named);
  }
  return named;
}

/** The groups that name every term of one of an item's exceptions, worked out once per item. */
function exceptionGroups(except: Term[][], evidence: Evidence): ReadonlySet<number> {
  const known = evidence.exceptGroups.get(except);
  if (known) return known;
  const naming = new Set<number>();
  for (const exception of except) {
    const [fewest, ...rest] = exception.map((term) => groupsHolding(term, evidence)).sort((a, b) => a.size - b.size);
    for (const group of fewest ?? NO_GROUPS) if (rest.every((groups) => groups.has(group))) naming.add(group);
  }
  evidence.exceptGroups.set(except, naming);
  return naming;
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
  fits: (group: number) => boolean,
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
    if (counts[group] < required || !fits(group)) continue;
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
  missingHead?: string;
  missingQualifier?: ContractPhraseMatch["missingQualifier"];
  exceptionQuestion?: ContractPhraseMatch["exceptionQuestion"];
}

/** "Multi-currency pricing" -> "currency pricing". */
function withoutQualifiers(text: string): string {
  return text.replace(/([A-Za-z0-9]+)[\s-]*/g, (whole, word: string) => (QUALIFIERS.has(word.toLowerCase()) ? "" : whole)).trim();
}

/** Identifies a term list by its forms, to tell whether dropping qualifiers changed it. */
function termsKey(terms: Term[]): string {
  return terms.map((term) => `${term.phrase ? "phrase:" : ""}${term.forms.map((form) => form.join(" ")).join("|")}`).join("\u0001");
}

function matchPart(kind: ContractPhraseMatch["kind"], part: PhrasePart, evidence: Evidence): PartMatch | undefined {
  const terms = termsOf(part.text, kind);
  if (terms.length === 0) return undefined;
  const strict = matchTerms(kind, part, terms, evidence);
  // "Other payment providers" built as Stripe provider work: the included
  // provider is what the others are other than. Only a question, unless what
  // was built says "other" ("additional", ...) itself.
  const additive = kind === "exclusion" && strict?.strong ? ADDITIVE.exec(part.text)?.[0].toLowerCase() : undefined;
  if (strict && additive && !evidence.strong.tokens.has(stemWord(additive))) {
    const plain = part.text.replace(ADDITIVE, " ").replace(/\s+/g, " ").trim();
    return { ...strict, strong: false, missingQualifier: { qualifier: additive, plain: plain || part.text } };
  }
  if (strict || kind === "inclusion") return strict;

  // "Multi-currency pricing" when the pull request builds currency pricing
  // but never says "multi": it may be the single currency the SOW allows or
  // the multi-currency it excludes. Nothing settles which, so it is a question
  // for a person, never a change order, and only when the work was built
  // (in changed files or titles), not just described.
  // "Additional languages" built as a language switcher that never says
  // "additional" is the same question.
  const unqualified = part.text.replace(ADDITIVE_WORDS, " ");
  const plain = termsOf(unqualified, "inclusion");
  if (plain.length === 0 || termsKey(plain) === termsKey(terms)) return undefined;
  const relaxed = matchTerms(kind, part, plain, evidence);
  if (!relaxed) return undefined;
  const built = plain.filter((term) => termIn(term, evidence.strong)).length >= requiredTerms(kind, plain.length);
  if (!built) return undefined;
  // Read the way termsOf reads them, so one of these words is always there.
  const qualifiers = new Set(
    part.text
      .split(/[^A-Za-z0-9_-]+/)
      .flatMap(splitWords)
      .filter((word) => QUALIFIERS.has(word) || ADDITIVE.test(word)),
  );
  return {
    ...relaxed,
    strong: false,
    missingQualifier: {
      qualifier: [...qualifiers].join(" ") || "qualified",
      plain: withoutQualifiers(unqualified.replace(/\s+/g, " ")) || part.text,
    },
  };
}

/** A part's match on the given terms: what `matchPart` does once it knows which of the part's words count. */
function matchTerms(kind: ContractPhraseMatch["kind"], part: PhrasePart, terms: Term[], evidence: Evidence): PartMatch | undefined {
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
  const namesException = (scope: Scope) => namesAny(part.except, scope, evidence);
  // Or names it without its qualifier: "reports" for "other than standard reports".
  const mayNameException = (scope: Scope) => namesException(scope) || namesAny(part.plainExcept, scope, evidence);
  const result = (
    found: Found[],
    head: Found[],
    strong: boolean,
    exceptionQuestion?: PartMatch["exceptionQuestion"],
  ): PartMatch => ({
    part: part.text,
    found: [...found, ...head],
    coverage: Math.min(1, found.length / terms.length),
    strong,
    ...(exceptionQuestion ? { exceptionQuestion } : {}),
  });
  const exception = part.exceptText ?? "its exception";

  const foundAll = find(evidence.all);
  if (foundAll.length < required) return undefined;
  const headAll = headIn(evidence.all);
  if (!headAll) {
    // "Add PayPal to checkout" against excluded "additional payment providers
    // (PayPal, Klarna)": the example is named, what it is an example of isn't.
    // Too little for a change order ("google" in "Google Analytics" isn't
    // "social login (Google)"), too much to call in scope: a question for a
    // person. Included examples still need their head.
    if (kind === "inclusion" || namesException(evidence.all)) return undefined;
    return { ...result(foundAll, [], false), missingHead: part.headText };
  }
  const foundStrong = find(evidence.strong);

  if (kind === "inclusion") {
    if (foundStrong.length === 0 || mayNameException(evidence.strong)) return undefined;
    return result(foundAll, headAll, foundStrong.length >= required);
  }

  // An exclusion turns into a change order, so its words have to be found
  // together: in one changed file, or in the titles and branch. Words spread
  // over unrelated files ("gift-wrap.tsx" and "card-payment-form.tsx") are
  // only a question for a person.
  if (foundStrong.length >= required) {
    // Worked out from the token index, so each group is an O(1) test.
    const headGroups = part.head ? groupsHolding(part.head, evidence) : undefined;
    const exceptGroups = exceptionGroups(part.except, evidence);
    const plainGroups = exceptionGroups(part.plainExcept, evidence);
    const fits = (group: number) => (!headGroups || headGroups.has(group)) && !exceptGroups.has(group);
    // Listed after an exception: it may be excluded or part of the exception.
    const listedAfter = part.weakOnly ? { exception, listedAfter: true } : undefined;
    const group = bestGroup(terms, compactPart, required, (g) => fits(g) && !plainGroups.has(g), evidence);
    if (group) {
      // A changed file or title naming the exception ("stripe.ts") shows the
      // excepted work is built here; a shared file holding only the item's
      // words ("providers/index.ts") may be its plumbing. A question, not a
      // change order.
      const question = listedAfter ?? (exceptGroups.size > 0 ? { exception, listedAfter: false } : undefined);
      return result(find(group), headIn(group) ?? [], !question, question);
    }
    // Only groups that name a qualified exception without its qualifier
    // ("reports" for "other than standard reports"): it may be the exception.
    const unsure = plainGroups.size > 0 ? bestGroup(terms, compactPart, required, fits, evidence) : undefined;
    if (unsure) return result(find(unsure), headIn(unsure) ?? [], false, listedAfter ?? { exception, listedAfter: false });
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

/** Documents best first; the sort is stable, so documents of one strength keep their order. */
function bestFirst(docs: EvidenceDoc[]): EvidenceDoc[] {
  return [...docs].sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]);
}

/** The documents a match was made on, best first. */
function evidenceOf(match: PartMatch, evidence: Evidence): PhraseEvidence[] {
  const tokens = [...new Set(match.found.filter(({ term }) => !term.phrase).flatMap(({ form }) => form))];
  const phrases = match.found.filter(({ term }) => term.phrase).map(({ term }) => term);
  return (match.strong ? evidence.ordered.strong : evidence.ordered.all)
    .filter((doc) => tokens.some((token) => doc.tokens.has(token)) || phrases.some((term) => phraseIn(term, doc)))
    .map((doc) => doc.entry);
}

/**
 * Returns at most one match per SOW item: the best-matching part of each
 * inclusion and exclusion phrase on every clause of the baseline.
 */
export function matchContractPhrases(input: ContractMatchInput): ContractPhraseMatch[] {
  // Built once: every part of every SOW item is checked against the same sets.
  const evidence = gatherEvidence(input.pullRequest, input.issue, input.maintenanceOnly ?? false);
  // Parts repeated across items and clauses are matched once.
  // Keyed by the part's exceptions first: parts of items with none share NO_EXCEPTIONS.
  const known = new Map<Term[][], Map<string, PartMatch | undefined>>();
  const termsMatched = (match: PartMatch) => [...new Set(match.found.flatMap(({ form }) => form))];
  const bestPart = (kind: ContractPhraseMatch["kind"], phrase: string, keep?: (match: PartMatch) => boolean) => {
    let best: PartMatch | undefined;
    for (const part of partsOf(phrase)) {
      let byPart = known.get(part.except);
      if (!byPart) known.set(part.except, (byPart = new Map()));
      const key = `${kind}\u0001${part.key}`;
      const match = byPart.has(key) ? byPart.get(key) : matchPart(kind, part, evidence);
      byPart.set(key, match);
      if (match && (!keep || keep(match))) best = better(best, match);
    }
    return best;
  };

  // Inclusions first. When the SOW includes the plain variant of what it
  // excludes with a qualifier ("basic keyword search" and "advanced search"),
  // work matching that inclusion that never names the qualifier is the
  // included work, so that part of the exclusion doesn't count. An inclusion
  // is the plain variant only when it adds no words the pull request didn't
  // name: "sales reports" is narrower than "reports", so a report builder
  // that never says "sales" may still be the "custom reports" excluded.
  const { clauses } = input.baseline;
  const inclusions = clauses.map((clause) => clause.inclusions.map((phrase) => bestPart("inclusion", phrase)));
  const plainInclusions = inclusions.flatMap((row, c) =>
    row.flatMap((match, i) => {
      if (!match?.strong) return [];
      const text = plainHyphens(clauses[c].inclusions[i]).replace(/[^A-Za-z0-9_-]+/g, " ");
      const qualified = splitWords(text).some((w) => QUALIFIERS.has(w));
      // The inclusion's own words, in the form the match reports them.
      const own = termsOf(match.part, "inclusion").flatMap((t) => t.forms[t.forms.length - 1]);
      return [{ terms: new Set(termsMatched(match)), qualified, own }];
    }),
  );
  const notIncluded = (match: PartMatch) => {
    // "Additional payment providers": an included Stripe provider is what they are additional to.
    if (!match.missingQualifier || ADDITIVE.test(match.missingQualifier.qualifier)) return true;
    const terms = termsMatched(match);
    return !plainInclusions.some(
      (inc) =>
        terms.every((t) => inc.terms.has(t)) &&
        // Plain, or the pull request named a word of the inclusion the exclusion lacks.
        (!(inc.qualified || inc.own.some((t) => !terms.includes(t))) || [...inc.terms].some((t) => !terms.includes(t))),
    );
  };

  const matches: ContractPhraseMatch[] = [];
  const add = (clause: ContractClause, kind: ContractPhraseMatch["kind"], phrase: string, best: PartMatch | undefined) => {
    if (!best) return;
    matches.push({
      clause,
      kind,
      phrase,
      matchedPart: best.part,
      matchedTerms: termsMatched(best),
      coverage: best.coverage,
      strong: best.strong,
      ...(best.missingHead ? { missingHead: best.missingHead } : {}),
      ...(best.missingQualifier ? { missingQualifier: best.missingQualifier } : {}),
      ...(best.exceptionQuestion ? { exceptionQuestion: best.exceptionQuestion } : {}),
      // Listed once per item, for the part it is reported by.
      evidence: evidenceOf(best, evidence),
    });
  };
  clauses.forEach((clause, c) => {
    for (const phrase of clause.exclusions) add(clause, "exclusion", phrase, bestPart("exclusion", phrase, notIncluded));
    clause.inclusions.forEach((phrase, i) => add(clause, "inclusion", phrase, inclusions[c][i]));
  });
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
export function capabilityNames(pullRequestWords?: () => Set<string>): CapabilityNames {
  const tokens = new Map<string, Set<string>>();
  const tokensOf = (phrase: string) => {
    let found = tokens.get(phrase);
    if (!found) tokens.set(phrase, (found = tokenize(phrase)));
    return found;
  };
  const items = new Map<string, Term[][]>();
  // Whether the pull request names one of an item's exceptions. Its words are
  // only read when an item has an exception.
  let named: Set<string> | undefined;
  const namesException = (exceptions: Term[][]) => {
    if (exceptions.length === 0 || !pullRequestWords) return false;
    named ??= pullRequestWords();
    const words = named;
    return exceptions.some((exception) => exception.every((term) => satisfiedForm(term, words)));
  };
  const termsOfItem = (kind: ContractPhraseMatch["kind"], phrase: string) => {
    const key = `${kind}:${phrase}`;
    let found = items.get(key);
    if (!found) {
      found = partsOf(phrase).flatMap((part) => {
        // A part listed after an exception may be the exception: the phrase
        // matcher asks about it. So does a part whose exception the pull
        // request names ("single sign-on except Google" for Google SSO), with
        // or without its qualifier.
        if (part.weakOnly || namesException(part.except) || namesException(part.plainExcept)) return [];
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
