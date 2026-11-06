# .dsh — project-local DeepSeek Harness assets

Two bundles and one skill live here. A bundle is **profile-scoped**: the files are
versioned with the repo so they can be reviewed and diffed, but each DSH profile
installs a bundle once, pointing at this directory. A skill under `skills/` needs
no install at all.

| Path | What it is |
|---|---|
| `plugins/feature-quality/` | `/quality` and a composer control that fill the Generic Feature Quality Prompt and submit it |
| `plugins/opencode-go-usage/` | A quiet OpenCode Go quota meter under the composer: 5-hour, weekly and monthly windows |
| `skills/feature-quality/` | The same prompt as a skill, for instances that have not installed the bundle |

## Install a bundle

```
plugin_manager  action: install_bundle
                target: C:\Projects\fitness-tracker\.dsh\plugins\<name>
```

Update after a change: `remove_bundle`, then `install_bundle` again, so the
profile re-reads the patch. A change to a host half (`index.js`) needs an app
restart to load the new module generation; a change to a client half
(`client.js`) needs a page reload.

## Verify before trusting it

```bash
node .dsh/plugins/feature-quality/eval/harness.mjs   # delivered text vs prompt.md
node .dsh/plugins/feature-quality/eval/wiring.mjs    # apply(), route, both modes, client render
```

Both exit non-zero on failure. The first is the gate that keeps the delivered
prompt identical to the asset outside its Inputs block; the second catches
registration, routing and rendering defects the text lab cannot see.

`opencode-go-usage` has no lab; it is checked with `node --check` on both halves
and by observing the pill under the composer.

## Feature quality

Usage is in [`plugins/feature-quality/README.md`](plugins/feature-quality/README.md).
The evaluation that produced the current delivery rule is in
[`plugins/feature-quality/eval/REPORT.md`](plugins/feature-quality/eval/REPORT.md).
