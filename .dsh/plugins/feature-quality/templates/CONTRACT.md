# Quality contract — {{FEATURE}}

Surface: {{SURFACE}} · slug: {{SLUG}} · opened {{DATE}}
Job: {{JOB}}

Phase 1 of the Generic Feature Quality Prompt. Replace every bracket. The gate
fails until all eight fields are filled, `REFERENCE.md` and `DECISIONS.md` exist,
and at least one artifact is rendered in `prototype/{{SLUG}}/qa/`:

```
node .dsh/plugins/feature-quality/tools/quality.mjs check {{SLUG}}
```

ARTIFACT:        [one sentence: what will exist]
REFERENCE:       [saved frames + what to steal from each]
GATE:            [the image/recording/flow + acceptance criteria]
NON-GOALS:       [the explicit cut list]
GOLDEN FIXTURE:  [one real dataset/account/ride/week, by path or id]
FIRST LOOK:      [date + what it will show]
KILL CRITERION:  [the observation that ends the run, stated so it can be seen]
OWNER:           {{OWNER}}
