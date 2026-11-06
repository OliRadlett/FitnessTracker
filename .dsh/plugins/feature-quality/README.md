# Feature Quality Prompt

A DeepSeek Harness bundle that adds one slash command, `/quality`.

It opens the **Generic Feature Quality Prompt** as the next user message —
verbatim, with your feature, surface, references, fixture and owner filled in —
so a new session starts at Phase 0 instead of at the first code edit.

The command never reaches the model as `/quality`; it submits the prompt itself,
exactly as if you had pasted the filled template.

## In this repository

The source lives at `.dsh/plugins/feature-quality/` so it is versioned and
reviewable with FitTrack. Installing is per profile, not per repo:

```
plugin_manager  action: install_bundle
                target: C:\Projects\fitness-tracker\.dsh\plugins\feature-quality
```

See [`.dsh/README.md`](../../README.md) for the update and verification steps.

## In the UI

Above the message composer there is a **Quality prompt** row. Click it and the
prompt's Inputs block opens as a form — one field per bracket. `SURFACE` is a
choice of the five the prompt accepts, `FIRST LOOK` suggests the working-day
phrasings, and the button says **Start anyway** with a count when fields are
blank, so the cost of a partial fill is visible before you press it.

**Start in a new session** is on by default, because the prompt says to paste it
as the first message of a new session: the host creates one and admits the prompt
as its first message, and you open it from the sidebar. Untick it and the prompt
arrives in the session the control lives in instead.

Empty fields are omitted from the line, so they keep their original bracketed
description in the prompt, and the Inputs block gains one `UNFILLED:` line naming
them. That line is the only thing this plugin ever writes to your prompt: the
prose is delivered unchanged, and with all eleven fields supplied the block is
untouched. The panel closes on `Escape` or **Cancel**.

The control appears only with a session open (it submits into that session). It
posts to the plugin's own `POST /plugins/feature-quality/start` route on the host,
which runs the command rather than reimplementing it, so both entry points log
the same `command/run` lifecycle. The route authenticates through
`connection.requestRejection`, because raw web routes do not inherit the
Connection's fence.

## Use

```
/quality Route quality badge on the routes page
```

Everything you type after the command is the feature brief, and becomes
`FEATURE`. That is enough to start. Add fields when you have them:

```
/quality surface: page | job: decide which ride to repeat | fixture: rides/2026-10-18.gpx
```

Fields are separated by `|` (or a newline), written `name: value` or
`name = value`. Any segment that is not a known field is prose and joins
`FEATURE`.

| Field | Aliases |
|---|---|
| FEATURE | `feature`, `name`, or bare prose |
| SURFACE | `surface` |
| USER JOB | `job`, `user job`, `userjob` |
| CURRENT STATE | `current`, `state`, `current state` |
| REAL FIXTURE | `fixture`, `real fixture`, `data` |
| REFERENCES | `references`, `reference`, `refs` |
| ANTI-REFERENCES | `anti`, `anti-refs`, `anti references` |
| EXTERNAL SOURCES | `external`, `sources`, `source` |
| PRODUCTION LIMITS | `limits`, `production limits`, `constraints` |
| FIRST LOOK | `look`, `first look`, `firstlook`, `date` |
| OWNER | `owner` |

A field you leave out keeps its original bracketed description, and the prompt is
prefixed with one line naming what is still a placeholder. The prompt's own
*"When to ask, and when not to"* section then decides what to do about them — the
plugin does not invent answers.

A bare `/quality` submits the template untouched.

Keys, values and prose are collapsed to one line, because the Inputs block is one
line per field. Input is capped at 8000 characters; point at a file instead when
the context is long.

## Editing the prompt

`prompt.md` is the prompt. It is the original text with eleven `{{FIELD}}` tokens
in its Inputs block, so you can edit the prose, add a phase, or change a
placeholder without touching JavaScript. The command reads the file at
activation; reload the plugin (or restart) after editing it.

## Layout

| File | Purpose |
|---|---|
| `index.js` | Host half: parses the invocation, fills `prompt.md`, submits it as a user message, and serves the control's route |
| `client.js` | Client half: the Quality prompt control above the composer, which posts to that route |
| `prompt.md` | The prompt itself, with `{{FIELD}}` tokens |
| `eval/` | The delivery lab: `node eval/harness.mjs` diffs the delivered message against `prompt.md` |
| `eval/wiring.mjs` | The wiring lab: `node eval/wiring.mjs` drives `apply()` and both control modes against a stub context |
| `eval/REPORT.md` | The evaluation that produced the current delivery rule |
| `cordis.patch.yml` | Inserts the `feature-quality` row |
| `locale/en.json` | Plugin Manager / Settings title and description |
| `icon.svg` | Plugin icon |

## Uninstall

Remove the bundle from the profile (`plugin_manager` → `remove_bundle`), which
also drops the row. The directory is self-contained; deleting it is enough.
