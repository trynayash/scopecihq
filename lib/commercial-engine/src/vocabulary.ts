/**
 * Scope Vocabulary.
 *
 * A statement of work names categories ("native mobile apps", "payment
 * providers other than Stripe", "multi-language support"); a pull request
 * names their members ("React Native", "Klarna", `src/i18n/fr.json`). The
 * contract matcher on its own is literal, so it can't see that one is the
 * other. This module is the reviewed list that connects them: each category,
 * how a SOW names it, its well-known members, the category's own words, and
 * the look-alikes that are not members ("apple-touch-icon", "Google
 * Analytics" next to a login, a `vendor/` directory).
 *
 * Rules every entry follows:
 * - A category only counts when an excluded SOW item names it. A member found
 *   in a pull request is then evidence for that item; on its own it means
 *   nothing, and it never makes an included item match.
 * - A member is strong evidence (a change order) only when the pull request
 *   builds it (changed files or titles) and something corroborates it: the
 *   named category's own words in the same file or titles (never words of the
 *   member's own name: "pay" in "PayPal" is not "payment"), a path only that
 *   kind of work has (`ios/`, `.swift`, `src/i18n/fr.json`), or a member
 *   whose name already says what it is ("loyalty points", "SwiftUI").
 *   Anything less is a question for a person.
 * - A member whose name is an ordinary word ("square", "segment", "google",
 *   "stripe", "iOS") only counts next to one of the category's context words
 *   in the same path, title or description.
 *
 * Adding a member: put it under its category with `AMBIGUOUS` if its name is
 * also an ordinary word, add the look-alikes it must not match to `guards`,
 * and add a true positive and a false-positive guard to matcher.test.ts.
 *
 * Everything here is plain data compiled once at start-up. A document is
 * read in one pass of word lookups, so the cost grows with the pull request,
 * not with the size of the vocabulary or the SOW.
 */

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/** Separates path segments and prose runs: no multi-word term spans it. */
const BOUNDARY = "|";

/**
 * The words of a path or text in order, lowercased: camelCase, hyphens,
 * underscores and other punctuation split ("ApplePayButton" -> applepay
 * button). Path segments, file extensions and prose punctuation leave a
 * boundary, so "app/store.ts" holds no "app store". Digits stay with their
 * letters ("ga4", "2fa", "i18n"). Parts split by case alone are joined again
 * when together they are a word of the vocabulary: "PayPal" is "paypal",
 * "iOS" is "ios", "GitHub" is "github" and "ApplePay" is "applepay", while
 * "open search" with a space never becomes "opensearch". Each pattern reads
 * forward once.
 */
export function vocabularyWords(text: string, kind: "path" | "prose"): string[] {
  const words: string[] = [];
  // Case boundaries are marked once for the whole text ("PayPal" ->
  // "pay\u0001pal"), so each token is only split, never re-scanned.
  const marked = text
    .replace(/([a-z])(?=[A-Z])/g, "$1\u0001")
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1\u0001")
    .replace(/([0-9])(?=[A-Z][a-z])/g, "$1\u0001")
    .toLowerCase();
  const pieces = kind === "path" ? marked.split(/[/\\.]+/) : marked.split(/[,.;:!?()[\]{}"|\n]+/);
  for (const piece of pieces) {
    if (words.length > 0 && words[words.length - 1] !== BOUNDARY) words.push(BOUNDARY);
    for (const token of piece.split(/[^a-z0-9\u0001]+/)) {
      if (!token) continue;
      if (!token.includes("\u0001")) {
        words.push(token);
        continue;
      }
      const parts = token.split("\u0001").filter(Boolean);
      for (let k = 0; k < parts.length; k++) {
        // The longest run of up to four parts that is one vocabulary word.
        let merged = parts[k];
        let next = k + 1;
        for (let n = Math.min(parts.length, k + 4); n > k + 1; n--) {
          const joined = parts.slice(k, n).join("");
          if (ONE_WORD_TERMS.has(joined)) {
            merged = joined;
            next = n;
            break;
          }
        }
        words.push(merged);
        k = next - 1;
      }
    }
  }
  return words;
}

/**
 * Expands a term written as space-separated slots, each slot a "|" list of
 * alternatives, "_" joining words of one alternative and a trailing "?"
 * marking an optional slot: "native|mobile app" -> ["native", "app"],
 * ["mobile", "app"]. The last word of every term also matches its plural, so
 * terms are written in the singular.
 */
function expand(term: string): string[][] {
  let out: string[][] = [[]];
  for (const slot of term.trim().split(/\s+/)) {
    const optional = slot.endsWith("?");
    const choices = (optional ? slot.slice(0, -1) : slot).split("|");
    const next: string[][] = [];
    for (const prefix of out) {
      if (optional) next.push(prefix);
      for (const choice of choices) next.push([...prefix, ...choice.split("_").filter(Boolean)]);
    }
    out = next;
  }
  return out.filter((words) => words.length > 0);
}

/** "applepay" for "apple pay": a multi-word name may also be written as one word. */
function withJoined(variants: string[][]): string[][] {
  const out = [...variants];
  for (const words of variants) if (words.length > 1) out.push([words.join("")]);
  return out;
}

/** The singular forms a looked-up word may stand for: "providers" -> provider, "categories" -> category. */
function singulars(word: string): string[] {
  const forms: string[] = [];
  if (word.length > 4 && word.endsWith("ies")) forms.push(`${word.slice(0, -3)}y`);
  if (word.length > 4 && word.endsWith("es")) forms.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith("s")) forms.push(word.slice(0, -1));
  return forms;
}

/** Whether `word` is `term` or its plural. */
function sameOrPlural(word: string, term: string): boolean {
  return (
    word === term ||
    word === `${term}s` ||
    word === `${term}es` ||
    (term.endsWith("y") && word === `${term.slice(0, -1)}ies`)
  );
}

/** A list of terms, each entry possibly several separated by commas. */
const listOf = (list: readonly string[] | undefined): string[] =>
  (list ?? []).flatMap((entry) => entry.split(",")).map((term) => term.trim()).filter(Boolean);

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export interface VocabularyMember {
  /** As a person writes it: "PayPal", "React Native". */
  label: string;
  terms: string[];
  /** An ordinary word as well as a name: counts only next to one of the category's context words. */
  ambiguous?: boolean;
  /** Its own name says what it is ("loyalty points", "SwiftUI"): corroborates itself. */
  clear?: boolean;
  /** Only ever a question ("legacy customers" may be a refactor; "subscription" may be GraphQL). */
  weakOnly?: boolean;
  /** For a category with variants (iOS and Android apps): which this member builds. */
  facets?: string[];
  /**
   * Named in a SOW, it needs no context word: "Includes Stripe checkout" is
   * the payment provider and "English and French" the languages, while
   * "Apple" in a SOW may be a brand the shop sells.
   */
  plainInSow?: boolean;
}

/** A member a file path shows by its place or type rather than its words. */
export interface PathHit {
  member: string;
  /** A path that only this kind of work has (`ios/`, `.swift`): corroborates itself. */
  dedicated: boolean;
  /** Counts only next to a context word in the same path (a `.kt` file may be a Kotlin server). */
  needsContext?: boolean;
}

export interface VocabularyCategory {
  id: string;
  /**
   * How a SOW item names the category. A leading "=" means the whole item
   * ("Integrations", not "integrations with Stripe"); a leading "~" means the
   * name's first word is a qualifier work must say itself to be the excluded
   * kind ("multi-language", "custom integrations").
   */
  names: string[];
  /** Words that stop a name counting: "search engine optimisation" is not a search engine. */
  nameGuards?: string[];
  /** The category's own words: next to a member, they corroborate it. */
  own: string[];
  /** Further words that tell an ambiguous member apart ("checkout" for "stripe"). */
  context?: string[];
  members: VocabularyMember[];
  /** Look-alikes: phrases whose words are never members, own or context words here ("apple touch icon"). */
  guards?: string[];
  /** Paths that hold no member of this category, whatever their words ("vendor/" dependencies). Paths arrive lowercased. */
  pathGuards?: RegExp[];
  /** Members a path shows by its place or type. Paths arrive lowercased. */
  paths?: (path: string) => PathHit[];
  /** Categories whose members are members of this one too ("third-party integrations"). */
  includes?: string[];
}

const M = (label: string, terms: string, options: Omit<VocabularyMember, "label" | "terms"> = {}): VocabularyMember => ({
  label,
  terms: listOf([terms]),
  ...options,
});
const AMBIGUOUS = { ambiguous: true } as const;
const CLEAR = { clear: true } as const;

/** Images, fonts and manifests: icons and splash screens of a web app, never native app work on their own. */
const ASSET_PATH = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|woff2?|ttf|otf|eot|webmanifest)$/;

/* ---------- native mobile apps ---------- */

const MOBILE: VocabularyCategory = {
  id: "native_mobile_app",
  names: [
    "native|mobile|ios|android|iphone|ipad|hybrid|smartphone|tablet app|application",
    "native mobile|ios|android|iphone app|application",
    "cross_platform|crossplatform|react_native|flutter app|application",
    "native ios|android|iphone|ipad",
    "mobile client",
    "app_store|play_store|google_play release|submission|publishing|listing|deployment|launch",
  ],
  nameGuards: [
    "mobile web|responsive|friendly app|application",
    "mobile responsive|friendly|web|site|website|layout|optimisation|optimization|view",
    "progressive web app|application",
    "web app|application",
  ],
  own: ["native", "mobile"],
  context: [
    "app, application, simulator, emulator, testflight, xcode, gradle, activity, fragment, view_controller, viewcontroller",
    "app_delegate, appdelegate, screen, app_store, play_store, push_notification, deep_link, deeplink",
  ],
  members: [
    M("iOS", "ios", { ...AMBIGUOUS, facets: ["ios"] }),
    M("iPhone", "iphone", { ...AMBIGUOUS, facets: ["ios"] }),
    M("iPad", "ipad, ipados", { ...AMBIGUOUS, facets: ["ios"] }),
    M("Swift", "swift", { ...AMBIGUOUS, facets: ["ios"] }),
    M("SwiftUI", "swiftui, swift_ui", { ...CLEAR, facets: ["ios"] }),
    M("Objective-C", "objective_c, objc", { facets: ["ios"] }),
    M("Xcode", "xcode", { ...CLEAR, facets: ["ios"] }),
    M("TestFlight", "testflight, test_flight", { ...CLEAR, facets: ["ios"] }),
    M("CocoaPods", "cocoapods, cocoa_pods, podfile", { ...CLEAR, facets: ["ios"] }),
    M("App Store Connect", "app_store_connect, apple_app_store", { ...CLEAR, facets: ["ios"] }),
    M("Android", "android", { ...AMBIGUOUS, facets: ["android"] }),
    M("Kotlin", "kotlin", { ...AMBIGUOUS, facets: ["android"] }),
    M("Jetpack Compose", "jetpack_compose", { ...CLEAR, facets: ["android"] }),
    M("Google Play", "google_play, play_store, play_console", { ...CLEAR, facets: ["android"] }),
    // Cross-platform frameworks: corroborated by the category's own words or
    // their own files (metro.config.js, pubspec.yaml), never by the name alone.
    M("React Native", "react_native", { facets: ["ios", "android"] }),
    M("Expo", "expo, expo_router, eas_build", { ...AMBIGUOUS, facets: ["ios", "android"] }),
    M("Flutter", "flutter", { facets: ["ios", "android"] }),
    M("Capacitor", "capacitor", { ...AMBIGUOUS, facets: ["ios", "android"] }),
    M("Ionic", "ionic", { ...AMBIGUOUS, facets: ["ios", "android"] }),
    M("Cordova", "cordova, phonegap", { facets: ["ios", "android"] }),
    M("Xamarin", "xamarin", { ...CLEAR, facets: ["ios", "android"] }),
    M(".NET MAUI", "maui, dotnet_maui", { ...AMBIGUOUS, facets: ["ios", "android"] }),
    M("Kotlin Multiplatform", "kotlin_multiplatform, kmm", { facets: ["ios", "android"] }),
    M("Fastlane", "fastlane", { facets: ["ios", "android"] }),
  ],
  guards: [
    "ios|android|iphone|ipad safari|chrome|firefox|browser|webview|web_view|web|keyboard|viewport|zoom|scroll|scrolling",
    "mobile safari|chrome|web|site|website|browser|layout|view|menu|nav|navigation|breakpoint|responsive|first|friendly|viewport|style|styles|width",
    "apple touch icon",
    "android chrome",
    "smart app banner",
    "web app|application",
    "progressive web app",
    "home screen",
    "app router|dir|directory|layout|shell_layout",
  ],
  pathGuards: [
    ASSET_PATH,
    /(?:favicon|apple-touch-icon|apple-icon|android-chrome|android-icon|mstile|safari-pinned-tab|apple-splash|apple-launch|manifest\.json|browserconfig\.xml)/,
  ],
  paths(path) {
    const hits: PathHit[] = [];
    if (/(?:^|\/)ios\//.test(path)) hits.push({ member: "iOS", dedicated: true });
    if (/(?:^|\/)android\//.test(path) || /(?:^|\/)androidmanifest\.xml$/.test(path)) hits.push({ member: "Android", dedicated: true });
    if (/\.swift$/.test(path)) hits.push({ member: "Swift", dedicated: true });
    if (/\.(?:xcodeproj|xcworkspace|pbxproj|xib|storyboard|entitlements|xcconfig|xcassets)(?:\/|$)|(?:^|\/)podfile(?:\.lock)?$|\.lproj\//.test(path)) {
      hits.push({ member: "Xcode", dedicated: true });
    }
    if (/\.kts?$|(?:^|\/)build\.gradle$/.test(path)) hits.push({ member: "Kotlin", dedicated: false, needsContext: true });
    if (/(?:^|\/)pubspec\.yaml$|\.dart$/.test(path)) hits.push({ member: "Flutter", dedicated: true });
    if (/(?:^|\/)(?:metro\.config\.[cm]?[jt]s|eas\.json|react-native\.config\.[cm]?[jt]s)$/.test(path)) hits.push({ member: "React Native", dedicated: true });
    if (/(?:^|\/)(?:capacitor\.config\.(?:ts|js|json)|ionic\.config\.json)$/.test(path)) hits.push({ member: "Capacitor", dedicated: true });
    if (/(?:^|\/)fastlane\//.test(path)) hits.push({ member: "Fastlane", dedicated: true });
    return hits;
  },
};

/* ---------- payment providers ---------- */

const PAYMENTS: VocabularyCategory = {
  id: "payment_provider",
  names: [
    "payment provider|gateway|method|option|processor|processing|integration|service|platform|solution|type|system|partner|vendor|psp|wallet",
    "payment_service_provider",
    "digital|mobile|e wallet",
    "buy_now_pay_later, bnpl, pay_later",
    "psp",
    "=payment",
    "=online payment",
  ],
  own: ["payment", "pay", "provider", "gateway", "psp", "processor", "wallet", "bnpl"],
  context: ["checkout, charge, refund, card, billing, invoice, transaction, webhook, merchant, purchase, order, sdk, payout"],
  members: [
    M("Stripe", "stripe", { ...AMBIGUOUS, plainInSow: true }),
    M("PayPal", "paypal, pay_pal"),
    M("Venmo", "venmo"),
    M("Braintree", "braintree"),
    M("Klarna", "klarna"),
    M("Afterpay", "afterpay, clearpay"),
    M("Affirm", "affirm", AMBIGUOUS),
    M("Sezzle", "sezzle"),
    M("Zip", "zip_pay, zippay, quadpay"),
    M("Laybuy", "laybuy"),
    M("Adyen", "adyen"),
    M("Square", "square", AMBIGUOUS),
    M("Apple Pay", "apple_pay"),
    M("Google Pay", "google_pay, gpay"),
    M("Amazon Pay", "amazon_pay"),
    M("Shop Pay", "shop_pay"),
    M("Samsung Pay", "samsung_pay"),
    M("Mollie", "mollie", { ...AMBIGUOUS, plainInSow: true }),
    M("Razorpay", "razorpay"),
    M("Paytm", "paytm"),
    M("Worldpay", "worldpay"),
    M("Authorize.Net", "authorize_net, authorizenet"),
    M("2Checkout", "2checkout, twocheckout"),
    M("Paddle", "paddle", { ...AMBIGUOUS, plainInSow: true }),
    M("GoCardless", "gocardless, go_cardless"),
    M("Paystack", "paystack"),
    M("Flutterwave", "flutterwave"),
    M("Mercado Pago", "mercado_pago, mercadopago"),
    M("PayU", "payu"),
    M("Alipay", "alipay"),
    M("WeChat Pay", "wechat_pay, wechatpay"),
    M("iDEAL", "ideal", AMBIGUOUS),
    M("Bancontact", "bancontact"),
    M("Sofort", "sofort"),
    M("Giropay", "giropay"),
    M("Przelewy24", "przelewy24"),
    M("BLIK", "blik", AMBIGUOUS),
    M("SEPA Direct Debit", "sepa, direct_debit", AMBIGUOUS),
    M("Opayo", "opayo, sage_pay, sagepay"),
    M("Checkout.com", "checkout_com"),
    M("Cybersource", "cybersource"),
    M("Nuvei", "nuvei"),
    M("Coinbase Commerce", "coinbase_commerce"),
    M("BitPay", "bitpay"),
  ],
  guards: [
    "apple touch icon",
    "square image|images|footage|bracket|brackets|crop|logo|icon|thumbnail|aspect|corner|corners|tile|tiles|grid|button|buttons",
    "pay attention",
  ],
};

/* ---------- social login ---------- */

const SOCIAL_LOGIN: VocabularyCategory = {
  id: "social_login",
  names: [
    "social login|log_in|signin|sign_in|signon|sign_on|signup|sign_up|auth|authentication|account|connect|provider|identity",
    "social media login|log_in|signin|sign_in",
    "oauth login|log_in|signin|sign_in|provider",
    "third_party|3rd_party login|log_in|signin|sign_in|auth|authentication|identity",
  ],
  own: ["social, login, log_in, signin, sign_in, sign_on, signon, signup, sign_up, oauth, oidc, openid, sso, auth"],
  context: ["authentication, authenticate, identity, one_tap, credential, callback"],
  members: [
    M("Google", "google", AMBIGUOUS),
    M("Facebook", "facebook, fb", AMBIGUOUS),
    M("Apple", "apple", AMBIGUOUS),
    M("GitHub", "github", AMBIGUOUS),
    M("GitLab", "gitlab", AMBIGUOUS),
    M("Twitter", "twitter", AMBIGUOUS),
    M("Microsoft", "microsoft, azure_ad, entra", AMBIGUOUS),
    M("LinkedIn", "linkedin", AMBIGUOUS),
    M("Amazon", "amazon", AMBIGUOUS),
    M("Discord", "discord", AMBIGUOUS),
    M("Slack", "slack", AMBIGUOUS),
    M("Instagram", "instagram", AMBIGUOUS),
    M("TikTok", "tiktok", AMBIGUOUS),
    M("Yahoo", "yahoo", AMBIGUOUS),
    M("Twitch", "twitch", AMBIGUOUS),
    M("Spotify", "spotify", AMBIGUOUS),
    M("Reddit", "reddit", AMBIGUOUS),
    M("Kakao", "kakao", AMBIGUOUS),
    M("Naver", "naver", AMBIGUOUS),
    M("WeChat", "wechat", AMBIGUOUS),
  ],
  guards: [
    "google analytics|tag|tags|gtag|map|maps|font|fonts|pay|merchant|shopping|ad|ads|adwords|cloud|drive|sheet|sheets|doc|docs|recaptcha|search|optimize|play|calendar|translate|lighthouse",
    "google tag manager",
    "google search console",
    "facebook|meta|fb pixel|catalog|catalogue|shop|ad|ads|share|sharing|feed",
    "apple pay|wallet|music|map|maps|touch|icon|splash|app_store",
    "apple touch icon",
    "github action|actions|workflow|workflows|page|pages|app|issue|issues|webhook|webhooks|pr|release|releases|ci",
    "amazon pay|s3|ses|sns|sqs|web_services|cloudfront|aws",
    "microsoft clarity|teams",
    "linkedin insight",
    "twitter card|pixel|share",
    "tiktok pixel",
    "slack notification|alert|webhook|channel|message",
    "instagram feed|embed|post|gallery",
  ],
  pathGuards: [/(?:^|\/)\.github\//, ASSET_PATH],
};

/* ---------- languages ---------- */

/** Languages other than English (the language a site starts in), with their ISO 639-1 codes. */
const LANGUAGES: Array<[name: string, code: string, aliases?: string]> = [
  ["French", "fr", "francais"], ["German", "de", "deutsch"], ["Spanish", "es", "espanol"], ["Italian", "it"],
  ["Dutch", "nl", "flemish"], ["Portuguese", "pt", "brazilian_portuguese"], ["Japanese", "ja"],
  ["Chinese", "zh", "mandarin|cantonese|simplified_chinese|traditional_chinese"], ["Korean", "ko"], ["Arabic", "ar"],
  ["Hebrew", "he"], ["Russian", "ru"], ["Polish", "pl"], ["Swedish", "sv"], ["Danish", "da"], ["Norwegian", "nb", "bokmal|nynorsk"],
  ["Finnish", "fi"], ["Turkish", "tr"], ["Hindi", "hi"], ["Welsh", "cy"], ["Irish", "ga", "gaelic"], ["Greek", "el"], ["Czech", "cs"],
  ["Hungarian", "hu"], ["Romanian", "ro"], ["Ukrainian", "uk"], ["Thai", "th"], ["Vietnamese", "vi"], ["Indonesian", "id", "bahasa"],
  ["Malay", "ms"], ["Catalan", "ca"], ["Basque", "eu"], ["Galician", "gl"], ["Bengali", "bn"], ["Urdu", "ur"], ["Persian", "fa", "farsi"],
  ["Tamil", "ta"], ["Tagalog", "tl", "filipino"], ["Swahili", "sw"], ["Afrikaans", "af"], ["Croatian", "hr"], ["Serbian", "sr"],
  ["Slovak", "sk"], ["Slovenian", "sl"], ["Bulgarian", "bg"], ["Lithuanian", "lt"], ["Latvian", "lv"], ["Estonian", "et"],
  ["Icelandic", "is"], ["Maltese", "mt"], ["Maori", "mi"], ["Punjabi", "pa"], ["Gujarati", "gu"], ["Marathi", "mr"], ["Telugu", "te"],
  ["Kannada", "kn"], ["Malayalam", "ml"],
];
const LANGUAGE_OF_CODE = new Map<string, string>([...LANGUAGES.map(([name, code]): [string, string] => [code, name]), ["no", "Norwegian"]]);

/** A directory of translation files, as i18n libraries lay them out. */
const LOCALE_DIR = /(?:^|\/)(?:i18n|l10n|locales?|translations?|lang|langs|languages|intl|locali[sz]ations?)\//;
/** "fr", "fr-fr", "pt_br" as a directory or file name under such a directory. */
const LOCALE_SEGMENT = /\/([a-z]{2})(?:[-_][a-z]{2,4})?(?=\/|\.[a-z0-9]+$)/g;
/** next-intl and friends: `messages/fr.json`. */
const MESSAGES_FILE = /(?:^|\/)messages\/([a-z]{2})(?:[-_][a-z]{2,4})?\.(?:json|ya?ml|po|arb|ftl)$/;
/** "messages.fr.json", "translations.de.yml". */
const LOCALE_SUFFIX = /(?:^|\/)(?:messages|translations?|strings|locale|lang|i18n)\.([a-z]{2})(?:[-_][a-z]{2,4})?\.(?:json|ya?ml|po|xlf|xliff|arb|properties|resx|ftl)$/;
/** Android `values-fr/strings.xml` and iOS `fr.lproj/`. */
const PLATFORM_LOCALE = /(?:^|\/)values-([a-z]{2})(?:-r[a-z]{2})?\/|(?:^|\/)([a-z]{2})(?:-[a-z]{2,4})?\.lproj\//;

function localeFiles(path: string): PathHit[] {
  const codes = new Set<string>();
  const dir = LOCALE_DIR.exec(path);
  if (dir) for (const match of path.slice(dir.index + dir[0].length - 1).matchAll(LOCALE_SEGMENT)) codes.add(match[1]);
  for (const pattern of [MESSAGES_FILE, LOCALE_SUFFIX]) {
    const match = pattern.exec(path);
    if (match) codes.add(match[1]);
  }
  const platform = PLATFORM_LOCALE.exec(path);
  if (platform) codes.add(platform[1] ?? platform[2]);
  const hits: PathHit[] = [];
  for (const code of codes) {
    const language = LANGUAGE_OF_CODE.get(code);
    if (language) hits.push({ member: language, dedicated: true });
  }
  return hits;
}

const I18N: VocabularyCategory = {
  id: "multi_language",
  names: [
    // "Multi-language" and "additional languages" are qualified: a French
    // translation that never says "additional" may be the one language the
    // site is in, so it is a question rather than a change order.
    "~multi language|lingual",
    "~multilanguage, ~multilingual",
    "~multiple|additional|further|extra|foreign|second|alternate|alternative|non_english language|locale",
    "language support|version|switcher|selector|pack|option|toggle",
    "translation",
    "translated content|copy|page|site|version",
    "localisation|localization|localised|localized",
    "internationalisation|internationalization|i18n|l10n",
    "rtl support|language|layout",
    "right_to_left",
    "=language",
  ],
  own: [
    "translation, translate, translated, language, lang, locale, localization, localisation, localized, localised",
    "i18n, l10n, internationalization, internationalisation, multilingual",
  ],
  context: ["version, speaking, speaker, subtitle, rtl"],
  members: [
    ...LANGUAGES.map(([name, , aliases]) => M(name, [name.toLowerCase(), aliases ?? ""].join(", "), { ...AMBIGUOUS, plainInSow: true })),
    M("language switcher", "language|locale|lang switcher|selector|picker|toggle|dropdown|chooser|switch|menu", CLEAR),
    M("multilingual content", "multilingual, multi_language, multi_lingual", CLEAR),
    M("hreflang", "hreflang", CLEAR),
    M("right-to-left layout", "right_to_left, rtl", AMBIGUOUS),
    M("Lokalise", "lokalise"),
    M("Crowdin", "crowdin"),
    M("Transifex", "transifex"),
    M("Weglot", "weglot"),
    M("Smartling", "smartling"),
    M("DeepL", "deepl"),
    M("Google Translate", "google_translate"),
    M("Locize", "locize"),
    M("Tolgee", "tolgee"),
  ],
  guards: [
    "french fry|fries|press|door|doors|toast|braid|horn",
    "german shepherd",
    "turkish delight|towel|towels",
    "polish the|up|off",
    "translate x|y|z|3d",
    "address|coordinate|nat translation",
    "programming|query|markup|template|scripting language",
  ],
  paths: localeFiles,
};

/* ---------- analytics ---------- */

const ANALYTICS: VocabularyCategory = {
  id: "analytics",
  names: [
    "analytics",
    "analytic tool|platform|integration|tracking|dashboard|script|provider",
    "tracking pixel|script|code|tag",
    "event|conversion|user|visitor|ecommerce|marketing|behaviour|behavior tracking",
    "tag management|manager",
    "marketing|tracking|ad|conversion pixel",
    "heatmap, heat_map",
    "session recording|replay",
    "web analytics, product analytics",
  ],
  // "Tracking" only says something is tracked (an order, a parcel): context, not the category.
  own: ["analytics, analytic, pixel, telemetry"],
  context: ["track, tracking, tracker, event, tag, metric, conversion, funnel, identify, pageview, page_view, cdp, dashboard"],
  members: [
    M("Google Analytics", "google_analytics, ga4, gtag, universal_analytics", CLEAR),
    M("Google Tag Manager", "google_tag_manager, gtm", AMBIGUOUS),
    M("Mixpanel", "mixpanel"),
    M("Segment", "segment, segment_io, segmentio", AMBIGUOUS),
    M("Amplitude", "amplitude", AMBIGUOUS),
    M("Heap", "heap", AMBIGUOUS),
    M("Hotjar", "hotjar"),
    M("FullStory", "fullstory, full_story"),
    M("PostHog", "posthog"),
    M("Plausible", "plausible", AMBIGUOUS),
    M("Matomo", "matomo, piwik"),
    M("Adobe Analytics", "adobe_analytics, omniture", CLEAR),
    M("Facebook Pixel", "facebook_pixel, meta_pixel, fb_pixel", CLEAR),
    M("TikTok Pixel", "tiktok_pixel", CLEAR),
    M("Pinterest Tag", "pinterest_tag"),
    M("LinkedIn Insight Tag", "linkedin_insight"),
    M("Microsoft Clarity", "microsoft_clarity, clarity", AMBIGUOUS),
    M("Snowplow", "snowplow"),
    M("RudderStack", "rudderstack"),
    M("Pendo", "pendo"),
    M("Kissmetrics", "kissmetrics"),
    M("Woopra", "woopra"),
    M("Chartbeat", "chartbeat"),
    M("Fathom", "fathom", AMBIGUOUS),
    M("Umami", "umami", AMBIGUOUS),
    M("Vercel Analytics", "vercel_analytics", CLEAR),
    M("Crazy Egg", "crazy_egg, crazyegg"),
    M("Lucky Orange", "lucky_orange"),
    M("Mouseflow", "mouseflow"),
    M("Contentsquare", "contentsquare"),
  ],
  guards: ["path|url|line|route|code|text|time|customer|audience segment", "segment tree", "order|shipment|parcel|package|delivery tracking"],
};

/* ---------- CRM, email marketing, helpdesk, chat ---------- */

const CRM: VocabularyCategory = {
  id: "crm",
  names: ["crm", "customer relationship management", "customer relationship management system|platform|integration"],
  own: ["crm", "customer_relationship"],
  context: ["contact, lead, deal, opportunity, account, sync, pipeline"],
  members: [
    M("Salesforce", "salesforce, sfdc, sales_cloud"),
    M("HubSpot", "hubspot, hub_spot"),
    M("Pipedrive", "pipedrive"),
    M("Zoho CRM", "zoho_crm, zoho"),
    M("Microsoft Dynamics", "microsoft_dynamics, dynamics_365, dynamics_crm"),
    M("Freshsales", "freshsales"),
    M("Copper", "copper_crm"),
    M("Insightly", "insightly"),
    M("SugarCRM", "sugarcrm, sugar_crm"),
    M("Keap", "keap, infusionsoft"),
    M("Close", "close_crm, close_io"),
    M("Attio", "attio"),
    M("ActiveCampaign", "activecampaign, active_campaign"),
    M("Zendesk Sell", "zendesk_sell"),
    M("Capsule CRM", "capsule_crm"),
    M("Bitrix24", "bitrix24, bitrix"),
  ],
};

const EMAIL_MARKETING: VocabularyCategory = {
  id: "email_marketing",
  names: [
    "email marketing",
    "marketing email|automation|integration|tool|platform",
    "email campaign|automation|flow",
    "newsletter",
    "newsletter signup|subscription",
    "mailing list",
    "drip campaign",
    "abandoned cart email",
  ],
  own: ["email, newsletter, marketing, campaign, mailing_list"],
  context: ["list, audience, flow, subscribe, signup, abandoned_cart, automation, subscriber"],
  members: [
    M("Mailchimp", "mailchimp, mail_chimp"),
    M("Klaviyo", "klaviyo"),
    M("Braze", "braze"),
    M("Brevo", "brevo, sendinblue"),
    M("ActiveCampaign", "activecampaign, active_campaign"),
    M("Constant Contact", "constant_contact"),
    M("Campaign Monitor", "campaign_monitor"),
    M("ConvertKit", "convertkit"),
    M("Drip", "drip", AMBIGUOUS),
    M("Omnisend", "omnisend"),
    M("Customer.io", "customer_io, customerio"),
    M("Iterable", "iterable", AMBIGUOUS),
    M("Marketo", "marketo"),
    M("Pardot", "pardot"),
    M("HubSpot", "hubspot, hub_spot"),
    M("MailerLite", "mailerlite"),
    M("Moosend", "moosend"),
    M("Attentive", "attentive", AMBIGUOUS),
    M("Dotdigital", "dotdigital"),
    M("Emarsys", "emarsys"),
    M("Listrak", "listrak"),
    M("Sailthru", "sailthru"),
    M("Mailjet", "mailjet"),
    M("GetResponse", "getresponse"),
    M("AWeber", "aweber"),
    M("beehiiv", "beehiiv"),
  ],
};

const HELPDESK: VocabularyCategory = {
  id: "helpdesk",
  names: [
    "helpdesk, help_desk, support_desk, service_desk",
    "ticketing system|tool|platform|integration|software",
    "support ticket|ticketing",
    "customer support|service tool|platform|system|software|integration|widget|portal|desk",
  ],
  own: ["helpdesk, help_desk, support, ticket, ticketing, desk, service_desk"],
  context: ["customer_service, agent, case, inbox"],
  members: [
    M("Zendesk", "zendesk"),
    M("Freshdesk", "freshdesk, freshservice"),
    M("Intercom", "intercom"),
    M("Help Scout", "help_scout, helpscout"),
    M("Gorgias", "gorgias"),
    M("Kustomer", "kustomer"),
    M("ServiceNow", "servicenow, service_now"),
    M("Jira Service Management", "jira_service_desk, jira_service_management"),
    M("Zoho Desk", "zoho_desk"),
    M("Re:amaze", "reamaze"),
    M("Gladly", "gladly", AMBIGUOUS),
    M("HappyFox", "happyfox"),
    M("Kayako", "kayako"),
  ],
};

const LIVE_CHAT: VocabularyCategory = {
  id: "live_chat",
  names: ["live|web|website|online|in_app|customer chat", "chat widget|support|integration|tool|software", "messaging widget"],
  own: ["chat"],
  context: ["widget, support, conversation, message, messaging, inbox, agent, visitor"],
  members: [
    M("live chat", "live_chat, chat_widget, support_chat, chat_support, web_chat, chat_bubble", CLEAR),
    M("Intercom", "intercom"),
    M("Drift", "drift", AMBIGUOUS),
    M("Crisp", "crisp", AMBIGUOUS),
    M("Tawk.to", "tawk, tawk_to, tawkto"),
    M("Tidio", "tidio"),
    M("Olark", "olark"),
    M("LiveChat", "livechat"),
    M("Zendesk Chat", "zendesk_chat, zopim"),
    M("HubSpot Chat", "hubspot_chat"),
    M("Freshchat", "freshchat"),
    M("Chatwoot", "chatwoot"),
    M("Userlike", "userlike"),
    M("Smartsupp", "smartsupp"),
    M("JivoChat", "jivochat, jivo"),
    M("Chatra", "chatra"),
    M("Zoho SalesIQ", "salesiq"),
    M("Gorgias Chat", "gorgias_chat"),
  ],
};

const CHATBOT: VocabularyCategory = {
  id: "chatbot",
  names: ["chatbot, chat_bot", "conversational ai|agent|interface", "ai chat|chatbot|assistant|agent", "virtual assistant|agent", "bot integration"],
  own: ["chatbot, chat_bot, bot, assistant, conversational"],
  context: ["chat, conversation, message, messaging, prompt, llm, intent, reply"],
  members: [
    M("chatbot", "chatbot, chat_bot, ai_chat, ai_assistant, ai_chatbot", CLEAR),
    M("OpenAI", "openai, chatgpt, gpt", AMBIGUOUS),
    M("Anthropic", "anthropic, claude", AMBIGUOUS),
    M("Dialogflow", "dialogflow"),
    M("Botpress", "botpress"),
    M("Rasa", "rasa", AMBIGUOUS),
    M("Landbot", "landbot"),
    M("ManyChat", "manychat"),
    M("Voiceflow", "voiceflow"),
    M("Intercom Fin", "intercom_fin", CLEAR),
    M("Ada", "ada_support", CLEAR),
  ],
};

/* ---------- search engines ---------- */

const SEARCH_ENGINE: VocabularyCategory = {
  id: "search_engine",
  names: [
    "search engine",
    "hosted|third_party|managed|external|federated search",
    "search service|provider|integration|platform|api|as_a_service",
    "site search service|provider|integration|platform",
  ],
  nameGuards: ["search engine optimisation|optimization|optimised|optimized|marketing|friendly|ranking|result|visibility|indexing|submission"],
  own: ["search"],
  context: ["index, indexing, indice, query, ranking, facet, autocomplete, relevance"],
  members: [
    M("Algolia", "algolia"),
    M("Elasticsearch", "elasticsearch, elastic_search"),
    M("OpenSearch", "opensearch", AMBIGUOUS),
    M("Meilisearch", "meilisearch"),
    M("Typesense", "typesense"),
    M("Solr", "solr, apache_solr"),
    M("Coveo", "coveo"),
    M("Klevu", "klevu"),
    M("Searchspring", "searchspring"),
    M("Constructor.io", "constructor_io"),
    M("Bloomreach", "bloomreach"),
    M("Lucidworks", "lucidworks"),
    M("Swiftype", "swiftype"),
    M("Azure AI Search", "azure_search, azure_cognitive_search, azure_ai_search"),
    M("Doofinder", "doofinder"),
    M("Searchanise", "searchanise"),
    M("CloudSearch", "cloudsearch"),
  ],
};

/* ---------- marketplace ---------- */

const MARKETPLACE: VocabularyCategory = {
  id: "marketplace",
  names: [
    "marketplace, market_place",
    "multi vendor|seller|merchant|store",
    "multivendor",
    "multiple vendor|seller|merchant",
    "vendor|seller|merchant portal|dashboard|management|onboarding|payout|registration|signup",
    "third_party seller|merchant",
  ],
  own: ["marketplace, multivendor, multi_vendor, onboarding, payout, commission, portal"],
  context: ["listing, storefront, registration, signup, sign_up, dashboard, approval, kyc, store, shop"],
  members: [
    M("vendors", "vendor", AMBIGUOUS),
    M("sellers", "seller", AMBIGUOUS),
    M("merchants", "merchant", AMBIGUOUS),
    M("multi-vendor marketplace", "multi_vendor, multivendor, multi_seller", CLEAR),
    M("vendor onboarding", "vendor|seller|merchant onboarding|payout|portal|dashboard|registration|signup|commission", CLEAR),
    M("Mirakl", "mirakl"),
    M("Sharetribe", "sharetribe"),
    M("Dokan", "dokan"),
    M("WCFM", "wcfm"),
  ],
  guards: [
    "vendor prefix|prefixes|chunk|chunks|bundle|lib|library|folder|dir|directory|code|file|files|dependency|dependencies|dep|deps|lock|lockin|lock_in|neutral|agnostic|specific|id|name|field|tag|attribute|css|js|script|scripts",
    "product vendor",
    "merchant account|center|centre|id|category|code",
    "google merchant",
    "best|top seller",
  ],
  pathGuards: [/(?:^|\/)vendor\//, /(?:^|\/)node_modules\//, /vendors?[~.-](?:main|chunk|bundle|[0-9a-f]{6,})|(?:^|\/)vendors?\.(?:[cm]?js|css)$/],
};

/* ---------- data migration ---------- */

const DATA_MIGRATION: VocabularyCategory = {
  id: "data_migration",
  names: [
    "migration, migrate, migrating, replatforming, re_platforming, replatform",
    "data import|transfer|load",
    "legacy|historical|existing data",
    "import of|from",
    "importing data|customer|order|product|content",
  ],
  own: ["migrate, migration, migrating, import, importer, etl, replatform, replatforming, legacy"],
  context: ["export, csv, dump, backfill, transfer"],
  members: [
    M("Magento", "magento", { ...AMBIGUOUS, plainInSow: true }),
    M("WooCommerce", "woocommerce, woo_commerce", { ...AMBIGUOUS, plainInSow: true }),
    M("Shopify", "shopify", { ...AMBIGUOUS, plainInSow: true }),
    M("BigCommerce", "bigcommerce", { ...AMBIGUOUS, plainInSow: true }),
    M("PrestaShop", "prestashop", { ...AMBIGUOUS, plainInSow: true }),
    M("OpenCart", "opencart", { ...AMBIGUOUS, plainInSow: true }),
    M("Salesforce Commerce Cloud", "salesforce_commerce_cloud, demandware, sfcc", { ...AMBIGUOUS, plainInSow: true }),
    M("SAP Commerce", "hybris, sap_commerce", { ...AMBIGUOUS, plainInSow: true }),
    M("WordPress", "wordpress", { ...AMBIGUOUS, plainInSow: true }),
    M("Drupal", "drupal", { ...AMBIGUOUS, plainInSow: true }),
    M("Joomla", "joomla", { ...AMBIGUOUS, plainInSow: true }),
    M("Squarespace", "squarespace", { ...AMBIGUOUS, plainInSow: true }),
    M("Wix", "wix", { ...AMBIGUOUS, plainInSow: true }),
    M("Volusion", "volusion", { ...AMBIGUOUS, plainInSow: true }),
    M("Ecwid", "ecwid", { ...AMBIGUOUS, plainInSow: true }),
    M("Sitecore", "sitecore", { ...AMBIGUOUS, plainInSow: true }),
    M("Shopware", "shopware", { ...AMBIGUOUS, plainInSow: true }),
    M("legacy data", "legacy data|customer|order|product|user|account|content|record|catalog|catalogue|database|db|platform|store|site|system", {
      ...AMBIGUOUS,
      weakOnly: true,
    }),
  ],
  guards: [
    "fix|sort|sorting|update|clean|cleanup|organize|organise|reorder|remove|unused|missing|circular|relative|absolute|dynamic|lazy|auto|type|default|named|es|module|side_effect|barrel import",
    "import order|path|paths|statement|statements|alias|aliases|map|sorting|cycle|style|syntax|assertion|attribute",
    "schema|database|db|prisma|knex|sequelize|typeorm|drizzle|rails|django|alembic|flyway|liquibase|sql migration",
    "migration file|files|folder|dir|directory|script|scripts|runner",
  ],
  pathGuards: [
    /(?:^|\/)(?:db|database|prisma|drizzle|supabase|alembic|knex|sequelize|typeorm)\/(?:[^/]+\/)?migrations?\//,
    /(?:^|\/)migrations?\/(?:v?\d)[^/]*$/,
    /(?:^|\/)migrations?\/[^/]*\.sql$/,
    /(?:^|\/)node_modules\//,
  ],
};

/* ---------- subscriptions and loyalty ---------- */

const SUBSCRIPTIONS: VocabularyCategory = {
  id: "subscriptions",
  names: [
    "subscription",
    "recurring order|payment|billing|delivery|purchase|subscription|charge",
    "subscribe and? save",
    "auto ship|replenishment|renew",
    "autoship",
    "replenishment",
  ],
  nameGuards: ["newsletter|email|push|notification|mailing subscription", "subscription to newsletter|newsletters"],
  own: ["subscription, subscribe, recurring, renewal, rebill, autoship"],
  context: ["plan, billing, interval, frequency, cadence, delivery, pause, skip, cancel, customer, order, product, monthly, weekly, box, renew"],
  members: [
    // A bare "subscription" may be GraphQL, a websocket or a store listener:
    // only ever a question, and only next to a word about billing or orders.
    M("subscriptions", "subscription", { ...AMBIGUOUS, weakOnly: true }),
    M("Subscribe and Save", "subscribe and? save, subscribe_n_save", CLEAR),
    M("recurring orders", "recurring order|payment|billing|delivery|purchase|charge|box", CLEAR),
    M("Autoship", "autoship, auto_ship, auto_replenish, auto_replenishment", CLEAR),
    M("subscription plans", "subscription plan|product|box|order|billing|management|portal|tier|checkout", CLEAR),
    M("ReCharge", "recharge", AMBIGUOUS),
    M("Bold Subscriptions", "bold_subscription", CLEAR),
    M("Skio", "skio"),
    M("Loop Subscriptions", "loop_subscription", CLEAR),
    M("Ordergroove", "ordergroove"),
    M("Chargebee", "chargebee"),
    M("Recurly", "recurly"),
    M("Stripe Billing", "stripe_billing", CLEAR),
    M("Zuora", "zuora"),
    M("Chargify", "chargify"),
    M("Smartrr", "smartrr"),
    M("Appstle", "appstle"),
  ],
  guards: [
    "graphql|gql|ws|websocket|socket|pubsub|pub_sub|realtime|real_time|apollo|rxjs|observable|event|redux|store|firestore|supabase|channel|topic|webhook|push|newsletter|email|mailing subscription",
    "subscription resolver|server|client|transport|handler|channel|topic|event|socket|websocket|query|hook|listener|callback|manager",
    "unsubscribe",
    "use subscription",
    "newsletter|email|push subscribe|subscriber",
    "subscribe to update|event|change|store|topic|channel|newsletter|notification|webhook",
  ],
  pathGuards: [/graphql|websocket|socket|pubsub|realtime|apollo|newsletter|\.gql$/],
};

const LOYALTY: VocabularyCategory = {
  id: "loyalty",
  names: [
    "loyalty",
    "reward program|programme|scheme|point|club|system",
    "point program|programme|scheme|system",
    "vip program|programme|tier|club",
    "customer reward",
  ],
  own: ["loyalty, reward, point, tier, earn, redeem, cashback"],
  context: ["balance, member, membership, vip, stamp"],
  members: [
    M("loyalty", "loyalty"),
    M("loyalty points", "loyalty point|program|programme|scheme|tier|club|card|account|balance|reward", CLEAR),
    M("reward points", "reward point|program|programme|scheme|balance", CLEAR),
    M("rewards", "reward", AMBIGUOUS),
    M("points balance", "point balance, earn point, redeem point, earned point", CLEAR),
    M("VIP tiers", "vip tier", CLEAR),
    M("Smile.io", "smile_io, smileio"),
    M("LoyaltyLion", "loyaltylion, loyalty_lion", CLEAR),
    M("Yotpo Loyalty", "yotpo_loyalty, swell_rewards", CLEAR),
    M("Stamped", "stamped", AMBIGUOUS),
    M("Rivo", "rivo", AMBIGUOUS),
    M("Antavo", "antavo"),
    M("Open Loyalty", "open_loyalty", CLEAR),
  ],
  guards: ["break|data|end|entry|access|mount|decimal|floating|focal|pain|selling|talking|check point", "point of sale", "pickup|drop_off|collection point", "power point"],
};

/* ---------- notifications ---------- */

const PUSH: VocabularyCategory = {
  id: "push_notifications",
  names: ["push notification|message|messaging|alert", "web push", "mobile notification"],
  own: ["push, notification, notify"],
  context: ["messaging, message, alert, token, device, subscription"],
  members: [
    M("push notifications", "push", AMBIGUOUS),
    M("Firebase Cloud Messaging", "fcm, firebase_cloud_messaging, firebase_messaging"),
    M("APNs", "apns, apple_push"),
    M("OneSignal", "onesignal, one_signal"),
    M("Expo Notifications", "expo_notification, expo_push", CLEAR),
    M("Pusher Beams", "pusher_beams"),
    M("Airship", "urban_airship, airship"),
    M("web push", "web_push, webpush, push_notification, push_token", CLEAR),
  ],
  guards: [
    "git push",
    "force push",
    "push event|webhook|hook|protection|rule|access|state|route|history|commit|change|code|branch|tag|image|docker|origin|main|master",
    "router|history|array|stack push",
    "pushstate, push_state",
  ],
};

const SMS: VocabularyCategory = {
  id: "sms",
  names: ["sms", "mms", "text message|messaging|alert|notification", "sms notification|alert|marketing"],
  own: ["sms, message, messaging"],
  context: ["notification, alert, otp, verification, phone"],
  members: [
    M("SMS", "sms, mms, text_message, text_messaging", CLEAR),
    M("Twilio", "twilio"),
    M("Vonage", "vonage, nexmo"),
    M("MessageBird", "messagebird"),
    M("Plivo", "plivo"),
    M("Sinch", "sinch"),
    M("ClickSend", "clicksend"),
    M("Textmagic", "textmagic"),
    M("Telnyx", "telnyx"),
    M("Amazon SNS", "sns, amazon_sns, aws_sns", AMBIGUOUS),
    M("Attentive", "attentive", AMBIGUOUS),
    M("Postscript", "postscript", AMBIGUOUS),
  ],
};

const NOTIFICATIONS: VocabularyCategory = {
  id: "notifications",
  names: [
    "=notification",
    "notification channel|method|type|service|provider|system|platform",
    "multi|omni channel notification",
    "omnichannel notification",
  ],
  own: ["notification, notify, alert"],
  context: ["message, messaging, channel"],
  members: [M("WhatsApp", "whatsapp, whats_app"), M("Telegram", "telegram", AMBIGUOUS), M("Viber", "viber")],
  includes: ["push_notifications", "sms"],
};

/* ---------- maps, video ---------- */

const MAPS: VocabularyCategory = {
  id: "maps",
  names: [
    "=map",
    "map integration|view|widget|embed|provider|service|api",
    "interactive|embedded|google map",
    "store locator|finder",
    "location service|search|finder|lookup",
    "geolocation, geo_location, geocoding",
    "mapping integration|service|provider",
    "location based feature|search|service",
  ],
  own: ["map, location, locator, geo, geolocation, geocoding"],
  context: ["marker, pin, direction, distance, coordinate, latitude, longitude, lat, lng, place, nearby, radius"],
  members: [
    M("Google Maps", "google_map, google_place, places_api, maps_api", CLEAR),
    M("Mapbox", "mapbox"),
    M("Leaflet", "leaflet", AMBIGUOUS),
    M("OpenStreetMap", "openstreetmap, open_street_map, osm", AMBIGUOUS),
    M("HERE Maps", "here_map"),
    M("Apple Maps", "mapkit, apple_map"),
    M("Bing Maps", "bing_map"),
    M("ArcGIS", "arcgis, esri"),
    M("MapLibre", "maplibre"),
    M("geocoding", "geocoding, geocode, geocoder, reverse_geocoding", CLEAR),
    M("geolocation", "geolocation, geo_location", CLEAR),
    M("what3words", "what3words"),
    M("store locator", "store|dealer|stockist locator|finder", CLEAR),
  ],
  guards: [
    "source|site|heat|road|mind|import|key|color|colour|url|route|tile|bump|normal|texture|shadow|cube|light|hash|weak|concurrent|tree map",
    "sourcemap, sitemap, heatmap, roadmap, keymap, hashmap",
    "map function|method|over|reduce|object|key|type|util|helper|entry|entries|value|values",
  ],
};

const VIDEO: VocabularyCategory = {
  id: "video",
  names: [
    "video",
    "video hosting|streaming|player|content|integration|embed|upload|library|platform",
    "live streaming|stream|video",
    "livestream, livestreaming",
    "streaming video|media",
  ],
  nameGuards: ["video call|calling|conferencing|conference|chat|meeting|consultation"],
  own: ["video, streaming, livestream, player"],
  context: ["embed, iframe, upload, playback, playlist, channel, transcode, transcoding, encoding, caption, hls, stream"],
  members: [
    M("Vimeo", "vimeo"),
    M("Mux", "mux", AMBIGUOUS),
    M("YouTube", "youtube, you_tube", AMBIGUOUS),
    M("Wistia", "wistia"),
    M("JW Player", "jw_player, jwplayer"),
    M("Brightcove", "brightcove"),
    M("Cloudflare Stream", "cloudflare_stream"),
    M("Kaltura", "kaltura"),
    M("Vidyard", "vidyard"),
    M("Loom", "loom", AMBIGUOUS),
    M("Bunny Stream", "bunny_stream"),
    M("Video.js", "videojs, video_js"),
    M("HLS", "hls, m3u8", AMBIGUOUS),
    M("Twitch", "twitch", AMBIGUOUS),
    M("Livepeer", "livepeer"),
    M("Amazon IVS", "amazon_ivs, aws_ivs"),
    M("video player", "video player|embed|upload|hosting|streaming|gallery", CLEAR),
    M("live stream", "live_stream, livestream, live_streaming", CLEAR),
  ],
  guards: ["gorilla mux", "youtube icon|link|links|logo|social"],
};

/* ---------- gift cards, two-factor ---------- */

const GIFT_CARDS: VocabularyCategory = {
  id: "gift_cards",
  names: ["gift card|certificate|voucher", "giftcard", "egift, e_gift", "egift card", "stored value card"],
  own: ["gift, giftcard, voucher, certificate"],
  members: [
    M("gift cards", "gift card, giftcard", CLEAR),
    M("e-gift cards", "egift, e_gift, egift_card", CLEAR),
    M("stored value cards", "stored_value_card", CLEAR),
    // A voucher may be the discount voucher a SOW includes: only a question.
    M("gift vouchers", "gift voucher"),
    M("gift certificates", "gift certificate"),
  ],
};

const TWO_FACTOR: VocabularyCategory = {
  id: "two_factor",
  names: [
    "two|2|multi|second factor",
    "two|2 step verification|authentication|login|sign_in",
    "2fa, mfa, tfa, totp",
  ],
  own: ["2fa, mfa, tfa, factor, totp, authenticator, two_step, second_factor"],
  guards: ["email|passwordless|magic otp|code|link", "magic link", "passwordless login|sign_in|signin"],
  members: [
    M("two-factor authentication", "2fa, mfa, tfa, two_factor, multi_factor, second_factor, two_step, 2_step", CLEAR),
    M("TOTP", "totp", CLEAR),
    M("authenticator apps", "authenticator_app, google_authenticator, authy", CLEAR),
    M("backup codes", "backup|recovery code", CLEAR),
    // Also passwordless login ("email OTP"): only next to the category's own words.
    M("one-time passwords", "otp, one_time_password, one_time_passcode", AMBIGUOUS),
    M("security keys", "webauthn, security_key", AMBIGUOUS),
  ],
};

/* ---------- shipping, tax, ERP, CMS, reviews, A/B testing ---------- */

const SHIPPING: VocabularyCategory = {
  id: "shipping_integration",
  names: [
    "shipping integration|carrier|provider|rate|label|api|platform|software|calculator|service|partner|app",
    "carrier integration|rate|api|service",
    "courier integration|service|api",
    "fulfilment|fulfillment integration|provider|service|partner|centre|center|platform|warehouse",
    "3pl",
    "third_party logistic",
    "real_time shipping|carrier rate",
    "label printing",
  ],
  own: ["shipping, shipment, carrier, courier, fulfilment, fulfillment, logistic, parcel"],
  context: ["rate, tracking, delivery, postage, dispatch, label"],
  members: [
    M("UPS", "ups", AMBIGUOUS),
    M("FedEx", "fedex"),
    M("DHL", "dhl"),
    M("USPS", "usps"),
    M("Royal Mail", "royal_mail"),
    M("Parcelforce", "parcelforce"),
    M("Evri", "evri, hermes", AMBIGUOUS),
    M("DPD", "dpd"),
    M("GLS", "gls", AMBIGUOUS),
    M("Australia Post", "australia_post, auspost"),
    M("Canada Post", "canada_post"),
    M("PostNL", "postnl"),
    M("Purolator", "purolator"),
    M("ShipStation", "shipstation"),
    M("EasyPost", "easypost"),
    M("Shippo", "shippo"),
    M("Sendcloud", "sendcloud"),
    M("ShipBob", "shipbob"),
    M("Shiprocket", "shiprocket"),
    M("AfterShip", "aftership"),
    M("ShipEngine", "shipengine"),
    M("Starshipit", "starshipit"),
    M("ShipperHQ", "shipperhq"),
    M("Packlink", "packlink"),
    M("shipping labels", "shipping_label, label_printing, carrier_rate", CLEAR),
  ],
  guards: ["ups and downs"],
};

const TAX: VocabularyCategory = {
  id: "tax_service",
  names: [
    "tax calculation|automation|service|integration|compliance|engine|provider|software|platform|api",
    "sales tax calculation|automation|integration|compliance",
    "vat calculation|automation|integration|compliance|moss|oss",
    "automated tax",
  ],
  own: ["tax, vat, gst"],
  members: [
    M("Avalara", "avalara, avatax"),
    M("TaxJar", "taxjar"),
    M("Vertex", "vertex", AMBIGUOUS),
    M("Quaderno", "quaderno"),
    M("Stripe Tax", "stripe_tax", CLEAR),
    M("TaxCloud", "taxcloud"),
    M("Sovos", "sovos"),
    M("Anrok", "anrok"),
    M("Fonoa", "fonoa"),
    M("Taxamo", "taxamo"),
  ],
};

const ERP: VocabularyCategory = {
  id: "erp_accounting",
  names: [
    "erp",
    "accounting software|system|integration|platform|package|sync|tool",
    "finance system|integration",
    "bookkeeping software|integration",
    "back_office system|integration",
  ],
  own: ["erp, accounting, ledger, bookkeeping, finance, financial"],
  context: ["invoice, sync, inventory, journal, purchase_order, integration"],
  members: [
    M("NetSuite", "netsuite, oracle_netsuite"),
    M("SAP", "sap, s4hana, sap_business_one", AMBIGUOUS),
    M("Xero", "xero"),
    M("QuickBooks", "quickbooks, qbo"),
    M("Sage", "sage, sage_intacct", AMBIGUOUS),
    M("Odoo", "odoo"),
    M("Microsoft Dynamics", "dynamics_365, dynamics_nav, business_central, microsoft_dynamics"),
    M("FreshBooks", "freshbooks"),
    M("MYOB", "myob"),
    M("Zoho Books", "zoho_books"),
    M("Acumatica", "acumatica"),
    M("Epicor", "epicor"),
    M("Brightpearl", "brightpearl"),
    M("Cin7", "cin7"),
    M("Linnworks", "linnworks"),
  ],
};

const CMS: VocabularyCategory = {
  id: "cms",
  names: ["cms", "headless cms", "content management system|platform|integration", "=content management"],
  own: ["cms, headless"],
  context: ["content, post, page, entry, collection, studio, blog, article, model, schema, webhook"],
  members: [
    M("Contentful", "contentful"),
    M("Sanity", "sanity, sanity_io", AMBIGUOUS),
    M("Strapi", "strapi"),
    M("WordPress", "wordpress"),
    M("Prismic", "prismic"),
    M("Storyblok", "storyblok"),
    M("Ghost", "ghost", AMBIGUOUS),
    M("Drupal", "drupal"),
    M("Payload CMS", "payload_cms, payloadcms", CLEAR),
    M("Directus", "directus"),
    M("Hygraph", "hygraph, graphcms"),
    M("DatoCMS", "datocms, dato_cms"),
    M("Builder.io", "builder_io"),
    M("Decap CMS", "netlify_cms, decap_cms, decap"),
    M("Craft CMS", "craft_cms, craftcms"),
    M("Umbraco", "umbraco"),
    M("Sitecore", "sitecore"),
    M("Contentstack", "contentstack"),
    M("Kentico", "kentico"),
    M("Webflow", "webflow"),
    M("Keystone", "keystonejs, keystone_js"),
    M("TinaCMS", "tinacms, tina_cms"),
    M("ButterCMS", "buttercms, butter_cms"),
  ],
};

const REVIEWS: VocabularyCategory = {
  id: "review_platform",
  names: [
    "product? review|rating platform|integration|provider|widget|app|service|software|tool|syndication",
    "third_party review",
    "rating and review platform|integration|widget",
  ],
  own: ["review, rating, ugc"],
  context: ["star, widget, testimonial"],
  members: [
    M("Trustpilot", "trustpilot"),
    M("Yotpo", "yotpo"),
    M("Bazaarvoice", "bazaarvoice"),
    M("Feefo", "feefo"),
    M("Reviews.io", "reviews_io, reviewsio"),
    M("Okendo", "okendo"),
    M("Judge.me", "judge_me, judgeme"),
    M("Stamped", "stamped", AMBIGUOUS),
    M("PowerReviews", "powerreviews"),
    M("Loox", "loox"),
    M("Junip", "junip"),
    M("Google Customer Reviews", "google_customer_reviews"),
    M("Reevoo", "reevoo"),
    M("eKomi", "ekomi"),
  ],
};

const AB_TESTING: VocabularyCategory = {
  id: "ab_testing",
  names: [
    "a b test|testing",
    "ab test|testing",
    "split|multivariate test|testing",
    "experimentation platform|framework|tool|tooling",
    "=experimentation",
  ],
  own: ["experiment, experimentation, variant, ab_test, a_b_test, split_test, ab_testing, a_b_testing"],
  context: ["testing, test, flag, feature_flag, rollout, cohort, bucket"],
  members: [
    M("Optimizely", "optimizely"),
    M("VWO", "vwo, visual_website_optimizer"),
    M("Google Optimize", "google_optimize"),
    M("AB Tasty", "ab_tasty, abtasty"),
    M("Statsig", "statsig"),
    M("GrowthBook", "growthbook"),
    M("LaunchDarkly", "launchdarkly, launch_darkly", AMBIGUOUS),
    M("Split", "split_io", AMBIGUOUS),
    M("Eppo", "eppo"),
    M("Kameleoon", "kameleoon"),
    M("Dynamic Yield", "dynamic_yield"),
    M("Adobe Target", "adobe_target"),
  ],
};

/* ---------- third-party integrations ---------- */

const THIRD_PARTY: VocabularyCategory = {
  id: "third_party_integrations",
  names: [
    "third_party|3rd_party integration|service|tool|api|platform|system|software|application|plugin|connector|app",
    "external integration|service|system|api|platform|tool",
    "api|system|saas|back_office|business_system integration",
    // "Custom integrations" is qualified: a Salesforce sync that never says
    // "custom" may be an off-the-shelf connector the SOW allows.
    "~custom integration",
    "integration with third_party|external|other service|system|platform|tool|software|api|application",
    "=integration",
  ],
  own: ["integration, integrate, integrated, integrating, third_party, 3rd_party, connector"],
  members: [],
  includes: [
    "crm", "email_marketing", "helpdesk", "live_chat", "analytics", "erp_accounting", "review_platform", "sms", "ab_testing",
    "shipping_integration", "tax_service",
  ],
};

export const VOCABULARY: readonly VocabularyCategory[] = [
  MOBILE, PAYMENTS, SOCIAL_LOGIN, I18N, ANALYTICS, CRM, EMAIL_MARKETING, HELPDESK, LIVE_CHAT, CHATBOT, SEARCH_ENGINE,
  MARKETPLACE, DATA_MIGRATION, SUBSCRIPTIONS, LOYALTY, PUSH, SMS, NOTIFICATIONS, MAPS, VIDEO, GIFT_CARDS,
  TWO_FACTOR, SHIPPING, TAX, ERP, CMS, REVIEWS, AB_TESTING, THIRD_PARTY,
];

/* ------------------------------------------------------------------ */
/* Compiled lookups                                                    */
/* ------------------------------------------------------------------ */

type EntryKind = "member" | "own" | "context" | "guard" | "name";

interface Entry {
  kind: EntryKind;
  category: number;
  member?: number;
  words: string[];
  /** For names: the whole item ("="), or a qualifier first word ("~"). */
  flag?: "exact" | "qualified";
}

/** Every term, keyed by its first word. */
type Index = Map<string, Entry[]>;

function addTo(index: Index, entry: Entry): void {
  const [first] = entry.words;
  let list = index.get(first);
  if (!list) index.set(first, (list = []));
  list.push(entry);
}

const CATEGORY_INDEX = new Map(VOCABULARY.map((category, i) => [category.id, i]));

/** Words of documents: members, own and context words, guards. */
const DOC_INDEX: Index = new Map();
/** SOW wording: category names and their guards. */
const NAME_INDEX: Index = new Map();

VOCABULARY.forEach((category, c) => {
  category.members.forEach((member, m) => {
    for (const term of member.terms) for (const words of withJoined(expand(term))) addTo(DOC_INDEX, { kind: "member", category: c, member: m, words });
  });
  for (const term of listOf(category.own)) for (const words of withJoined(expand(term))) addTo(DOC_INDEX, { kind: "own", category: c, words });
  for (const term of listOf(category.context)) for (const words of withJoined(expand(term))) addTo(DOC_INDEX, { kind: "context", category: c, words });
  for (const term of listOf(category.guards)) for (const words of expand(term)) addTo(DOC_INDEX, { kind: "guard", category: c, words });
  for (const raw of listOf(category.names)) {
    const flag = raw.startsWith("=") ? "exact" : raw.startsWith("~") ? "qualified" : undefined;
    for (const words of withJoined(expand(flag ? raw.slice(1) : raw))) addTo(NAME_INDEX, { kind: "name", category: c, words, flag });
  }
  for (const term of listOf(category.nameGuards)) for (const words of expand(term)) addTo(NAME_INDEX, { kind: "guard", category: c, words });
});

/** Every word of every term: what parts split by case alone are joined back into ("GraphQL" -> graphql). */
const ONE_WORD_TERMS = new Set<string>();
for (const index of [DOC_INDEX, NAME_INDEX]) {
  for (const entries of index.values()) for (const entry of entries) for (const word of entry.words) ONE_WORD_TERMS.add(word);
}

interface Found {
  entry: Entry;
  start: number;
  end: number;
}

/** Whether `entry` starts at `i` of `words`, its first word already matched. Only the last word may be plural. */
function restMatches(entry: Entry, words: string[], i: number): boolean {
  const n = entry.words.length;
  if (i + n > words.length) return false;
  for (let k = 1; k < n - 1; k++) if (words[i + k] !== entry.words[k]) return false;
  return n === 1 || sameOrPlural(words[i + n - 1], entry.words[n - 1]);
}

/** Every term of `index` found in `words`, in one pass of lookups. */
function findAll(words: string[], index: Index): Found[] {
  const found: Found[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === BOUNDARY) continue;
    for (const entry of index.get(word) ?? []) if (restMatches(entry, words, i)) found.push({ entry, start: i, end: i + entry.words.length });
    // "providers" for "provider": a single-word term, or the first word of
    // a longer one ("payments gateway"), may be plural.
    for (const form of singulars(word)) {
      for (const entry of index.get(form) ?? []) {
        if (entry.words.length === 1 ? sameOrPlural(word, entry.words[0]) : restMatches(entry, words, i)) {
          found.push({ entry, start: i, end: i + entry.words.length });
        }
      }
    }
  }
  return found;
}

export interface Span {
  start: number;
  end: number;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/**
 * Spans summed up so "is there one that doesn't overlap this hit?" is O(1):
 * one ends before the hit starts, or one starts after it ends.
 */
interface SpanSummary {
  count: number;
  minEnd: number;
  maxStart: number;
}

const emptySummary = (): SpanSummary => ({ count: 0, minEnd: Infinity, maxStart: -Infinity });

function addSpan(summary: SpanSummary, span: Span): void {
  summary.count++;
  summary.minEnd = Math.min(summary.minEnd, span.end);
  summary.maxStart = Math.max(summary.maxStart, span.start);
}

/** Whether some summed-up span lies outside `hit`. */
const someOutside = (summary: SpanSummary, hit: Span) => summary.count > 0 && (summary.minEnd <= hit.start || summary.maxStart >= hit.end);

/* ------------------------------------------------------------------ */
/* Reading a document                                                  */
/* ------------------------------------------------------------------ */

/** One category's findings in one document. */
interface CategoryFindings {
  members: Array<Span & { member: number }>;
  own: Span[];
  /** Own and context words, and the same summed up. */
  contextSpans: Span[];
  context: SpanSummary;
  /** A path guard ruled the whole document out. */
  guarded: boolean;
  paths: PathHit[];
}

interface DocumentReading {
  words: string[];
  categories: Map<number, CategoryFindings>;
}

/** Reads one path or text for every category at once. */
function readDocument(text: string, kind: "path" | "prose"): DocumentReading {
  const categories = new Map<number, CategoryFindings>();
  const of = (category: number): CategoryFindings => {
    let findings = categories.get(category);
    if (!findings) categories.set(category, (findings = { members: [], own: [], contextSpans: [], context: emptySummary(), guarded: false, paths: [] }));
    return findings;
  };
  const words = vocabularyWords(text, kind);
  const found = findAll(words, DOC_INDEX);
  // Word positions each category's guards cover.
  const guarded = new Map<number, Set<number>>();
  for (const f of found) {
    if (f.entry.kind !== "guard") continue;
    let positions = guarded.get(f.entry.category);
    if (!positions) guarded.set(f.entry.category, (positions = new Set()));
    for (let i = f.start; i < f.end; i++) positions.add(i);
  }
  for (const f of found) {
    if (f.entry.kind === "guard") continue;
    const positions = guarded.get(f.entry.category);
    if (positions) {
      let hit = false;
      for (let i = f.start; i < f.end && !hit; i++) hit = positions.has(i);
      if (hit) continue;
    }
    const findings = of(f.entry.category);
    const span = { start: f.start, end: f.end };
    if (f.entry.kind === "member") findings.members.push({ ...span, member: f.entry.member! });
    else {
      addSpan(findings.context, span);
      findings.contextSpans.push(span);
      if (f.entry.kind === "own") findings.own.push(span);
    }
  }
  if (kind === "path") {
    const lower = text.toLowerCase();
    VOCABULARY.forEach((category, c) => {
      if (category.pathGuards?.some((guard) => guard.test(lower))) {
        if (categories.has(c) || category.paths) of(c).guarded = true;
        return;
      }
      const hits = category.paths?.(lower) ?? [];
      if (hits.length > 0) of(c).paths.push(...hits);
    });
  }
  return { words, categories };
}

/* ------------------------------------------------------------------ */
/* SOW wording                                                         */
/* ------------------------------------------------------------------ */

/** Words that pad an item without changing what it names: "all other integrations". */
const PADDING = new Set([
  "a", "an", "the", "all", "any", "other", "additional", "further", "extra", "alternative", "more", "new", "and", "or",
  "support", "supported", "functionality", "feature", "features", "of", "for", "with", "via", "our", "your", "its",
]);

export interface NamedCategory {
  category: VocabularyCategory;
  /** The words of the item that name it, so what is left over can be read as a qualifier. */
  spans: Span[];
  /** "multi" for "multi-language support": a qualifier the work must say to be the excluded kind. */
  qualifier?: string;
}

export interface ItemWording {
  words: string[];
  categories: NamedCategory[];
}

/** Which categories an SOW item (or one part of it) names, and where. */
export function categoriesNamedIn(text: string): ItemWording {
  const words = vocabularyWords(text, "prose");
  const found = findAll(words, NAME_INDEX);
  const guards = found.filter((f) => f.entry.kind === "guard");
  const content = words.filter((word) => word !== BOUNDARY && !PADDING.has(word));
  const byCategory = new Map<number, { plain: Span[]; qualified: Span[] }>();
  for (const f of found) {
    if (f.entry.kind === "guard") continue;
    if (guards.some((g) => g.entry.category === f.entry.category && overlaps(g, f))) continue;
    // A name that must be the whole item: "Integrations", not "integrations with Stripe".
    if (
      f.entry.flag === "exact" &&
      !(content.length === f.entry.words.length && content.every((word, i) => sameOrPlural(word, f.entry.words[i])))
    ) {
      continue;
    }
    let spans = byCategory.get(f.entry.category);
    if (!spans) byCategory.set(f.entry.category, (spans = { plain: [], qualified: [] }));
    (f.entry.flag === "qualified" ? spans.qualified : spans.plain).push({ start: f.start, end: f.end });
  }
  return {
    words,
    categories: [...byCategory].map(([c, { plain, qualified }]) => {
      // Qualified unless the item also names the category plainly elsewhere
      // ("translations and multi-language support" is two items anyway).
      const plainElsewhere = plain.some((span) => !qualified.some((q) => overlaps(q, span)));
      const qualifier = qualified.length > 0 && !plainElsewhere ? words[qualified[0].start] : undefined;
      return { category: VOCABULARY[c], spans: [...plain, ...qualified], ...(qualifier ? { qualifier } : {}) };
    }),
  };
}

/** The categories whose members count for `category`: itself and any it includes. */
function familyOf(category: VocabularyCategory): number[] {
  const family = [CATEGORY_INDEX.get(category.id)!];
  for (const id of category.includes ?? []) {
    const included = CATEGORY_INDEX.get(id);
    if (included !== undefined && !family.includes(included)) family.push(included);
  }
  return family;
}

/** Members a SOW text names, by category id and label: read once for every category. */
export type NamedMembers = Map<string, Set<string>>;

/**
 * The members a SOW text names. With `needContext`, an ambiguous member
 * counts only next to a context word of its category in the same run of the
 * text (between commas or brackets): "Includes product search by brand
 * (Apple, Samsung), email login" includes no Apple login.
 */
export function membersIn(text: string, needContext: boolean): NamedMembers {
  const named: NamedMembers = new Map();
  if (!text.trim()) return named;
  const { words, categories } = readDocument(text, "prose");
  // Each word's run, and per run and category, its context words.
  const runOf = new Int32Array(words.length);
  for (let i = 0, run = 0; i < words.length; i++) {
    if (words[i] === BOUNDARY) run++;
    runOf[i] = run;
  }
  for (const [c, findings] of categories) {
    const category = VOCABULARY[c];
    let contextByRun: Map<number, SpanSummary> | undefined;
    for (const hit of findings.members) {
      const member = category.members[hit.member];
      if (needContext && member.ambiguous && !member.plainInSow) {
        if (!contextByRun) {
          contextByRun = new Map();
          for (const span of findings.contextSpans) {
            let summary = contextByRun.get(runOf[span.start]);
            if (!summary) contextByRun.set(runOf[span.start], (summary = emptySummary()));
            addSpan(summary, span);
          }
        }
        const summary = contextByRun.get(runOf[hit.start]);
        if (!summary || !someOutside(summary, hit)) continue;
      }
      let labels = named.get(category.id);
      if (!labels) named.set(category.id, (labels = new Set()));
      labels.add(member.label);
    }
  }
  return named;
}

/** The members of `category` (and of the categories it includes) among `named`. */
export function membersOf(named: NamedMembers, category: VocabularyCategory): Set<string> {
  const labels = new Set<string>();
  for (const c of familyOf(category)) for (const label of named.get(VOCABULARY[c].id) ?? []) labels.add(label);
  return labels;
}

const allLabels = new Map<string, ReadonlySet<string>>();

/** Every member label of `category` and the categories it includes. */
export function allMembersOf(category: VocabularyCategory): ReadonlySet<string> {
  let labels = allLabels.get(category.id);
  if (!labels) {
    labels = new Set(familyOf(category).flatMap((c) => VOCABULARY[c].members.map((member) => member.label)));
    allLabels.set(category.id, labels);
  }
  return labels;
}

/** The variants (iOS, Android) an item narrows its category to, if it names some but not all. */
export function facetsNamedIn(text: string, category: VocabularyCategory): Set<string> | undefined {
  const all = new Set(category.members.flatMap((member) => member.facets ?? []));
  if (all.size === 0) return undefined;
  const named = new Set<string>();
  for (const label of membersOf(membersIn(text, false), category)) {
    for (const facet of category.members.find((member) => member.label === label)?.facets ?? []) named.add(facet);
  }
  return named.size > 0 && named.size < all.size ? named : undefined;
}

/** "save for Stripe": whether `text` starts with a vocabulary member, so "save for" before it is an exception. */
export function startsWithMember(text: string): boolean {
  const words = vocabularyWords(text.slice(0, 80), "prose").slice(0, 6);
  return findAll(words, DOC_INDEX).some((f) => f.start === 0 && f.entry.kind === "member");
}

/* ------------------------------------------------------------------ */
/* Pull request evidence                                               */
/* ------------------------------------------------------------------ */

export interface VocabularyDocument<T> {
  ref: T;
  text: string;
  kind: "path" | "prose";
  /** "code" for changed files, "title" for titles and branches, "text" for descriptions. */
  strength: "code" | "title" | "text";
  /** Documents read together: each changed file on its own, the titles and branch as one. -1 for descriptions. */
  group: number;
}

interface MemberHit<T> {
  doc: VocabularyDocument<T>;
  /** Built, and corroborated where it was found. */
  corroborated: boolean;
}

interface MemberEvidence<T> {
  label: string;
  facets?: string[];
  hits: MemberHit<T>[];
}

interface CategorySummary<T> {
  members: Map<string, MemberEvidence<T>>;
  /** Every member label found in each group (or, for a description, in that document). */
  labelsAt: Map<number | VocabularyDocument<T>, Set<string>>;
}

export interface VocabularyDecision<T> {
  strong: boolean;
  /**
   * Built and corroborated, but the pull request also works on what the item
   * leaves out or the SOW includes ("Apple Pay" with Stripe changes): it may
   * be that allowed work, so only a question.
   */
  nextToAllowed?: boolean;
  /** Labels of the members found, the ones that decided first. */
  members: string[];
  /** Where they were found, best first. */
  refs: T[];
}

export interface DecideOptions<T> {
  /** Members the item itself leaves out ("other than Stripe"): work next to them is about them, and not asked about. */
  excepted?: ReadonlySet<string>;
  /** Members the SOW includes elsewhere: never excluded, and work next to them is only a question. */
  included?: ReadonlySet<string>;
  /** Whether a document names the item's own exception in its words ("other than card payments"): members there are about it. */
  exceptionAt?: (ref: T) => boolean;
  /** The groups that name any of the item's exceptions, those it states or the members the SOW includes elsewhere. */
  allowedGroups?: ReadonlySet<number>;
  /** The variants the item names (iOS only): other variants are only a question. */
  facets?: ReadonlySet<string>;
  /** Only these members count ("not Apple" in an included item). */
  only?: ReadonlySet<string>;
}

const STRENGTH_RANK = { code: 0, title: 1, text: 2 } as const;
const NONE: ReadonlySet<string> = new Set();

/**
 * The vocabulary's view of one pull request: each document is read once, on
 * first use, and each category's members are summed up once.
 */
export class VocabularyEvidence<T> {
  private readonly readings = new Map<VocabularyDocument<T>, DocumentReading>();
  private readonly summaries = new Map<number, CategorySummary<T>>();

  constructor(private readonly docs: readonly VocabularyDocument<T>[]) {}

  private reading(doc: VocabularyDocument<T>): DocumentReading {
    let reading = this.readings.get(doc);
    if (!reading) this.readings.set(doc, (reading = readDocument(doc.text, doc.kind)));
    return reading;
  }

  /** Where a document's findings are read together: its group, or itself for a description. */
  private static place<T>(doc: VocabularyDocument<T>): number | VocabularyDocument<T> {
    return doc.group >= 0 ? doc.group : doc;
  }

  /** Each member of a category found in the pull request, with where and how well. */
  private summary(categoryIndex: number): CategorySummary<T> {
    const known = this.summaries.get(categoryIndex);
    if (known) return known;
    const family = familyOf(VOCABULARY[categoryIndex]);

    const found: Array<{ doc: VocabularyDocument<T>; member: VocabularyMember; span?: Span; dedicated?: boolean }> = [];
    // The category's own words per group, without words of a member's own
    // name ("pay" in "PayPal", "analytics" in "Google Analytics").
    const ownByGroup = new Map<number, Array<{ doc: VocabularyDocument<T>; own: SpanSummary }>>();
    for (const doc of this.docs) {
      const { categories } = this.reading(doc);
      const built = doc.strength !== "text";
      const covered = new Set<number>();
      for (const c of family) {
        const findings = categories.get(c);
        if (!findings || findings.guarded) continue;
        for (const hit of findings.members) for (let i = hit.start; i < hit.end; i++) covered.add(i);
        const members = VOCABULARY[c].members;
        for (const hit of findings.members) {
          const member = members[hit.member];
          // Descriptions only say what was talked about: a member there needs its context too.
          if ((member.ambiguous || !built) && !someOutside(findings.context, hit)) continue;
          found.push({ doc, member, span: hit });
        }
        for (const hit of findings.paths) {
          const member = members.find((m) => m.label === hit.member);
          if (!member || (hit.needsContext && findings.context.count === 0)) continue;
          found.push({ doc, member, dedicated: hit.dedicated });
        }
      }
      if (doc.group < 0) continue;
      // Only the named category's own words corroborate: "src/crm/salesforce.ts"
      // says CRM, not "third-party integration".
      const own = emptySummary();
      const findings = categories.get(categoryIndex);
      if (findings && !findings.guarded) {
        for (const span of findings.own) {
          let inName = false;
          for (let i = span.start; i < span.end && !inName; i++) inName = covered.has(i);
          if (!inName) addSpan(own, span);
        }
      }
      if (own.count === 0) continue;
      let list = ownByGroup.get(doc.group);
      if (!list) ownByGroup.set(doc.group, (list = []));
      list.push({ doc, own });
    }
    const corroboratedAt = (doc: VocabularyDocument<T>, hit?: Span) =>
      (ownByGroup.get(doc.group) ?? []).some((entry) => entry.doc !== doc || !hit || someOutside(entry.own, hit));

    const summary: CategorySummary<T> = { members: new Map(), labelsAt: new Map() };
    // One hit per member and document, however often the document names it.
    const hitOf = new Map<string, Map<VocabularyDocument<T>, MemberHit<T>>>();
    for (const { doc, member, span, dedicated } of found) {
      const built = doc.strength !== "text";
      let evidence = summary.members.get(member.label);
      if (!evidence) summary.members.set(member.label, (evidence = { label: member.label, facets: member.facets, hits: [] }));
      let byDoc = hitOf.get(member.label);
      if (!byDoc) hitOf.set(member.label, (byDoc = new Map()));
      let hit = byDoc.get(doc);
      if (!hit) {
        byDoc.set(doc, (hit = { doc, corroborated: false }));
        evidence.hits.push(hit);
      }
      if (!hit.corroborated) {
        hit.corroborated = built && !member.weakOnly && (member.clear === true || dedicated === true || corroboratedAt(doc, span));
      }
      const place = VocabularyEvidence.place(doc);
      let labels = summary.labelsAt.get(place);
      if (!labels) summary.labelsAt.set(place, (labels = new Set()));
      labels.add(member.label);
    }
    for (const evidence of summary.members.values()) {
      evidence.hits.sort(
        (a, b) => Number(b.corroborated) - Number(a.corroborated) || STRENGTH_RANK[a.doc.strength] - STRENGTH_RANK[b.doc.strength],
      );
    }
    this.summaries.set(categoryIndex, summary);
    return summary;
  }

  /** The members of `category` found where `ref` is read: its file, or the titles it is one of. */
  labelsAt(category: VocabularyCategory, ref: T): ReadonlySet<string> {
    const index = CATEGORY_INDEX.get(category.id);
    const doc = this.docs.find((d) => d.ref === ref);
    if (index === undefined || !doc) return NONE;
    return this.summary(index).labelsAt.get(VocabularyEvidence.place(doc)) ?? NONE;
  }

  /**
   * Whether the pull request builds a member of `category` that the item
   * doesn't leave out. Strong only when a member is built and corroborated
   * somewhere that names nothing the item leaves out and the SOW includes.
   */
  decide(category: VocabularyCategory, options: DecideOptions<T> = {}): VocabularyDecision<T> | undefined {
    const index = CATEGORY_INDEX.get(category.id);
    if (index === undefined) return undefined;
    const { excepted = NONE, included = NONE, exceptionAt, allowedGroups, facets, only } = options;
    const summary = this.summary(index);
    const near = (hit: MemberHit<T>, labels: ReadonlySet<string>) => {
      if (labels.size === 0) return false;
      for (const label of summary.labelsAt.get(VocabularyEvidence.place(hit.doc)) ?? []) if (labels.has(label)) return true;
      return false;
    };
    const candidates: Array<{ label: string; corroborated: boolean; best: number; hits: MemberHit<T>[] }> = [];
    for (const evidence of summary.members.values()) {
      if (only ? !only.has(evidence.label) : excepted.has(evidence.label) || included.has(evidence.label)) continue;
      // "mixpanel-plausible.ts" against "analytics other than Plausible": that file may be the allowed work.
      const hits = evidence.hits.filter((hit) => !near(hit, excepted) && !exceptionAt?.(hit.doc.ref));
      if (hits.length === 0) continue;
      const otherVariant = facets !== undefined && evidence.facets !== undefined && !evidence.facets.some((facet) => facets.has(facet));
      const corroborated = !otherVariant && hits.some((hit) => hit.corroborated && !near(hit, included));
      candidates.push({ label: evidence.label, corroborated, best: Math.min(...hits.map((hit) => STRENGTH_RANK[hit.doc.strength])), hits });
    }
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => Number(b.corroborated) - Number(a.corroborated) || a.best - b.best);
    const corroborated = candidates[0].corroborated;
    const deciding = corroborated ? candidates.filter((c) => c.corroborated) : candidates;
    const refs: T[] = [];
    for (const candidate of deciding) {
      for (const hit of candidate.hits) if ((!corroborated || hit.corroborated) && !refs.includes(hit.doc.ref)) refs.push(hit.doc.ref);
    }
    // Anywhere the pull request builds (a file, or the titles), does it also work on allowed members?
    let nextToAllowed = false;
    if (corroborated) {
      nextToAllowed = (allowedGroups?.size ?? 0) > 0;
      for (const [place, labels] of summary.labelsAt) {
        if (nextToAllowed) break;
        if (typeof place !== "number") continue;
        for (const label of labels) if (excepted.has(label) || included.has(label)) nextToAllowed = true;
      }
    }
    return { strong: corroborated && !nextToAllowed, ...(nextToAllowed ? { nextToAllowed } : {}), members: deciding.map((c) => c.label), refs };
  }
}
