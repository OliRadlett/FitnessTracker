---
description: Add a bash command pattern to the permanent allow-list in opencode.json
---

Add the following bash command pattern to the `permission.bash` section of `opencode.json` so it's always allowed without prompting:

Pattern to add: `$ARGUMENTS`

Steps:
1. Read `opencode.json`
2. Add `"$ARGUMENTS": "allow"` to `permission.bash`, before the catch-all `"*"` key
3. Write the updated config back
4. Confirm the pattern was added

If no argument is provided, show the current list of allowed patterns from `opencode.json`.
