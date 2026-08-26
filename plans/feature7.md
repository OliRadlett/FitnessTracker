# Feature 7 — AI Overlays (POC)

> **Status**: Approved (POC) — not started
> **Type**: POC — optional interpretive layer over deterministic outputs
> **Dependencies**: Feature 3 (insights), existing LLM analysis infra (`services/llm_analysis.py`, Gemini)
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

Lay optional AI interpretation on top of the deterministic analytics, reusing the **existing, working** LLM analysis infrastructure. No new chat system, no new AI plumbing.

## Scope

1. **"Explain this insight" buttons** on the Analytics page — the LLM reads an `AthleteInsight` JSON + its supporting stats and interprets in plain language ("this association may be confounded by X", "this matches a deload pattern"). New prompt variant over existing infra.
2. **Big-picture season/overview analysis** — a broader cross-domain summary reusing the existing context-compilation + `LlmAnalysis` storage pattern (like the weekly cycling analysis, but all-domains).
3. **Free-form "ask about your training"** — folded into the *existing* on-demand analysis surfaces, not a new chat UI (per decision: current on-demand analysis already does this well).

## Out of scope

- A persistent chat/conversational assistant.
- Any AI influence on deterministic scoring or prescriptions — AI interprets only.

## Go / No-Go criteria

- **Go** if: the explain-insight text adds genuine understanding beyond reading the numbers yourself.
- **No-Go** if: it's prose restating the numbers — then it's noise and we keep AI to the existing on-demand analyses.

## Acceptance

1. Explain-insight buttons work on Analytics page with stored `LlmAnalysis`.
2. Big-picture analysis reuses existing storage/patterns.
3. Go/no-go review completed.