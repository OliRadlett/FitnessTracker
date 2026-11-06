# .dsh — project-local DeepSeek Harness assets

## `plugins/feature-quality`

The Feature Quality Prompt bundle: the `/quality` slash command and a control
above the message composer that fills the prompt's Inputs block and submits it.
It ships the prompt as `prompt.md`, so the text is reviewable and versioned with
the repo rather than living in someone's profile.

### A bundle is profile-scoped, not project-scoped

Keeping the files here makes the plugin visible, reviewable and diffable by
anyone working in this repo. It does **not** install it. Each DSH profile that
works on FitTrack installs it once, pointing at this directory:

```
plugin_manager  action: install_bundle
                target: C:\Projects\fitness-tracker\.dsh\plugins\feature-quality
```

After a change, remove and reinstall (`remove_bundle` then `install_bundle`) so
the profile re-reads the patch. A change to the host half (`index.js`) needs an
app restart to load the new module generation; a change to the client half
(`client.js`) needs a page reload.

### Verify before trusting it

```bash
node .dsh/plugins/feature-quality/eval/harness.mjs   # delivered text vs prompt.md
node .dsh/plugins/feature-quality/eval/wiring.mjs    # apply(), route, both modes, client render
```

Both exit non-zero on failure. The first is the gate that keeps the delivered
prompt identical to the asset outside its Inputs block; the second is what
catches registration, routing and rendering defects that the text lab cannot see.

### Usage

See [`plugins/feature-quality/README.md`](plugins/feature-quality/README.md).
The evaluation that produced the current delivery rule is in
[`plugins/feature-quality/eval/REPORT.md`](plugins/feature-quality/eval/REPORT.md).
