# .dsh — project-local DeepSeek Harness assets

Two bundles and one skill live here. A bundle is **profile-scoped**: the files are
versioned with the repo so they can be reviewed and diffed, but each DSH profile
installs a bundle once, pointing at this directory. A skill under `skills/` needs
no install at all.

| Path | What it is |
|---|---|
| `plugins/feature-quality/` | `/quality` and `/quality-status`, plus a composer control that fills the Generic Feature Quality Prompt, previews the message and tracks the run's deliverables |
| `plugins/opencode-go-usage/` | A quiet OpenCode Go quota meter under the composer: 5-hour, weekly and monthly windows |
| `skills/feature-quality/` | The same prompt as a skill, for instances that have not installed the bundle |

## Install a bundle

```
plugin_manager  action: install_bundle
                target: <repo-root>\.dsh\plugins\<name>
```

After a change, remove and reinstall (`remove_bundle` then `install_bundle`) so
the profile re-reads the patch. That also re-imports the host half: after the v2
reinstall the new `/preview` and `/status` routes answered 401 (registered) where
they had answered 404 (unregistered) a moment earlier, with no app restart. A
restart is the fallback if a host change does not take; a client-half change
(`client.js`) needs a page reload.

The `desktop` profile links `feature-quality` from its `package.json`, so it is
already installed there. Check with `plugin_manager action: list_plugins`.

## Verify before trusting it

```bash
node .dsh/plugins/feature-quality/eval/harness.mjs   # delivery, placeholders, CRLF, contract
node .dsh/plugins/feature-quality/eval/wiring.mjs    # apply(), routes, scan, client interaction
node .dsh/plugins/feature-quality/eval/tools.mjs     # quality.mjs new/check/status, contact sheet
```

All three exit non-zero on failure. The first is the gate that keeps the delivered
prompt identical to the asset outside its Inputs block; the second catches
registration, routing, scanning and interaction defects that the text lab cannot
see; the third keeps the run's tools — and their paths — honest.

`opencode-go-usage` has no lab; it is checked with `node --check` on both halves
and by observing the pill under the composer.

### Run records

Submissions write `.dsh/plugins/feature-quality/.state/runs/<slug>.json`
(gitignored). `/quality-status` and the control's run strip read them; deleting
the directory forgets the runs and nothing else.

## Feature quality

Usage is in [`plugins/feature-quality/README.md`](plugins/feature-quality/README.md).
The evaluation that produced the current delivery rule, and the v2 prompt
revision, are in [`plugins/feature-quality/eval/REPORT.md`](plugins/feature-quality/eval/REPORT.md).
