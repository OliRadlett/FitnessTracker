# Feature Quality Prompt

A DeepSeek Harness bundle that adds two slash commands and one composer control:

| Entry point | What it does |
|---|---|
| `/quality <brief> …` | Opens the Generic Feature Quality Prompt as the next user message |
| `/quality-status [slug]` | Prints the run's deliverables and what is next |
| **Quality prompt** (above the composer) | The same prompt as a form, with a preview of the exact message and a run strip |

The prompt itself is `prompt.md` — delivered verbatim apart from its eleven
Inputs values.

## In this repository

The source lives at `.dsh/plugins/feature-quality/` so it is versioned and
reviewable with FitTrack. Installing is per profile, not per repo:

```
plugin_manager  action: install_bundle
                target: C:\Users\oradl\FitnessTracker\.dsh\plugins\feature-quality
```

See [`.dsh/README.md`](../../README.md) for the update and verification steps.

## Use

```
/quality Route quality badge on the routes page | surface: page
/quality surface: page | job: decide which ride to repeat | owner: Oli
```

Everything that is not a known field is prose and becomes `FEATURE`. Fields are
separated by `|` or a newline, written `name: value` or `name = value`.

| Field | Aliases | Required |
|---|---|---|
| FEATURE | `feature`, `name`, or bare prose | **yes** |
| SURFACE | `surface` | **yes** |
| USER JOB | `job`, `user job`, `userjob` | **yes** |
| CURRENT STATE | `current`, `state`, `current state` | no |
| REAL FIXTURE | `fixture`, `real fixture`, `data` | no |
| REFERENCES | `references`, `reference`, `refs` | no |
| ANTI-REFERENCES | `anti`, `anti-refs`, `anti references` | no |
| EXTERNAL SOURCES | `external`, `sources`, `source` | no |
| PRODUCTION LIMITS | `limits`, `production limits`, `constraints` | no |
| FIRST LOOK | `look`, `first look`, `firstlook`, `date` | no |
| OWNER | `owner` | **yes** |

The four that gate submission are **FEATURE, SURFACE, USER JOB, OWNER**.

### SURFACE is a closed set

One or more of **page**, **flow**, **API**, **algorithm**, **integration** —
separated by `+`, `,`, `/` or `&`. Aliases are accepted (`UI` → page, `backend` →
API, `algo` → algorithm). Anything else is refused with the list, because the
prompt's "Surface types and artifacts" table has one row per value: a URL here
(the real first run supplied one) picks no row at all and is pointed at
`CURRENT STATE` instead.

### What a partial fill does

The missing fields keep their bracketed description, and the Inputs block gains
one line:

```
UNFILLED:           REFERENCES, FIRST LOOK, OWNER
```

That line is data, not instruction — the prompt's own *"When to ask, and when
not to"* section decides what happens next. With every field supplied, no line
is added at all.

A misspelled field name (`refrences:`) is prose, so it would silently join
FEATURE; the receipt names the field it probably meant.

### Presets

`defaults.json` beside the prompt pre-fills inputs the user did not supply:

```json
{
  "OWNER": "Oli",
  "PRODUCTION_LIMITS": "unlimited time, not scope",
  "FIRST_LOOK": "5 working days"
}
```

Rules the file has to keep:

- **Keys are field keys** — `FIRST_LOOK`, not `FIRST LOOK`. An unknown key is
  logged and ignored rather than silently dropped.
- **A preset fills only what was not supplied.** A typed value, a stored draft or
  a Recent restore always wins.
- **A preset counts as supplied**, so it is not a placeholder and never appears
  in the `UNFILLED:` line — but it is not hidden either: the control marks it
  `preset ×` (one click returns it to a placeholder), and the transcript receipt
  says `Presets used: …`.
- **Both entry points read the same file**, because the host loads it and serves
  it to the control at `/plugins/feature-quality/defaults`.
- A **missing** file is a valid configuration (no presets); a **malformed** one
  fails activation rather than delivering a prompt nobody pre-filled.

A change to `defaults.json` needs the bundle re-installed (the host reads it at
activation, once); the control picks it up on its next mount.

**What does not belong in it.** These were proposed and rejected, and the reason
is the rule they break:

| Value | Why not |
|---|---|
| `FEATURE`, `SURFACE`, `USER JOB` | The four-input gate means "a person decided this". A default here makes the gate decorative. |
| `REAL FIXTURE: real prod data` | A category, not a fixture. It reads as answered while giving Phase 0 nothing to open, and the `UNFILLED:` line stops asking for it. |
| `PRODUCTION LIMITS: unlimited time and scope` | Contradicts the prompt's own non-negotiable — "You may use unlimited time; you do not have unlimited scope." |
| `FIRST LOOK: as long as it takes` | Removes the checkpoint the prompt keeps on purpose: "do choose a first-look checkpoint anyway, because a decision needs a moment." |

`OWNER` is the one required field that is defaulted, and deliberately: it is a
name the user would have typed, and the mark makes it visible. It costs the gate
one field — the meter opens at `1 of 4 required` — which is the honest price.

### `/quality-status`

```
Quality run: route-quality-badge
Started 2026-11-06T21:48:00.000Z · 9 inputs supplied, placeholders: FIRST LOOK, OWNER

✓ P1 Contract         plans/quality/route-quality-badge/CONTRACT.md
· P2 Lab              prototype/route-quality-badge
· P4 Artifact         prototype/route-quality-badge/qa
…
Next: Lab — P2 (prototype/route-quality-badge).
P0 (the diagnosis) has no file of its own and is not machine-checkable.
```

Ticks are evidence, not progress: a tick means the file exists. P0 is reported as
not machine-checkable rather than inferred from an empty directory.

## In the UI

Above the message composer there is a **Quality prompt** row. Click it and the
launcher opens: the four inputs that gate submission first, the seven that may
stay placeholders behind a disclosure, and the message summarised before it is
shown in full.

```
Quality prompt   ✓ 4 of 4 required   run 4/7
┌─────────────────────────────────────────────────────────────┐
│ FEATURE *            [Route quality badge                   ]│
│ SURFACE * [page ▾]  USER JOB * [decide …]  OWNER * [Oli     ]│
│ ☑ New session — the prompt becomes its first message         │
│ ▸ 7 optional inputs  all placeholders                        │
│ What will be sent  route-quality-badge  page  4/11  7 placeholders  › Show message │
│ [Start prompt] [Cancel]                              4/11 filled │
└─────────────────────────────────────────────────────────────┘
```

- **Required first.** FEATURE spans the panel; SURFACE, USER JOB and OWNER sit
  under it. A line at the top of the form names what is still required and
  disappears when it is; the header meter counts `n of 4 required`.
- **Optional, on demand.** The seven placeholder-friendly inputs open from
  `7 optional inputs`, which shows how many are filled.
- **What will be sent** is the host's own build of the message, summarised as
  `slug · surface · supplied · placeholders`; `Show message` reveals the exact
  text. Only one detail is open at a time — the message or the run.
- **Start prompt** is disabled until the four required inputs are present.
- **New session** is on by default, because the prompt says to use it as the
  first message of a new session. Submitting then **opens that session in the
  main pane** — the host creates it, and the control hands it to the app's
  `uiWorkspace` service, the same call the sidebar makes. If that service is not
  available, the receipt says to open the session from the sidebar instead.
  Untick the box to deliver into the current session; the pane does not move.
- **Drafts** are kept in `localStorage` on this device, cleared on submit, and
  the last five submissions are offered as **Recent…**.
- **Run strip**: once a run is recorded, the row shows `run 1/7`; clicking it
  opens the deliverable chips, the next path, and the P0 caveat.
- **Keyboard**: `Escape` closes, `Ctrl`/`Cmd`+`Enter` submits, `Enter` submits
  from a field. Inputs take a brand focus ring rather than the browser default,
  and the scroll body has a themed scrollbar.
- **Theme and width**: every colour is a `--dsw-alias-*` token with a literal
  fallback, so light and dark both hold. The grids are `auto-fit`: the required
  row measures three 219px tracks at a 705px dock and two 173px tracks at 383px,
  and the message summary wraps rather than truncating its pills.

The control appears only with a session open. It posts to the plugin's own routes
on the host (`/plugins/feature-quality/start`, `/preview`, `/status`), and every
route applies `connection.requestRejection` itself, because raw web routes do not
inherit the Connection's fence.

## Run records

Each submission writes `.dsh/plugins/feature-quality/.state/runs/<slug>.json`
(gitignored): the brief, the surface, what was supplied and what was not, the
session, and the working directory. That is what `/quality-status` and the run
strip read. The record is best-effort — a read-only checkout cannot fail a
submission.

## The prompt asset

`prompt.md` is version 2. Version 1 is the original document; v2 adds, without
removing any phase:

- **Deliverables and paths** — one slug, five files, so the run is checkable.
- **Phase 0.5 Evidence pack** — references saved as frames, plus a "before" frame.
- **Two strikes on a technique** — a repeated failure changes approach, not effort.
- **A falsifiable kill criterion** — "the badge is unreadable at 320px", not "it
  doesn't look good".
- **Anti-rationalisation and failure-mode tables** — the sentences that make
  stopping acceptable, and the shapes a bad artifact takes.
- **`FIRST-LOOK.md` and `PRODUCTION.md`** as deliverables.

The Inputs block did not grow: it is the interface, and the eval gate depends on
its shape.

## Tools

Three commands, because a quality run otherwise re-invents the same scaffolding
and re-derives the same evidence on every pass.

```bash
# Scaffold a run: contract, references, decisions, and a lab harness
node .dsh/plugins/feature-quality/tools/quality.mjs new "Route quality badge" \
  --surface page --owner Oli --job "decide which ride to repeat"

# The mechanical gate
node .dsh/plugins/feature-quality/tools/quality.mjs check [slug] [--json]

# Where the run stands (the same scan as /quality-status)
node .dsh/plugins/feature-quality/tools/quality.mjs status [slug]

# One labelled page from frames you already rendered
node .dsh/plugins/feature-quality/tools/contact-sheet.mjs \
  --out prototype/<slug>/qa/contact-sheet.png --columns 2 shots/*.png
```

`new` writes only the Phase 1/2 deliverables — `CONTRACT.md`, `REFERENCE.md`,
`DECISIONS.md` and `prototype/<slug>/qa/states.mjs`. It does **not** create
`FIRST-LOOK.md` or `PRODUCTION.md`, because a file created before the work would
tick a gate that has not been passed.

`check` exits 1 unless: every one of the eight contract fields is filled, the
reference and decisions exist, and at least one artifact is in the lab's `qa/`.
`PRODUCTION.md` is reported but **not** gated — it is Phase 6 and exists only if
the run passes; a gate that is red until the end is a gate nobody reads.

`states.mjs` is the per-feature harness: edit its `STATES`, then one command
renders each one and builds the contact sheet. `contact-sheet.mjs` lays the
frames out with a real browser (no image library) and keeps the generated HTML
beside the PNG.

Two invariants the labs enforce: the CLI's deliverable paths come from
`lib/state.mjs`, the same module `/quality-status` reads, so they cannot drift;
and the tools are covered by `eval/tools.mjs`.

⚠️ The repository's `.gitignore` ignores `qa/` (device-pass captures stay out of
the repo). That applies to a lab's `qa/` too: screenshots and the generated sheet
are local evidence, not commits. The harness (`states.mjs`) is ignored with them
— move it up a level if you want it versioned.

## Editing the prompt

`prompt.md` is the prompt. It is prose plus eleven `{{FIELD}}` tokens in its
Inputs block, with one `Inputs` heading followed by a fenced block. Edit the
prose freely; keep the tokens unique and the block intact — activation fails with
a clear error if the block is missing. Line endings are normalised at load, so a
CRLF checkout delivers the same text as an LF one.

## Verify

```bash
node .dsh/plugins/feature-quality/eval/harness.mjs   # delivery, placeholders, CRLF, contract
node .dsh/plugins/feature-quality/eval/wiring.mjs    # commands, routes, scan, client interaction
node .dsh/plugins/feature-quality/eval/tools.mjs     # quality.mjs new/check/status, contact sheet
```

All three exit non-zero on failure. The first is the gate that keeps the delivered
prompt identical to the asset outside its Inputs block; the second drives
`apply()`, all four routes, the evidence scan, presets, opening the created
session, and the control through a hook runtime; the third scaffolds a run in a
temp directory and gates it, including the paths agreeing with the plugin's own
scan.

## Layout

| File | Purpose |
|---|---|
| `index.js` | Host half: parse, validate, fill, submit, record; serves the four routes |
| `lib/template.mjs` | The Inputs block: normalise, split, append — shared with the labs |
| `lib/state.mjs` | Run records, slug, deliverable scan, `/quality-status` text |
| `client.js` | Client half: the control above the composer |
| `defaults.json` | Preset inputs, loaded by the host and served to the control |
| `prompt.md` | The prompt itself, with `{{FIELD}}` tokens |
| `tools/quality.mjs` | Scaffold a run, gate it, read it |
| `tools/contact-sheet.mjs` | Frames in, one labelled page out |
| `tools/playwright.mjs` | Browser resolution shared by the tools and the lab harness |
| `templates/` | What `quality.mjs new` writes: contract, references, decisions, `states.mjs` |
| `eval/harness.mjs` | The delivery lab |
| `eval/wiring.mjs` | The wiring and interaction lab |
| `eval/tools.mjs` | The tools lab |
| `eval/screenshots/` | Rendered states of the control: filled, optional, dark, collapsed, presets |
| `eval/REPORT.md` | The evaluation: why the delivery rule exists, and v2–v5 |
| `cordis.patch.yml` | Inserts the `feature-quality` row |
| `locale/en.json` | Plugin Manager / Settings title and description |
| `icon.svg` | Plugin icon |

## Uninstall

Remove the bundle from the profile (`plugin_manager` → `remove_bundle`), which
also drops the row. The directory is self-contained; deleting it is enough. The
run records under `.state/` are yours to keep or delete.
