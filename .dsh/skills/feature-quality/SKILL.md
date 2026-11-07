---
name: feature-quality
description: Use when a feature needs rebuilding to a quality bar instead of being patched — diagnose why current quality is capped, agree a quality contract, build one artifact, look at it, then decide production/iterate/kill.
---

# Feature quality

Runs the **Generic Feature Quality Prompt** for one feature. The prompt is the
asset and lives in this repository:

```
.dsh/plugins/feature-quality/prompt.md
```

Read it and follow it. Do not restate it, summarise it, or improve it in the
delivery — the text is the proven part, and this skill exists only to get it in
front of the work. Changes to the prompt go through the plugin's own lab
(`eval/harness.mjs`), not through a paraphrase in a session.

## Do this

1. **Read the prompt** with `read .dsh/plugins/feature-quality/prompt.md`.

2. **Fill its Inputs block** — `FEATURE`, `SURFACE`, `USER JOB`, `CURRENT STATE`,
   `REAL FIXTURE`, `REFERENCES`, `ANTI-REFERENCES`, `EXTERNAL SOURCES`,
   `PRODUCTION LIMITS`, `FIRST LOOK`, `OWNER`. Keep the block's 20-column gutter,
   one line per field.

   **Four are required**: `FEATURE`, `SURFACE`, `USER JOB`, `OWNER`. `SURFACE` is
   one of page / flow / API / algorithm / integration (a URL is not a surface; it
   belongs in `CURRENT STATE`).

   Anything else you do not know keeps its bracketed default, and the block gains
   one line naming what is missing:

   ```
   UNFILLED:           REFERENCES, FIRST LOOK, OWNER
   ```

   That line is data, not instruction. The prompt's own *"When to ask, and when
   not to"* section decides what to do about them; do not add a rule of your own.

3. **Deliver the filled prompt as the working brief** and run it in order:
   Phase 0 diagnosis, Phase 0.5 evidence pack, Phase 1 contract, sign-off,
   bounded lab, one artifact, first look, production/iterate/kill.

4. **Stop at Phase 1.** No code before the contract is agreed. That gate is the
   whole point of the prompt; a goal or a long session is not a reason to cross it.

5. **Write the deliverables where the prompt says**, under one slug:
   `plans/quality/<slug>/{CONTRACT,DECISIONS,REFERENCE,FIRST-LOOK,PRODUCTION}.md`
   and the lab at `prototype/<slug>/` with its harness in `qa/`.

## Tools

The repository ships the mechanics, so a session does not re-invent them. These
are repo files, not profile files: they work whether or not the bundle is
installed.

```bash
node .dsh/plugins/feature-quality/tools/quality.mjs new "<feature>" \
  --surface page --owner Oli          # contract, reference, decisions, lab harness
node .dsh/plugins/feature-quality/tools/quality.mjs check <slug>   # exit 1 until it is real
node .dsh/plugins/feature-quality/tools/quality.mjs status <slug>
node .dsh/plugins/feature-quality/tools/contact-sheet.mjs --out sheet.png frames/*.png
```

`check` is evidence, not judgement: it knows the contract is filled and an
artifact exists, not whether the artifact is good.

## If the bundle is installed

`/quality` and the composer control do steps 1–3 for you, including starting a
fresh session; the control also previews the exact delivered text and shows the
run's evidence. `/quality-status` prints which deliverables exist and what is
next. Prefer them where they exist; use this skill where the bundle is not
installed in the profile.

## Notes

- The delivery rule — the prompt is byte-identical outside its Inputs block, on
  every line-ending style — is enforced by
  `node .dsh/plugins/feature-quality/eval/harness.mjs`.
- `node .dsh/plugins/feature-quality/eval/wiring.mjs` drives the command, the
  three routes and the control's interaction.
- `eval/REPORT.md` records why that rule exists, and what was rejected.
