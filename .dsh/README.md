# .dsh — project-local DeepSeek Harness assets

## `plugins/feature-quality`

The Feature Quality Prompt bundle: the `/quality` and `/quality-status` slash
commands and a control above the message composer that fills the prompt's Inputs
block, previews the exact message, submits it, and tracks the run's deliverables.
It ships the prompt as `prompt.md`, so the text is reviewable and versioned with
the repo rather than living in someone's profile.

### A bundle is profile-scoped, not project-scoped

Keeping the files here makes the plugin visible, reviewable and diffable by
anyone working in this repo. It does **not** install it. Each DSH profile that
works on FitTrack installs it once, pointing at this directory:

```
plugin_manager  action: install_bundle
                target: C:\Users\oradl\FitnessTracker\.dsh\plugins\feature-quality
```

After a change, remove and reinstall (`remove_bundle` then `install_bundle`) so
the profile re-reads the patch. That also re-imports the host half: after the
v2 reinstall the new `/preview` and `/status` routes answered 401 (registered)
where they had answered 404 (unregistered) a moment earlier, with no app restart.
A restart is the fallback if a host change does not take. A client-half change
(`client.js`) needs a page reload.

### Verify before trusting it

```bash
node .dsh/plugins/feature-quality/eval/harness.mjs   # delivery, placeholders, CRLF, contract
node .dsh/plugins/feature-quality/eval/wiring.mjs    # apply(), routes, scan, client interaction
```

Both exit non-zero on failure. The first is the gate that keeps the delivered
prompt identical to the asset outside its Inputs block; the second is what
catches registration, routing, scanning and interaction defects that the text
lab cannot see.

### Run records

Submissions write `.dsh/plugins/feature-quality/.state/runs/<slug>.json`
(gitignored). `/quality-status` and the control's run strip read them; deleting
the directory forgets the runs and nothing else.

### Usage

See [`plugins/feature-quality/README.md`](plugins/feature-quality/README.md).
The evaluation that produced the delivery rule, and the v2 prompt revision, are
in [`plugins/feature-quality/eval/REPORT.md`](plugins/feature-quality/eval/REPORT.md).
