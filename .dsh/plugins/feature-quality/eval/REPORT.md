# Evaluation — Generic Feature Quality Prompt delivered by `/quality`

**Question.** Delivering the prompt through a slash command and a composer form is
not how it was written. It was written to be copied, filled, and pasted as the
first message of a new session. Does the plugin deliver *the asset* — or a
version of it?

**Verdict.** The delivery is now the asset: outside the Inputs block the message
is byte-identical to `prompt.md` for all three fixtures. One open item remains,
and only a run can settle it (see *Open item*).

- Artifact: this report.
- Reproduce: `node eval/harness.mjs` (exit 1 = gate not met).
- Fixtures: [`eval/fixtures.json`](fixtures.json) — full, the real partial
  invocation, empty.

## Method

The lab renders the message the plugin would submit for each fixture and diffs it
against `prompt.md` line by line, **outside** the Inputs block. The contract says
the tool owns the Inputs values and nothing else, so any line it writes elsewhere
is a defect by construction — no judgement needed.

Behavioural evidence comes from the run already launched by hand: session
`0e4299a8-a6af-488c-a734-934d9fa10f42` in
`--C-Projects-fitness-tracker--`, 336 events (174 zstd frames), decoded and read
directly.

## What the plugin actually delivered (before)

```
> **Prepared by `/quality`.** 5 inputs are still placeholders: REFERENCES, ANTI-REFERENCES, EXTERNAL SOURCES, FIRST LOOK, OWNER.
> This prompt's "When to ask, and when not to" governs them: ask for the owner-owned ones, fill the reversible ones from the repository, and record the choice at the next checkpoint.

FEATURE:            Lifting page overhaul
SURFACE:            https://oliradlett.co.uk/fittrack/lifting
USER JOB:           The lifting page has a lack of quality. Treat this as a complete overhaul…
REAL FIXTURE:       Use real data from a prod connection
PRODUCTION LIMITS:  unlimited
REFERENCES:         [3–5 links or frames that show "good"]
```

## Findings

**F1 — The delivery edited the asset.** Two lines were written *in front of* the
prompt, on every partial fill. The full-fill path was clean; the path actually
taken was not.

**F2 — The edit was load-bearing, not cosmetic.** The model's first reasoning
opens by quoting it:

> *"The instructions in the prompt: 'This prompt's When to ask, and when not to'
> governs them: ask for the owner-owned ones, fill the reversible ones from the
> repository, and record the choice at the next checkpoint.'"*

It then followed that rule. "Owner-owned" is a category the prompt does not
contain — the prompt says *ask for the artifact, the reference and
anti-reference, the fixture, the non-goals, the first-look date* and *make the
reversible choice, record it*. A paraphrase in front of a proven document is
exactly what the prompt's own first rule forbids: the artifact is the spec.

**F3 — Partial input is the default, and the prompt assumes the opposite.** 6 of
11 fields were supplied; `SURFACE` received a URL where the prompt accepts
page / flow / API / algorithm / integration. The form makes submission cheaper
than completion, and the delivered prompt then carries five placeholders.

**F4 — The ritual survived delivery.** The run produced diagnosis, quality
contract, artifact and Phase 0 language. The mechanism is sound; only the
framing was wrong.

## The change

The placeholder signal moved from a preamble **into the Inputs block**, the one
region the tool owns, and lost its instruction clause:

```
UNFILLED:           REFERENCES, ANTI-REFERENCES, EXTERNAL SOURCES, FIRST LOOK, OWNER
```

It is data, not a rule. The prompt already carries the rule — its own "When to
ask, and when not to" section lists the reference, the anti-reference and the
first-look date. With every field supplied, no line is added at all.

## Result

| fixture | supplied | lines written outside Inputs | added input lines | verdict |
|---|---|---|---|---|
| full | 11/11 | 0 (was 0) | 0 | pass |
| partial-real | 6/11 | **0 (was 3)** | 1 | pass |
| empty | 0/11 | **0 (was 3)** | 1 | pass |

The delivered message now begins:

```
Generic Feature Quality Prompt
> **How to use:** copy this file, fill every bracket, and paste it as the first
```

## Open item

Whether the model still treats placeholders correctly now that the pointer is
gone. F2 shows it acted on the preamble, so this is a real risk, not a formality.
The kill criterion applies: **if a confirmatory run does not address the missing
references / first look / owner, require all eleven fields before submit** and the
form becomes an interview rather than a launcher. That is a one-line gate in
`client.js`, not a redesign.

## Rejected

- **Keep the preamble and document it as an exception.** Rejected: the model
  obeyed the addition, so the exception would be permanent and silent.
- **Require all eleven fields now.** Rejected for now, not on principle: the
  prompt's own "When to ask" list *is* the interview, so starting partial is
  legitimate. This becomes the fallback if the open item fails.
- **Deliver into a new session** (`ctx.remote.session.create` exists). Out of
  scope by the contract, and it does not affect this finding: the defect was in
  the text, not the destination.
