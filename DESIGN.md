# ScopeCI design system

This document sets the visual and interaction rules for ScopeCI's frontend (`artifacts/scopeci`). It records the rules the code follows. Read it before changing any page or component.

Every rule is tagged:

- **[Existing]**: already true in the code. Keep it unless a proposal below replaces it.
- **[Proposed]**: not yet implemented. Move it to [Existing] in the change that builds it.

It began as an audit of the repository on 27 October 2026; section 0 keeps those findings. Every proposal from that audit has been applied (28 October 2026) and is now tagged [Existing].

---

## 0. Audit summary

### What ScopeCI is (and is not)

ScopeCI checks each pull request against the statement of work (SOW) an agency's client signed.

- **The SOW.** A person pastes the SOW. ScopeCI reads it into a checklist of what each clause includes and excludes, and the person corrects and saves it as a versioned scope.
- **The check.** On every pull request, a rule-based evaluator compares the work with that scope. It reads the pull request's title, branch, description and changed file names. It never checks out or runs code, and **no language model is involved**.
- **The result.** The answer is posted as a GitHub check and one comment. The possible results are: in scope, needs a decision, change order needed, covered by an approved change, excluded work, or overridden.
- **Change orders.** For out-of-scope work, ScopeCI drafts a change order that the PM edits, sends and tracks to the client's answer.
- **Policies.** Each project picks one: report only, ask for a decision, or fail the check.

Facts the interface must never contradict:

| Fact | Source |
| :-- | :-- |
| The check is plain rules. No AI model reads the contract or the code. | README, evaluator |
| It works with GitHub only. No GitLab, Bitbucket or Jira. | README, FAQ |
| The Linear integration runs on stand-ins (no real token exchange): in production its connect, callback and sync routes answer 503, and live checks read no issues (`NoIssueProvider` in `routes/github.ts`). The site doesn't mention Linear. | README, `routes/github.ts` |
| Hours and prices appear only when an estimate exists (from a linked issue or typed by a person). ScopeCI never invents one. | `docs/github-app.md` |
| GitHub permissions: pull requests and checks (read and write), contents and metadata (read). | `docs/github-app.md` |
| Status is a pilot: free, with no price yet, no customers to cite and no accuracy figures. | README, FAQ |

### Stack

| Area | What the repository uses |
| :-- | :-- |
| Workspace | pnpm 10 monorepo, TypeScript 5.9 |
| Frontend | `artifacts/scopeci`: React 19 and Vite 7, client-side rendered |
| Routing | wouter 3 (`src/App.tsx`); `/app` is a nested router |
| Data | TanStack Query 5 with an orval-generated client from `lib/api-spec/openapi.yaml` |
| Styling | Hand-written CSS in `src/styles/*.css` (tokens, base, chrome, landing, product, pages) imported by `src/index.css`. Tailwind v4 is loaded through `@tailwindcss/vite` for its preflight reset only; no utility classes are used. |
| Theme | `next-themes` (class strategy) plus an inline script in `index.html` that sets `.dark` or `.light` before first paint. Default: follow the system. |
| Fonts | Google Fonts: **Newsreader** (variable, 400–600 with italics), **Geist** (400/500/600), **Geist Mono** (400/500). The CSP and the privacy policy both name Google Fonts. |
| Icons | **Hugeicons** free stroke set (`@hugeicons/react` and `@hugeicons/core-free-icons`, MIT) through `src/icons.tsx` only. The GitHub mark comes from `react-icons/si` through `VendorMark`. |
| Dialogs | `@radix-ui/react-dialog` for the change-order panel; `@radix-ui/react-alert-dialog` for confirmations (`src/components/confirm-dialog.tsx`) |
| Motion | CSS transitions and keyframes, plus small helpers in `src/motion.ts` (`useInView`, `useTimeline`, `useReveal`, `usePointerTilt`, `useIndicator`, `withViewTransition`) and the browser's View Transitions API. |
| Hosting | Render serves the API and the built site from one Node service (`render.yaml`). `vercel.json` exists, but no Vercel project is connected. |
| Removed on 28 October 2026 | The unused shadcn/ui kit (55 files in `src/components/ui`) and the packages only it used: `lucide-react`, `framer-motion`, `recharts`, `embla-carousel-react`, `vaul`, `sonner`, `cmdk`, `input-otp`, `react-day-picker`, `react-hook-form`, `date-fns`, `react-resizable-panels` and the other Radix primitives |
| Other artifact | `artifacts/mockup-sandbox`: a Vite component-preview sandbox. It is not deployed and not covered by this document. |

### Page map

| Kind | Route | File |
| :-- | :-- | :-- |
| Marketing | `/` | `src/pages/home.tsx`, plus `src/landing/*` (hero stage, product tour, creep chart, policy demo) |
| Legal | `/terms`, `/privacy`, `/security` | `src/pages/{terms,privacy,security}.tsx`, built on `src/components/legal-page.tsx`; their facts (operator, processors, retention) live in `src/legal.ts` |
| Marketing | `/contact`: the contact form (no email address is published) | `src/pages/contact.tsx` |
| Marketing and tool | `/try`: the public demo, which runs the real check without an account | `src/pages/try.tsx` |
| Marketing | Any unknown route (404) | `src/pages/not-found.tsx` |
| Application | `/app` (sign-in, projects, new project, project, team, invite) | `src/pages/app.tsx` |
| Internal | `/admin`, `/admin/waitlist` | `src/pages/admin.tsx` |

Shared code:

- **`src/site.tsx`**: paths, analytics (`track`), `usePageMeta`, `VendorMark`, `Logo`, `ThemeToggle`, `ThemeSwitch`, `Navbar` and `Footer`.
- **`src/scope-ui.tsx`**: `ScopeEditor`, `ItemList`, `ChangeOrderBox`, the `VERDICT` labels and `errorMessage`.
- **`src/icons.tsx`**, **`src/motion.ts`** and **`src/components/confirm-dialog.tsx`** (`useConfirm`).
- **`src/styles/tokens.css`**, **`base.css`** and **`chrome.css`**.

### Assets

- **`public/assets/logo-icon.png`** (288×270): the green 3D ribbon "S" mark, used in the header, footer and app.
- **`logo-with-bg-and-wordmark.png`**: the Open Graph image.
- **`logo-wordmark.png`**: now **unused**. The wordmark is live text, so it follows the theme.
- **`brand/*.png`**: high-resolution originals.
- **`public/favicons/*`**: the favicons.
- **`public/product/*.webp`**: 16 real app screenshots taken with a sample workspace. There are four views (results, scope, projects, try), each in light and dark, at desktop and phone size.

There are no illustrations or SVG files. Every diagram on the site is HTML and CSS: the hero stage, the evidence ledger, the merge box, the change-order letter and the creep chart.

### Main inconsistencies found

All nineteen were resolved on 28 October 2026. The list is kept as the record of why the rules below exist.


1. **Type sizes.**
   - The CSS declares 31 different `font-size` values, including half-pixel sizes (9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5).
   - The `--t-*` scale tokens are used in only about a dozen places.
2. **Font weights.**
   - The CSS uses 450, 550 and 650, but Geist is requested only at 400/500/600/700, so the browser snaps to the nearest loaded weight.
   - Newsreader's variable range covers 450, so its use there is fine.
3. **Spacing.**
   - The CSS has about 30 distinct px values for padding, margin and gap; 10, 14, 18 and 22px are among the most common and sit off any rhythm.
   - There are no spacing tokens.
4. **Radius.** Radius tokens exist, but 21 declarations still use raw values: 1, 3, 4, 5, 8, 12, 14, 18 and 24px.
5. **Breakpoints.**
   - The CSS uses 11 different `max-width` values: 400, 480, 520, 639, 640, 720, 899, 900, 960, 1020 and 1100px.
   - Some are near-duplicate pairs (639/640, 899/900).
6. **Page-named classes used as shared components.** `/app` reuses `try-*` classes 49 times: `try-step`, `try-help`, `try-link`, `try-notice`, `try-textarea`, `try-inline`, `try-row` and `try-lede`.
7. **Status colours.**
   - There is no informational token. Neutral states are styled ad hoc.
   - The contract highlighter (`--highlight`) and the warning wash are both amber and look alike.
   - `#06120d` is hard-coded three times for text on the brand colour in dark mode.
   - The CTA panel uses a raw hex gradient.
8. **The error boundary isn't themed.** It uses Tailwind gray utilities, so it shows a light grey screen in dark mode.
9. **Two confirmation patterns.** Destructive actions use `window.confirm`: archive project, remove member, forget the GitHub App, remove a signup. Change orders use a designed side panel.
10. **Headings have no shared scale.**
    - At least ten bespoke heading styles exist: `section-title`, `try-step-head h2`, `app-page-head h1`, `page-title`, `legal-title`, `missing-title`, `drawer-title`, `settled h3`, `app-onboarding h2` and `project-card-name`.
    - The serif appears in marketing, the app, card names and the mobile menu without one rule for when.
11. **Shadows.** There are three shadow tokens plus 11 one-off `box-shadow` values. Most are hairline rings or focus rings; two are real drop shadows: the primary button's inset highlight and the CTA mark.
12. **Motion is heavier than the product needs.**
    - Every landing section fades in on scroll, and the product tour also tilts with the scroll.
    - The hero tilts toward the pointer, and the creep chart switches itself after 2.6 seconds.
    - Durations use 22 different values, from 160ms up to 1.8s (the chart's draw).
13. **Unused dependencies**, listed in the stack table. They are tree-shaken out of the bundle but still installed and audited.
14. **Header heights differ.** The marketing header is 64px; the app header is 60px.
15. **Four link styles**: `.text-link`, `.try-link`, `.app-back` and plain nav links.
16. **Repeated section template.**
    - The landing page builds eight sections the same way: numbered kicker, serif H2, lede, then a visual.
    - Four of them use the same two-column split.
17. **Illustrative numbers.**
    - The creep chart (320h quoted, 410h delivered) and the hero (14h, $2,100) use invented example figures.
    - Both are labelled as illustrative or sample, and must stay labelled.
18. **Copy accuracy to check.** "How it works", the principles list and the FAQ say ScopeCI reads "the linked Linear issue". The README says Linear is not yet connected per workspace. (Confirmed: production uses `NoIssueProvider`. The copy now names only the title, branch, description and file names.)
19. **Tiny type in illustrations.** The hero stage uses 9–10.5px mono. It is `aria-hidden`, but it sits below the product's minimum size.

---

## 1. Product design principles

1. **Show the boundary.** Every screen that discusses a pull request shows two things side by side or in sequence: the scope (clause text, included and excluded) and the work (title, branch, files). The finding is the line that joins them.
2. **Lead with the why.** A result's first readable line is its reason. It names the clause and the excluded work ("§4.2 User authentication excludes Organization roles, Team invitations"). It is never a score, a colour or a badge on its own. **[Existing]** since the why line on `app-why-banner-co-panel`.
3. **One next action.** Each finding ends with the action available, for example *Open change order*, *Mark as sent* or *Client approved*. Don't show actions that do nothing.
4. **Two voices, two typefaces.**
   - **The contract voice:** the client's document and the letters written to the client. It is set in the serif.
   - **The tool voice:** everything a developer or PM operates. It is set in the sans and mono.
   - Readers should always be able to tell which voice they are reading.
5. **Real data or labelled samples.** Show only ScopeCI's real outputs: verdict labels, the reason format, the change-order letter as the engine writes it, the policy names. Examples use credible engineering detail (`src/middleware/rbac.ts`, `feature/org-permissions`). Any invented figure is labelled ("Sample workspace", "illustrative").
6. **Calm by default.** The interface is quiet until something needs a decision: warm paper, hairlines and ink. Colour is reserved for status and the one brand colour.
7. **Precision over decoration.** Alignment, rules, type and real content carry the design. Nothing on the page exists only to look "designed".

---

## 2. Typography

### Decision

**[Existing, retained]** Display: **Newsreader**. Body and UI: **Geist**. Code and metadata: **Geist Mono**.

Space Grotesk, IBM Plex Sans and IBM Plex Mono were considered and rejected:

- **The current set already does the job.** It covers the editorial and technical direction this brief asks for:
  - A serif carries the contract and the headlines.
  - A precise grotesk carries the interface.
  - A mono carries paths and references.
  - It is already loaded, allowed by the CSP and named in the privacy policy.
- **Space Grotesk** is among the most common choices in template-built startup sites. Its quirky geometry would also compete with the serif.
- **IBM Plex** is excellent, but switching would mean re-tuning every size for no gain in clarity. Plex Mono is also wider than Geist Mono, which costs width in dense file lists.

None of the three is Inter, Roboto, Open Sans, Arial or system-ui. `system-ui` appears only as a fallback.

### Font stacks [Existing]

```css
--font-display: 'Newsreader', 'Iowan Old Style', 'Source Serif Pro', Georgia, serif;
--font-sans: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono: 'Geist Mono', ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace;
```

- Google Fonts loads with `display=swap`, so text renders immediately in the fallback.
- The fallbacks are chosen to keep similar widths.
- `font-synthesis-weight: none` stops the browser from faking bold weights.
- **[Existing]** Only the weights in use are requested: Geist 400;500;600 and Geist Mono 400;500.

### Where each typeface may appear

| Typeface | Use for | Never use for |
| :-- | :-- | :-- |
| Newsreader | Marketing H1 and H2; app page titles; the panel title; SOW excerpts, clause titles and change-order letters (the contract voice) | Buttons, labels, form fields, tables, navigation, chips, numbers in data |
| Geist | All interface text: body, labels, buttons, nav, help, table cells, panel headings | Quoted contract text |
| Geist Mono | File paths, branches, clause references (`§4.2`), change-order references (`CO-007`), shas, timestamps in metadata rows, code and comment previews | Running prose, headings |

**[Existing]** The mobile menu links are 20px Geist 500 (`--t-clause`), because navigation is the tool voice.

### Scale [Existing]

Base is 16px. Each role is a token; components use tokens, never raw sizes.

| Token | Typeface | Size | Line height | Tracking | Weight | Use |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `--t-hero` | Newsreader | clamp(40px, 1.35rem + 3.1vw, 68px) | 1.04 | -0.018em | 450 | Landing H1 only |
| `--t-display` | Newsreader | clamp(34px, 1.45rem + 2.7vw, 56px) | 1.06 | -0.018em | 450 | Marketing section H2; the privacy and 404 H1 |
| `--t-display-m` | Newsreader | clamp(28px, 1.3rem + 1.4vw, 40px) | 1.1 | -0.015em | 450 | App page H1 (project name, "Projects", "Team"); panel title |
| `--t-display-s` | Newsreader | 24px | 1.15 | -0.015em | 450 | The side panel title; the onboarding heading; legal H2; the 404 paper title; the waitlist success heading |
| `--t-clause` | Newsreader | 20px | 1.3 | -0.01em | 500 | Clause titles in scope views; project card names; the ledger's contract subject. Also the mobile menu links, set in Geist 500. |
| `--t-title` | Geist | 18px | 1.35 | -0.02em | 600 | Panel headings in the app ("Scope", "Checked pull requests"); step titles |
| `--t-subtitle` | Geist | 16px | 1.4 | -0.012em | 600 | Pull request titles in rows; card titles; FAQ questions on mobile |
| `--t-lede` | Geist | clamp(17px, 1rem + 0.25vw, 19px) | 1.6 | -0.01em | 400 | Intro paragraph under an H1 or H2 |
| `--t-body` | Geist | 16px | 1.6 | -0.005em | 400 | Reading text: marketing prose, FAQ answers, legal |
| `--t-ui` | Geist | 14px | 1.5 | 0 | 400 or 500 | Default app interface text: help, labels (500), table cells, why line detail |
| `--t-caption` | Geist | 13px | 1.45 | 0 | 500 | Chips, table headers, legends, notes under visuals |
| `--t-micro` | Geist | 12px | 1.4 | 0 | 500 | **Minimum for real interface text.** Axis labels, legal metadata. |
| `--t-code` | Geist Mono | 13px | 1.6 | 0 | 400 | Paths, branches, comment previews, SOW textarea |
| `--t-code-s` | Geist Mono | 12px | 1.5 | 0 | 400 or 500 | Inline metadata: `§4.2`, `CO-007`, `open · checked 3 h ago` |
| `--t-figure` | Geist or Geist Mono | 11px | 1.4 | 0 | 400 or 500 | **Only inside `aria-hidden` mockups** drawn in HTML: the hero stage's PR bar, file rows and verdict facts |
| `--t-figure-xs` | Geist or Geist Mono | 10px | 1.4 | 0 | 400 or 500 | The same mockups' smallest labels (SOW header, signature line, footnote markers). Nothing on the site is smaller. |

Rules:

- **Large jumps, not small ones.** A heading sits at least two steps above the text under it. Never put an 18px heading over 16px body.
- **Tracking tightens as size grows:** -0.018em at display sizes, -0.02em for 18px Geist titles, 0 at 14px and below. Mono is always 0.
- **Line length:** prose ≤ 68ch; ledes ≤ 54ch; legal ≤ 66ch.
- **Weights:**
  - Geist uses 400 (text), 500 (labels, chips, nav) and 600 (titles, emphasis). The weights 450, 550 and 650 are not used with Geist. **[Existing]**: none remain.
  - Newsreader uses 450 and 500. Its italic is reserved for SOW labels ("Explicit exclusions") and signatures.
- **Numerals:** use `font-variant-numeric: tabular-nums` (the `.num` class) for counts, money and hours that change or line up in columns.
- **Text wrapping:** `text-wrap: balance` on headings and `text-wrap: pretty` on paragraphs. **[Existing]**
- **Case:** no all-caps labels. **[Existing]**: there are no `text-transform: uppercase` rules.
- **Headings must not all look alike.**
  - A marketing H2 is a large serif.
  - An app panel heading is an 18px Geist title.
  - A clause title is a 20px serif.
  - A row title is a 16px Geist subtitle.
- **Illustrations:** product mockups drawn in HTML may go down to 10px mono, only when they are `aria-hidden` and carry a text alternative. **[Existing]** These use `--t-figure` and `--t-figure-xs`.

---

## 3. Colour

### Identity

**[Existing, retained]** The identity comes from the logo's forest greens on warm paper, with near-black green-tinted ink:

- **Brand:** forest green. It is the one dominant brand colour.
- **Accent:** **Marker**, the highlighter on the contract. It is the one controlled accent.
- **Status colours** are separate from both.

A **signal lime** accent was considered and rejected:

- The brand already owns green, so lime would read as a second "OK" green.
- That would blur the in-scope meaning.
- Lime also has too little contrast to be used as text on warm paper.

Marker yellow suits the product better. It shows something specific to ScopeCI: a clause being highlighted in the contract.

### Tokens

All colours are CSS custom properties on `:root`, swapped under `.dark`. `.on-dark` lends the dark set to one panel on a light page. Components never use raw colour values.

#### Grounds and ink [Existing]

| Token | Light | Dark | Use |
| :-- | :-- | :-- | :-- |
| `--bg` | `#f6f4ef` | `#0a0f0d` | Page background |
| `--bg-raised` | `#fcfbf8` | `#111814` | Panels, cards, header on scroll, menus |
| `--bg-sunken` | `#eeece5` | `#070a09` | Wells, table headers, the selected segment's track, code previews |
| `--bg-hover` | ink at 4% | paper at 5% | Hover fill on quiet controls and rows |
| `--paper` | `#fffdf8` | `#141b17` | **The contract voice only:** SOW excerpts, change-order letters, the SOW textarea |
| `--paper-edge` | `#e7e2d6` | `#253029` | Border of paper surfaces |
| `--fg` | `#111714` | `#e9eee9` | Primary text and headings |
| `--fg-2` | `#2c3631` | `#c9d3cc` | Secondary text inside components |
| `--fg-muted` | `#4f5b53` | `#9aa89f` | Help text, ledes, metadata (6.5:1 or better on `--bg`) |
| `--fg-faint` | `#636d65` | `#808e84` | Smallest metadata, placeholders, axis labels. At least 4.5:1, so it is still readable. |
| `--line` | ink at 9% | paper at 8% | Default hairline: dividers, row separators |
| `--line-2` | ink at 15% | paper at 14% | Control borders, panel borders |
| `--line-3` | ink at 26% | paper at 24% | Hover borders, emphasis rules |

#### Brand [Existing]

| Token | Light | Dark | Use |
| :-- | :-- | :-- | :-- |
| `--brand` | `#0d5c48` | `#78c9a1` | Links, completed steps, the "CI" in the wordmark, brand-tinted icons. Also the success colour. |
| `--brand-ink` | `#073c31` | `#a6e0c2` | Brand text on brand washes when extra weight is needed |
| `--brand-bright` | `#3f8a68` | `#78c9a1` | Non-text marks only: chart ticks, focus ring, selection tint. **Not for small text in light mode (3.8:1).** |
| `--brand-wash` / `--brand-line` | tint / 32% | tint / 34% | Background and border of brand-toned containers |
| `--button-bg` / `--button-fg` | `#0b2a22` / `#f6f4ef` | `#e9eee9` / `#08100c` | Primary button only (14:1 and 16:1) |
| `--focus` | `#3f8a68` | `#78c9a1` | Focus outline |

#### Accent: Marker [Existing]

| Token | Light | Dark | Use |
| :-- | :-- | :-- | :-- |
| `--marker` | `rgba(242, 212, 48, 0.5)` | `rgba(242, 212, 48, 0.26)` | Highlight behind **contract text** the current finding is about, such as the excluded items in the hero, and the text selection colour. Ink on marker: 14.7:1 (light), 7.6:1 (dark). |

It replaced the amber `--highlight`, which blended over paper to `#f7deab`, too close to the warning wash (`#f5ecd6`). The lemon (blended `#f8e994`) keeps "this is quoted contract text" apart from "this needs a decision".

Marker rules:

- Use it only as a background behind serif contract text, or for selection.
- Never use it on buttons, borders, status, charts or decoration.
- At most one marked passage per finding.

#### Status [Existing]

| Token | Light | Dark | Meaning in ScopeCI |
| :-- | :-- | :-- | :-- |
| `--success` (= `--brand`) | `#0d5c48` | `#78c9a1` | In scope; covered by an approved change; approved; done |
| `--warning` | `#87601a` | `#e3bf7b` | Needs a decision; sent and waiting on the client; action required |
| `--error` | `#a14a31` | `#eb9f84` | Change order needed; excluded work; failed check; declined; destructive actions; form errors |
| `--info` | `#2b5674` | `#8fbad9` | Neutral system notices: "Sign-in isn't switched on for this server yet", "Nothing is marked as included or excluded yet" |
| `--neutral` | `--fg-muted` | `--fg-muted` | Report-only neutral check, "not sent yet", drafts |

The old names `--ok`, `--warn`, `--alert` and `--highlight` no longer exist. Tone classes on components keep their short names: `is-ok`, `is-warn`, `is-alert`.

- Each status has `-wash` (fill) and `-line` (border) variants. Info uses `--info-wash: #e4ecf1` and `--info-line: rgba(43, 86, 116, 0.3)` in light mode, and the info colour at 11% and 34% in dark mode.
- Contrast:
  - Info text: 7.1:1 on the background and 6.5:1 on its wash (light); 9.4:1 and 7.2:1 (dark).
  - Error text on its wash: 4.9:1 (light).
  - Warning text on its wash: 4.8:1 (light).

#### On-colour and utility tokens [Existing]

| Token | Light | Dark | Use |
| :-- | :-- | :-- | :-- |
| `--on-brand` | `--bg-raised` | `#06120d` | Text on a solid brand fill: done step numbers, progress numbers, the merged button |
| `--mark-tile` | `#f6f4ef` | `#f6f4ef` | The light tile behind the logo mark on a dark ground (the closing CTA) |
| `--scrim` | ink at 34% | black at 60% | The overlay behind the side panel and confirmation dialogs |

No status colour is used as a solid fill, so there is no on-status token.

### Usage rules

- **One brand colour per view.** Forest is the only brand colour.
- **Status colours mean status.** They never decorate, and a red or amber accent is never used "for energy".
- **Colour never works alone.** Every status shows its words ("Change order needed") and, where it fits, a glyph. Colour reinforces the meaning; it never carries it by itself.
- **Washes are for containers that carry status:** why lines, chips, error boxes, matched file rows. Do not wash whole sections.
- **Gradients:**
  - **[Existing]** None fill a surface. The CTA ground is flat `--bg-raised` under `.on-dark`; the only gradients left are the masks that fade the hero guides and the CTA's ruled lines.
  - Never use gradient text, colourful gradients, or purple or indigo anywhere.
- **Shadows:**
  - **[Existing]** There are three tokens: `--shadow-1` (resting controls), `--shadow-2` (raised panels) and `--shadow-3` (floating: the side panel, hero cards, screenshot frames).
  - Hairline and focus rings drawn with `box-shadow` count as borders and may stay.
  - **[Existing]** There are no one-off drop shadows: the primary button uses `--shadow-1` and the CTA mark `--shadow-2`. A component uses at most one shadow level.
  - There are no coloured shadows and no glows.

---

## 4. Spacing and layout

### Spacing scale [Existing]

The rhythm is 8px, with 4px and 12px allowed as half-steps inside dense components.

| Token | Value | Typical use |
| :-- | :-- | :-- |
| `--space-1` | 4px | Icon to text in chips; gaps in tight inline groups |
| `--space-2` | 8px | Icon to label in buttons; field label to input; between chips |
| `--space-3` | 12px | Row padding in dense lists; gaps between buttons |
| `--space-4` | 16px | Gaps between form fields; panel-to-panel gap in the app; mobile panel padding |
| `--space-5` | 24px | Desktop panel padding; page head to first panel |
| `--space-6` | 32px | Between groups inside a section |
| `--space-7` | 48px | Section head to section content |
| `--space-8` | 64px | Mobile section padding |
| `--space-9` | 96px | Desktop section padding (marketing) |
| `--space-10` | 128px | Desktop section padding (hero and closing CTA) |

Padding, margins and gaps use these tokens, including inside `clamp()` and `calc()`. Off-rhythm values were snapped to the nearest step; a tie went up for padding and down for gaps and margins. Offsets of 3px or less are optical alignment, not spacing, and stay literal. Control heights stay at 36, 44 and 50px; those are touch-target sizes, not spacing.

### Widths [Existing values, now named]

| Measure | Value | Used by |
| :-- | :-- | :-- |
| `--max` | 1200px | Marketing container |
| App container | 1040px | `/app` header and content |
| /try container | 1100px | Demo layout (200px progress rail plus the step column) |
| Legal and reading | 760px | Privacy sections; prose ≤ 68ch |
| Forms | ≤ 640px | New project, settings rows |
| Side panel | `min(580px, 100vw)` | Change order panel |
| `--gutter` | clamp(20px, 4vw, 40px) | Page side margins |
| `--header-h` | 64px | Marketing, app and admin headers |

### Composition

- **Asymmetric splits, not equal columns.** Marketing sections that pair text with a visual use about 0.8fr / 1.2fr. **[Existing]** No equal-width card grids.
- **Vary the section shapes.** No more than two consecutive sections may share the same layout.
  - **[Existing]** Full-width visuals (product tour, how it works, evidence ledger) alternate with splits. Principles is stacked: the head above a two-column ledger of terms. So no three splits run in a row.
  - **[Existing]** Kickers name only the four sections the header links to (Product, How it works, Policies, Questions), without numbers. The other sections open on their headline.
- **App screens are a single reading column.**
  - Panels stack in a workflow order: scope, then repository, then checked pull requests, then settings.
  - Comparisons (included against excluded; contract against pull request) sit side by side when the width allows. Nothing else does.
- **Negative space marks hierarchy.** There is more space above a heading than below it. Related items sit closer together than unrelated ones.

---

## 5. Responsive rules

### Breakpoints [Existing]

Use these four widths, as max-width media queries one pixel below each. CSS can't read custom properties in media queries, so treat these numbers as constants.

| Name | Width | What changes at or below it |
| :-- | :-- | :-- |
| `xl` | 1280px | Nothing below it; above it the container stops growing |
| `lg` | 1024px | Primary nav collapses into the menu button. The hero goes to a single column. Marketing splits stack. Policy, principles and FAQ go to one column. The /try rail becomes a sticky horizontal bar. The project grid goes to one column. |
| `md` | 720px | The hero 3D stage flattens into stacked cards. Phone screenshots replace desktop ones. Header sign-in and CTA hide (the menu holds them). Two-column form rows stack. The scope include/exclude columns stack. Panel padding drops to 16px. The side panel goes full width. |
| `sm` | 480px | The evidence trace runs vertically. The app header hides the wordmark text and the avatar. |

The CSS uses `max-width: 479px`, `719px` and `1023px`, and `site.tsx` closes the menu at `min-width: 1024px`. A component may need a different width only when its content truly requires it, and the reason must be written in a comment next to the rule. The hero is the one case: it needs about 1100px for two columns, and the sections that share its split stack with it.

### Per device

- **Mobile (< 720px)**
  - Gutter 20px. Single column.
  - Tap targets at least 44px for primary actions and 36px for secondary ones.
  - No hover-only information. No 3D transforms.
  - Tabs scroll sideways with no visible scrollbar.
  - The side panel covers the screen; its actions stay pinned at the bottom.
- **Tablet (720–1023px)**
  - Gutter about 28–40px. Single-column hero.
  - Two columns only for paired comparisons.
  - The navigation sits behind the menu button.
- **Desktop (≥ 1024px)**
  - Full navigation and asymmetric splits.
  - The /try progress rail is a sticky left column.
  - The hero stage may use its 3D pose and pointer tilt.

---

## 6. Component conventions

Shared rules for all components:

- **Borders:** 1px hairlines using `--line` through `--line-3`.
- **Radius scale:**
  - `--radius-xs` 4px: step numbers, chips, small marks.
  - `--radius-s` 6px: inputs, small buttons, notices, why lines.
  - `--radius` 8px: buttons, segmented controls.
  - `--radius-l` 12px: panels and frames.
  - Paper surfaces use 4px, so they read as paper.
  - **[Existing]** No raw radii remain, apart from `50%` on avatars and the spinner.
- **No pills and no circles.** The only round elements are avatars, native radio buttons and the spinner. **[Existing]**
- **States:** every interactive element defines its rest, hover, focus-visible, active, disabled and (where relevant) selected or invalid states with the tokens below.

### Navigation [Existing]

- **Marketing header**
  - Fixed, 64px high, transparent at the top of the page.
  - Once the page scrolls, it gets a `--line` bottom border and an 82% `--bg` frosted ground.
  - Contents: logo, then text links (Product, How it works, Policies, Try it, Questions), then the theme toggle, *Sign in* and the primary button *Join the pilot*.
  - Below `lg`, a menu button opens a full-height panel. The panel closes on Escape and when the window widens.
- **App header**
  - Sticky.
  - Contents: logo, workspace switcher (a native select with a custom chevron), nav (Projects, Team) with the active page on a sunken fill, then the theme toggle, avatar and *Sign out*.
- **Active state:** a `--bg-sunken` fill plus `--fg` text. Never a coloured underline and a fill together. In the app nav the fill is one shared mark that slides to the new page (see *Selection that moves* in section 7).
- **Page changes:** an in-app link fades the old page out and the new one in, starting at the top of the page; both headers stay still.
- **Footer:** brand plus three link columns (Product, ScopeCI, Legal), then a bottom row with ©, who runs ScopeCI and where, and the three-way theme switch. The app has its own one-line footer with the legal links.
- **Legal pages:** one format for all three, from `legal-page.tsx`:
  - a header with the serif title, the update date and a "short version" summary on paper;
  - a sticky contents list that marks the section being read, with a 2px reading-progress line; below `lg` it becomes a picker pinned under the header;
  - numbered sections whose mono number is the section's own link; plain paragraphs and lists; one callout per section at most (a `--brand` left rule); fact tables that turn into labelled blocks on phones;
  - a "Read next" row of the other legal pages, so no page is a dead end.

### Buttons [Existing]

| Variant | Look | Use |
| :-- | :-- | :-- |
| `button-primary` | `--button-bg` fill, `--button-fg` text, `--shadow-1` | The one main action in a view region: "Try it on your SOW", "Read the scope", "Mark as sent", "Save settings" |
| `button-secondary` | `--bg-raised`, `--line-2` border, `--shadow-1` | The alternative action beside a primary one |
| `button-quiet` | Transparent, `--line-2` border | Supporting actions: "Copy", "Update the draft", "Disconnect", "Client approved" |
| `button-quiet button-danger` | Quiet, with `--error` text and a red wash on hover | Destructive or negative actions: "Client declined", "Remove", "Forget this App" |

- Sizes: `sm` 36px, default 44px, `lg` 50px.
- Labels are verbs that name the result ("Check this pull request", not "Submit").
- An arrow icon goes on the trailing side only for forward navigation, and nudges 3px on hover.
- Busy state: the label changes ("Saving…", "Checking…") and the button is disabled. A spinner appears only for actions longer than about 300ms.
- At most one primary button per view region.

### Links

- **[Existing]** `.text-link` is brand coloured, with a 1px `--brand-line` underline offset 3px that becomes solid on hover.
- **[Existing]** A button styled as a link uses `.text-link` too; as a button it sits at `--t-ui`, 12px from its neighbour.
- `.app-back` is a quiet "← Projects" control.
- External links carry the `ExternalIcon` at 12–13px.

### Inputs and forms [Existing]

- **Field layout:** label above the input (Geist 500, 14px). An optional hint goes inline in `--fg-faint` ("optional", "priced at $150 an hour").
- **Input:** 44px high, `--input-bg` ground, `--line-2` border, `--radius-s` corners. Text is 16px, so phones don't zoom on focus.
- **Focus:** the border becomes `--brand-bright` and a 1px ring is added; the global 2px focus outline still applies for keyboard users.
- **Errors:**
  - A field error is a sentence under the field (`--error`, 13px), wired up with `aria-invalid` and `aria-describedby`.
  - A form-level error is a box with `--error-wash` and `role="alert"`.
- **Textareas:**
  - Code-like input (the SOW, changed files) uses mono 13px. The SOW sits on `--paper` with a faint red margin rule.
  - The letter textarea uses the serif.
- **Spacing:** 16px between fields, 8px from label to input.
- **[Existing]** Shared helpers have neutral names: `panel`, `panel-head`, `help`, `notice`, `textarea`, `inline-field`, `field-row` and `page-lede`. Only pieces that belong to the demo keep a `try-` prefix.

### Tabs and segmented controls [Existing]

- **Tabs** (the product tour) follow the full WAI-ARIA tabs pattern:
  - Roles: `tablist`, `tab` and `tabpanel`.
  - Roving `tabIndex`, with ArrowLeft/ArrowRight/Home/End to move.
  - The selected tab has a 2px `--brand` underline, a `--brand` icon and `--fg` text; the others are `--fg-muted`.
  - There is one underline for the row, and it slides to the selected tab. On a phone, where the row scrolls, selecting a half-hidden tab scrolls it fully into view.
  - Changing tab swaps the caption and the screenshot inside a frame that stays put. A tab's screenshot is fetched when it is pointed at or focused.
- **Segmented controls** (the creep chart's "Without/With", the theme switch) are buttons with `aria-pressed` inside `role="group"`.
  - The track is `--bg-sunken` with an 8px outer radius.
  - The selected segment is `--bg-raised` with `--shadow-1` and a 6px radius. It is one thumb that slides between segments.
- **Progress rail** (/try): numbered square markers for the steps (done, current, next), with `aria-current="step"`.

### Tables and data lists [Existing]

- **Admin table:** the header row uses `--bg-sunken` and 13px `--fg-muted` 500. Rows are separated by `--line`. Emails use mono. Long referrers truncate with a `title`.
- **Definition lists** (spec sheet, PR facts): term and value on one row, separated by a hairline. Terms in 600, values in `--fg-muted`.
- **Member and repository lists:** hairline-separated rows with avatar or radio, name, mono metadata and a trailing action.
  - **[Existing]** Owners see *Make owner* / *Make member* and *Remove* on other members; everyone sees *Leave workspace* on their own row. The last owner can't be demoted or leave, and nobody can leave their only workspace; the server refuses with a sentence that says why. An owner can remove someone whose only workspace it is; they get a new, empty workspace of their own, and the invite links they made stop working.
- **[Existing] Archived projects:** under the project list, the *Archived projects* text link opens a hairline list of archived projects with their client and a *Restore* button. Restoring brings the project, its scope and its results back; archiving released the repository, so the status line says to connect it again.
- **Rules:** numbers are tabular and right-aligned; no zebra stripes; hover uses `--bg-hover`.

### Pull request summary: the result row [Existing]

The row is built in this order, top to bottom:

1. **Left rule:** 3px in the verdict tone (`--error`, `--warning` or `--success`).
2. **Head line:** the verdict label (Geist 600 13px in the tone colour, words from the `VERDICT` map) on the left. The metadata (`open · checked 3 h ago`, mono 12px muted) on the right.
3. **Title:** `#1842 Add organization-level permissions` (Geist 16px 600), linked to GitHub with the external icon.
4. **Branch:** mono 12px muted.
5. **Why line:** see "Scope findings" below.
6. **Detail:** the evaluator's full reason, 14px muted. Shown when the why line names excluded items; otherwise the why line already *is* the reason.
7. **Estimate**, only when one exists: "Estimated impact: 14 hours; $2,100 at $150 an hour".
8. **Changed files:** see "Files and diffs" below.
9. **Change order row:** a status chip ("CO-007 sent 3 h ago, waiting on the client") and the *Open change order* button, above a hairline.
10. **[Existing] Earlier change order**, when new work arrived after one was decided: "CO-1 (approved) covers Gift cards. A later push added work it doesn't, so that needs its own change order." (muted), above the change order row.
11. **[Existing] Acceptance**, when someone accepted the work without a change order: "Accepted by @dana-pm on Oct 29: Agreed on the call to include it" (14px, the reason in `--fg`), with a *Withdraw* text link. When a later push added work the acceptance doesn't cover, the line adds "A later push added work this doesn't cover." Every flagged row carries an *Accept without a change order…* text link (*Accept as in scope…* for needs a decision) above its change order row.

### Files and diffs

ScopeCI reads **changed file names and per-file line counts, not code**, so it never shows code hunks.

- **File list** (hero stage, "How it works" artifact):
  - A one-letter status column (`A` added in brand, `M` modified in faint; `D`/`R` when present).
  - The path in mono 12–13px, truncated with an ellipsis from the end.
  - `+n` additions in brand and `−n` deletions in error colour, right-aligned and tabular.
- **Matched files:** a file that builds excluded work gets an `--error-wash` row, an `--error` path and a footnote marker `[a]` that ties it to the clause item carrying the same letter.
- **In the app [Existing]**
  - Each pull request result carries `files` and `fileCount`, read from the diff analysis stored for that commit. A file has its path, status, line counts and, when the check cited it, the excluded item it was cited for. Patches never leave the server, and the list never comes from the client.
  - The row shows a closed `<details>`: "14 changed files, 4 cited for excluded work". Opened, it lists the files on `--bg-sunken` in mono `--t-code-s`: the status letter, the path, then `+n −n`.
  - Cited files come first, on `--error-wash`, with the path in `--error` and the excluded item under it in Geist.
  - Paths truncate at the end on wider screens (the full path is in `title`) and wrap on phones.
  - At most 200 files are listed; "and N more" covers the rest.

### Scope findings and review explanations

- **Why line [Existing]**
  - A tinted box: `--error-wash` with `--error-line` for change order needed or excluded work; `--warning-wash` for needs a decision.
  - Radius `--radius-s`, padding 12px.
  - Content for excluded work: `§4.2` (mono, tone colour), then the clause title, then "excludes", then the **items in bold** (Geist 600). There is one line per clause, in the order the items were found.
  - With no excluded items, the line is the reason at weight 500.
  - In-scope results get no why line.
- **Clause references** are always mono with the § sign (`§4.2`), followed by the clause title in Geist.
- **Contract excerpts** are set in the serif on `--paper`. Excluded items are listed under an italic "Explicit exclusions" label. Matched text uses `--marker`.
- **Included and excluded lists** (scope editor):
  - Two columns, each topped with a 2px rule: `--brand-line` for included, `--error-line` for excluded.
  - Items carry a Tick or Cross glyph in the tone colour.
  - Every item has a remove button with a label naming the item.
- **Verdict words come only from the `VERDICT` map:**
  - Change order needed
  - Needs a decision
  - In scope
  - Covered by an approved change
  - Excluded work
  - Accepted without a change order

### Status indicators [Existing]

- **Verdict label:** text in the tone colour, plus the card's left rule. No dot.
- **Chips:** 24px high, `--radius-xs`, a tone border and wash, 13px Geist 500. They state one status in words: "Ready to send", "CO-007 sent 3 h ago". A chip is never a button, and chips are not lined up into a row of counts.
- **Project status** (project page header and project cards): two lines of plain 14px text, no boxes.
  - First, what the project is tied to: the scope version with `ContractIcon`, and the repository with the GitHub mark. "Scope not confirmed" is in `--warning`.
  - Then what has happened: "23 checked", "2 need a change order", "1 to decide", "1 sent", "2 approved · $4,350". Numbers are tabular and `--fg`. Only counts that ask for something take a tone colour: change orders in `--error`, decisions in `--warning`, approvals in `--success`.
- **Check glyphs:** use these, bare and in the tone colour, never inside a circle:
  - `TickIcon` for success
  - `AlertIcon` for warning
  - `CrossIcon` for error
  - `NeutralIcon` for neutral
- **Scope version on a result:** each checked pull request's meta line names the scope version it was checked against ("scope v3"). When that is older than the project's current version, it reads "scope v2 (now v3)" in `--warning`, and *Re-check open pull requests* brings it up to date.
- **Change order progress:** three ruled columns (Drafted, Sent, Client's answer). Each top rule is a `--line-2` track that fills from the left: brand when the step is done, warning when it is current, error when the client declined. When a step is reached, its rule fills and its tick scales in; the next one follows a beat later. Each column carries its date.

### Empty, loading, error and success states

| State | Existing | Rule |
| :-- | :-- | :-- |
| Empty | One sentence that says what will appear and what makes it appear ("Nothing checked yet. The next pull request opened or updated on northstar/portal shows up here.") | Always name the trigger. No illustrations of empty boxes. |
| Loading | `Loading` (`src/components/loading.tsx`): "Loading the checked pull requests…", "Asking GitHub which repositories you can connect…" | Say what is loading. **[Existing]** For the first 300ms it holds an empty line (`role="status"`), so a fast load shows nothing and nothing jumps. No shimmering skeletons with invented shapes. |
| Error | `form-error` box (`role="alert"`) with one actionable sentence ("We couldn't reach ScopeCI. Check your connection and try again.") | Say what failed and what to do. Never show a raw status code alone. An error that can pass offers the way out beside it: "Try again" and "Cancel", never a dead end. |
| Failed load | **[Existing]** `LoadError` (`src/components/load-error.tsx`): the sentence from `errorMessage` and a *Try again* button that refetches. Used for the session, project list, project, results, team and invite. | Words come from `errorMessage` only: offline ("You're offline…"), session ended (back to sign-in, never an error page), server trouble ("ScopeCI is having trouble right now. Try again in a minute."), database away ("ScopeCI can't reach its database right now…"), GitHub not answering. A project that isn't there says so and links back to the list. A refresh that fails while the page already shows data keeps the page and any unsaved edits, and shows `StaleNotice` (warning colour, `role="status"`, *Refresh*); `LoadError` replaces a page only when nothing has loaded yet. |
| Offline | **[Existing]** `OfflineNotice`: a solid bar pinned to the bottom, "You're offline. Nothing can be saved until you reconnect." It leaves when the browser is back online. | Saves attempted while offline fail with the offline sentence, never a spinner. |
| Success | Inline status line (`.app-status`, `role="status"`): "Saved as v3. Open pull requests are being checked against it now." The waitlist success panel uses a square tick. | Confirm what changed and what happens next. No toast pop-ups. **[Existing]** The status line stays in the page, empty, so a screen reader hears it when its text changes; it takes no space while empty. |
| Notice | `.notice` (info wash and line, `--fg` text); `.notice.is-warning` when the user must fix something first ("GitHub access expired") | Use `--info` for neutral system notices, `--warning` only when the user should act, and `--success` only for completion. |

### Decisions and drafts

- **Recording what a client decided asks first.** *Client approved* and *Client declined* open the confirm dialog, which names the change order and says the decision can't be changed afterwards. Approving updates the GitHub checks straight away.
- **A sent letter is read-only.** Once marked as sent, the change order letter is what the client received: it can be copied, not edited; hours can still be recorded.
- **Edits are never overwritten.** A draft the PM edited gets *Save draft* and *Discard edits*; a newer draft from the server replaces the letter only when it hasn't been edited.
- **[Existing] Accepting work without a change order** opens a dialog that asks for the reason, which is required, kept in the project history and shown on the row and in the GitHub check ("Accepted without a change order by @dana-pm: …"). *Withdraw* asks first and puts the check back to what the scope says.
- **[Existing] New work after a decision gets its own change order.** Once a change order is approved or declined, excluded work pushed later starts a new one (CO-2) listing only the new items, and its suggested letter names only those; the decided one is never reopened, and work it listed (declined included) is never raised again. The side panel starts afresh for the new one.
- **[Existing] When GitHub doesn't take a decision at once** (accepting or withdrawing), the status line says the decision is recorded but the check needs *Re-check open pull requests*; it never claims the check was updated.
- **Leaving unsaved scope edits or an edited change order letter** (closing the panel, or closing or reloading the tab) asks first. Renaming the project keeps unsaved scope edits. Text typed into an add field but not added is pointed out ("Press Enter to add it to the list.").

### Dialogs, menus and tooltips

- **Side panel (dialog)**
  - **[Existing]** Radix Dialog, slides in from the right, `min(580px, 100vw)` wide.
  - Layout: a header with the serif title, a mono reference and a close button; a scrolling body; a footer with pinned actions.
  - Behaviour: the overlay dims the page, focus stays inside the panel, Escape, a click beside it or its close button closes it (asking first, "Discard your edits to the letter?", when the letter has unsaved edits), and focus returns to the button that opened it.
  - Use a side panel for work that relates to one row of a list.
- **Confirmations**
  - **[Existing]** `useConfirm()` from `src/components/confirm-dialog.tsx`: a centred Radix AlertDialog, 440px wide, on the panel's tokens. Used for archive project, remove member, make owner or member, leave workspace, withdraw an acceptance, forget the App and remove a signup; there is no `window.confirm` left.
  - Its title states the consequence ("Archive Northstar patient portal?"), its body says what stops, and the destructive button (`button-quiet button-danger`) is labelled with the action, never "OK".
  - Cancel, Escape and the overlay all cancel. Focus returns to the button that asked.
- **Menus:** none exist; the workspace switcher is a native select. Keep native controls until a real need appears.
- **Tooltips:** none exist; `title` attributes are used on the theme toggle and the avatar.
  - Never put information only in a tooltip.
  - Icon-only buttons need an `aria-label`.

### Code blocks and technical metadata [Existing]

- **Pull request comment preview:** a `pre` on `--bg-sunken` with a `--line` border, mono 12px at line height 1.6, wrapping, maximum height 360px, scrolling.
- **Inline metadata:** mono `--t-code-s`, separated by a middle dot with spaces (`feature/org-permissions · open · checked 3 h ago`). Times are relative under 24 hours ("3 h ago"), otherwise a short date.
- **References:** `#1842` for pull requests, `CO-007` for change orders, `§4.2` for clauses and `v3` for scope versions. Write them exactly like this everywhere.

---

## 7. Interaction and motion

### Durations and easing

| Token | Value | Use |
| :-- | :-- | :-- |
| `--fast` [Existing] | 160ms | Hover, press, colour and border changes |
| `--medium` [Existing] | 240ms | Tabs, menus, the FAQ open, merge-box content swaps |
| `--panel` [Existing] | 320ms | Side panel enter (exit at `--fast`) |
| `--slow` [Existing] | 520ms | One-time illustration steps; the wash on a just-added scope item |
| `--press` [Existing] | 60ms | Pressing down on a button, icon button or card (letting go uses `--fast`) |
| `--stagger` [Existing] | 60ms | The delay between two linked movements, so they read as one sequence |

Easing:

- `--ease` (`cubic-bezier(0.22, 0.68, 0.24, 1)`) for state changes.
- `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`) for entering elements.
- `--ease-emphasized` (`cubic-bezier(0.2, 0, 0, 1)`) for something that travels from one place to another: a selection mark, a progress rule.

**[Existing]** Every transition and animation uses these tokens. The only literal timings are two loops that stop with their state: the spinner's 0.72s turn and the 1s pulse on the hero's running check. A one-time illustration may run longer in total, but each of its steps uses `--slow` or less.

### What motion is for

- **Allowed:**
  - Confirming an action (button press, saved state, "Copied").
  - Showing where something came from or went (the panel slides in from the side it relates to; a selection mark moves to the new choice; a new scope item rises out of the field it was typed in).
  - Showing what changed and what didn't (on a page change the headers hold still; on a tab change the frame holds still).
  - Revealing detail the user asked for (FAQ, tabs).
  - One explanatory sequence that shows the product's mechanism: the hero's highlight, then the matched files, then the verdict.
- **Not allowed:**
  - Bouncing.
  - Perpetual or looping decoration.
  - Parallax on content.
  - Animated counters.
  - Typing effects.
  - Motion that delays reading or input.
  - Content that changes by itself after a delay.

### Motion inventory

| Motion | Status |
| :-- | :-- |
| Button arrow nudge, colour transitions, the press nudge | [Existing] keep |
| Side panel slide and fade, overlay fade | [Existing] keep |
| Confirmation dialog fade and 8px rise (`--medium`) | [Existing] keep |
| Mobile menu fade-in | [Existing] keep |
| FAQ height animation (`::details-content`) | [Existing] keep |
| Hero sequence (about 3.2s once, with a Replay button) | [Existing] keep. It explains the product. |
| Hero pointer tilt (±4°, fine pointers only) | [Existing] keep, at most ±4° |
| Product tour: scroll-linked 3D settle | Removed. The frame is static. |
| Selection that moves: one mark slides to the new choice in the tour tabs, the chart switch, the theme switch and the app nav (`useIndicator`, `--medium`, `--ease-emphasized`). It appears in place on load and only moves on a change. | [Existing] |
| Page change: the old page fades out (`--fast`), the new one fades in with a 6px rise (`--medium`, after `--stagger`), headers held still (`withViewTransition` from wouter's `aroundNav`) | [Existing] |
| Theme change: a whole-window crossfade (`--medium`) | [Existing] |
| Product tour view swap: the caption rises 4px into place, the screenshot fades in after `--stagger` | [Existing] |
| Copy confirmation: the copy icon turns into a `--success` tick and the label into "Copied" in a button that keeps its width; it turns back after 2 seconds (`CopyButton`) | [Existing] |
| Just-added scope item: rises 6px from the field, on a tone wash that fades (`--slow`). Only the new item; the list as loaded doesn't animate. | [Existing] |
| Change order progress rules fill from the left, the later step after a beat | [Existing] |
| Focus ring draws in from the element's edge (`--fast`) | [Existing] |
| Changed-files list and the /try comment open to their height like the FAQ | [Existing] |
| Project card lifting 2px on hover | Removed. The edge firms up and the arrow nudges. |
| Scroll reveal | [Existing] only on the hero visual and the product tour frame. Text never waits on a reveal. |
| Creep chart switching itself to "With ScopeCI" | Removed. The chart changes only when the visitor asks. Its one-time draw uses `--slow`. |
| Pulsing "checking" glyph in the hero | [Existing] keep. It stops when the sequence ends. |

### Reduced motion [Existing]

Under `prefers-reduced-motion: reduce`:

- Every animation and transition drops to 0.01ms, and smooth scrolling is off.
- Revealed content is visible immediately.
- The hero shows its final state.
- Pointer tilt and scroll-linked effects do not run.
- Page and theme changes are not wrapped in view transitions; they happen at once.
- Selection marks jump to the new choice.

Any new motion must keep all of these true.

---

## 8. Accessibility requirements

- **Contrast (WCAG 2.2 AA)**
  - Text at least 4.5:1. Large text (24px and up, or 18.66px bold) and interface boundaries at least 3:1.
  - **[Existing]** The token pairs above meet this.
  - `--brand-bright` is for non-text use only in light mode.
  - Check every new token in both themes before using it.
- **Focus**
  - **[Existing]** A global `:focus-visible` outline: 2px `--focus`, offset 3px.
  - Never remove it without an equal replacement. Inputs add a border and a 1px ring.
  - Headings that receive programmatic focus (the /try steps) may hide the outline because they are not interactive.
- **Keyboard**
  - Everything works without a mouse: tabs (arrow keys), the side panel (focus kept inside, Escape, focus returned), the menu (Escape) and the policy demo (radio inputs).
  - A skip link comes first on every page. **[Existing]**
- **Semantics**
  - Use real buttons and links.
  - Each form control has a `<label>`.
  - Groups use `fieldset` with a `legend`.
  - Async results use `aria-live="polite"`; errors use `role="alert"`.
  - Each page has one `h1`, and heading levels are not skipped.
- **Images**
  - Product screenshots are CSS backgrounds with `role="img"` and a specific `aria-label` ("Screenshot of ScopeCI: Checked pull requests, sample data").
  - Decorative icons and illustration mockups are `aria-hidden`, with a text alternative nearby (the hero's visually hidden caption).
- **No meaning by colour alone.** Every status has words. Excluded and included items also differ by glyph.
- **Targets:** at least 24×24px (WCAG 2.2). Interactive controls use 36px or more; primary actions on touch use 44px or more.
- **Motion:** respect `prefers-reduced-motion` as described in section 7. Nothing changes by itself after a delay.
- **Language and theme**
  - `lang="en"`.
  - `color-scheme` matches the active theme.
  - **[Existing]** The error boundary's screen uses the theme tokens, so it renders correctly in both themes.

---

## 9. Anti-AI ban list

Do not ship any of these:

1. Symmetrical three-card feature grids with floating icons in tinted squares or circles.
2. The formula page: hero, feature cards, logo marquee, testimonials, pricing, footer. ScopeCI has no customer logos, testimonials or prices to show, so none may be invented.
3. Fake floating badges ("New", "AI-powered", "99.9%") and meaningless decorative labels, including numbered section labels that don't help anyone find their way.
4. Glassmorphism without a function. The only allowed blur is the header when it sits over scrolling content.
5. Purple, indigo or violet gradients, and any gradient background used in place of design.
6. Gradient text in headlines or anywhere else.
7. Rounded rectangles around every piece of content. Use hairlines, rules and whitespace first; a box must contain something that belongs together.
8. Pill shapes on buttons, chips, tabs or navigation. **[Existing]**: none remain.
9. Decorative blobs, orbs, radial glows, abstract shapes, dotted grids, coloured dots and status dots. Also no circles around icons or numbers, and no macOS traffic-light dots on window frames.
10. Identical section layouts repeated down a page (see section 4).
11. Generic illustrations (people at laptops, rockets, isometric servers) or any illustration that doesn't explain ScopeCI's mechanism.
12. Dashboards with fabricated metrics, fake activity feeds, decorative charts and invented customer counts. Illustrative figures must be labelled "illustrative" or "sample", and must explain the mechanism rather than claim results.
13. Emoji as interface icons, and AI-cliché glyphs: sparkles, stars, rockets, light bulbs, magic wands, brains, robots.
14. Claims ScopeCI can't back:
    - Any AI or model wording (the check is rule-based).
    - Accuracy rates, processing times, security certifications.
    - Integrations other than GitHub.
    - "Trusted by" lines.
15. Generic corporate copy. Banned phrases include:
    - "in today's fast-paced world"
    - "unlock your potential"
    - "seamless experience"
    - "game changer"
    - "delve into"
    - "revolutionary solution"
    - "supercharge"
    - "effortless"
    - "next-generation"
16. Dependencies added only for decoration: animation, particle, carousel or icon packs beyond Hugeicons. **[Existing]** The unused packages are gone.
17. Confusing "premium" with a dark background, tiny uppercase labels and borders on everything.
18. Mixing icon sets. Only `src/icons.tsx` (Hugeicons) is allowed, plus official brand marks through `VendorMark`. No lucide.
19. Badge rows: a run of bordered, coloured chips for counts and metadata. Write it as a line of text and colour only what needs action (see *Project status*).
20. Hover theatrics: cards and list rows that lift, tilt, glow or scale on hover; staggered fade-ins on every list; motion that plays because the page loaded rather than because something changed.

---

## 10. Design review checklist

Run this before merging any frontend change. Every item must be answered "yes".

**Product truth**
- [ ] Every claim, label and number matches what ScopeCI does today (see the facts in section 0). Sample data is labelled.
- [ ] Verdict and policy names come from the `VERDICT` map and the policy list, word for word.
- [ ] The screen shows what changed, why the finding matters (clause plus excluded item) and the action available.

**Typography**
- [ ] Only Newsreader, Geist and Geist Mono, each in its allowed roles (section 2). The serif is used only for headlines and contract text.
- [ ] Sizes come from the scale tokens. No half-pixel sizes. No real interface text below 12px.
- [ ] Headings sit at least two scale steps above their body text, and not every heading looks the same.

**Colour**
- [ ] Only tokens are used: no raw hex, rgba or hsl in components.
- [ ] The view has one brand colour, the marker only on contract text, and status colours only for status.
- [ ] Every new colour pair is at least 4.5:1 (text) or 3:1 (non-text) in **both** themes.
- [ ] No gradients, glows or coloured shadows. Shadows use the three tokens only; overlays use `--scrim`.

**Layout**
- [ ] Spacing uses the 8px scale (4 and 12 only inside dense components).
- [ ] Breakpoints use 480, 720, 1024 or 1280 (as `max-width` one pixel below), or the reason for another value is written in a comment next to the rule.
- [ ] The page works at 360, 390, 768, 1024, 1280 and 1440px in light and dark, with no horizontal scroll and no clipped text.
- [ ] No more than two consecutive sections share the same layout.

**Components**
- [ ] Radii come from the scale. No pills and no decorative circles.
- [ ] At most one primary button per view region. Labels are verbs.
- [ ] Rest, hover, focus-visible, active, disabled and selected or invalid states are all defined.
- [ ] Empty, loading, error and success states exist and say what to do next.
- [ ] Icons come from `src/icons.tsx` only, at 12–18px, with `aria-hidden`; icon-only buttons have an `aria-label`.

**Interaction and accessibility**
- [ ] Everything works by keyboard. Dialogs keep focus inside, close on Escape and return focus.
- [ ] Motion uses the duration tokens, serves a purpose and is fully disabled under reduced motion.
- [ ] Nothing changes on its own after a delay.
- [ ] Each page has one `h1` with no skipped levels. Form controls are labelled. Async results are announced.
- [ ] No item from the ban list in section 9 is present.

**Engineering hygiene**
- [ ] No new dependency unless it does functional work that existing code can't. Nothing added only for decoration.
- [ ] Classes are named for what they are, not for the page they first appeared on.
- [ ] `pnpm run typecheck` and `pnpm run build` pass. Screenshots in both themes are attached to the pull request.
