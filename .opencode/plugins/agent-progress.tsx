/**
 * Agent Progress — TUI sidebar widget (experimental, undocumented API)
 *
 * Registers into the `sidebar_content` slot (right-hand panel) between the
 * Context and LSP widgets and shows a live progress snapshot of where the
 * agent is in the current task:
 *
 *   Progress ● 3/6 · Updating service layer
 *   ▰▰▰▱▱▁ 3/6 steps
 *   ✓ read schema · update service layer
 *   ⚠ awaiting permission (1)
 *   ✗ bash: 2 tests failed
 *
 * The headline line is a brief, progress-focused status: the agent's
 * lifecycle state (working / idle / retrying / compacting), the completed
 * step count out of total, and — while a step is in progress — that step's
 * todo label. It deliberately does NOT mirror every in-flight tool call.
 * Secondary lines below show the visual progress bar, recently completed
 * steps, permission/question blockers, and the most recent tool error.
 *
 * Requires opencode >= 1.18.x (validated on 1.18.23). Uses the undocumented
 * TUI plugin API (`@opencode-ai/plugin/tui`) — feature-detected so drift
 * degrades silently. Registered explicitly in tui.json because the
 * auto-glob only covers *.ts/*.js, not *.tsx.
 */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"

const LINE_CHARS = 30
const TRAIL_ITEM_CHARS = 12
const RECENT_WINDOW = 15
const BAR_MAX_SEGMENTS = 8

type LoosePart = {
  type?: string
  text?: string
  tool?: string
  state?: { status?: string; title?: string }
}

function asPart(part: unknown): LoosePart {
  return (part ?? {}) as LoosePart
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

function truncateLeft(value: string, max: number): string {
  if (value.length <= max) return value
  const clipped = value.slice(value.length - max + 1)
  const space = clipped.indexOf(" ")
  return "…" + (space > 0 ? clipped.slice(space + 1) : clipped)
}

function fitTail(value: string, budget: number): string {
  return truncateLeft(value.replace(/\s+/g, " ").trim(), budget)
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current

  const messages = createMemo(() => props.api.state.session.messages(props.session_id))
  const status = createMemo(() => props.api.state.session.status(props.session_id))
  const todos = createMemo(() => props.api.state.session.todo(props.session_id))
  const permissions = createMemo(() => props.api.state.session.permission(props.session_id))
  const questions = createMemo(() => props.api.state.session.question(props.session_id))

  const recentParts = createMemo(() => {
    const out: LoosePart[] = []
    for (const message of messages().slice(-RECENT_WINDOW)) {
      for (const raw of props.api.state.part(message.id) ?? []) {
        out.push(asPart(raw))
      }
    }
    return out
  })

  const failedTool = createMemo(() => {
    const failed = recentParts().filter(
      (part) => part.type === "tool" && part.state?.status === "error",
    )
    const last = failed[failed.length - 1]
    if (!last) return ""
    return fitTail(last.state?.title || last.tool || "tool failed", LINE_CHARS)
  })

  const blockedLine = createMemo(() => {
    if (permissions().length > 0) return `awaiting permission (${permissions().length})`
    if (questions().length > 0) return `awaiting your answer (${questions().length})`
    return ""
  })

  const trail = createMemo(() => {
    const done = todos().filter((item) => item.status === "completed")
    let items: string[]
    if (done.length >= 1) {
      items = done.slice(-2).map((item) => truncate(item.content ?? "", TRAIL_ITEM_CHARS))
    } else {
      const completedTools = recentParts()
        .filter(
          (part) => part.type === "tool" && part.state?.status === "completed" && part.state?.title,
        )
        .slice(-2)
      items = completedTools.map((part) => truncate(part.state?.title ?? "", TRAIL_ITEM_CHARS))
    }
    if (!items.length) return ""
    return fitTail(items.join(" · "), LINE_CHARS)
  })

  const barLine = createMemo(() => {
    const list = todos()
    if (!list.length) return ""
    const done = list.filter((item) => item.status === "completed").length
    if (list.length <= BAR_MAX_SEGMENTS) {
      const remaining = list.length - done
      return `${"▰".repeat(done)}${"▱".repeat(remaining)} ${done}/${list.length} steps`
    }
    return `✓ ${done}/${list.length} steps`
  })

  // Headline: a brief, progress-focused description of the task's current
  // state — lifecycle status + completed-step fraction and, while a step is
  // in progress, that step's todo label. Not a mirror of live tool calls.
  const progressSummary = createMemo(() => {
    const list = todos()
    const count = list.length
    const done = list.filter((item) => item.status === "completed").length
    const active = list.find((item) => item.status === "in_progress")
    const stepName = active ? truncate(active.content ?? "", LINE_CHARS) : ""
    const fraction = `${done}/${count}`
    const allDone = count > 0 && done === count
    const type = status()?.type ?? "idle"

    if (type === "busy") {
      if (count === 0) return { fg: theme().accent, label: "● in progress" }
      if (allDone) return { fg: theme().accent, label: `● ${fraction} complete` }
      return {
        fg: theme().accent,
        label: stepName ? `● ${fraction} · ${stepName}` : `● ${fraction}`,
      }
    }
    if (type === "retry") {
      if (count === 0) return { fg: theme().warning, label: "↻ retrying" }
      if (allDone) return { fg: theme().warning, label: `↻ ${fraction} complete` }
      return { fg: theme().warning, label: `↻ ${fraction} · retrying` }
    }
    if (type === "compacting") {
      return { fg: theme().warning, label: "◌ compacting" }
    }
    // idle
    if (allDone) return { fg: theme().textMuted, label: `○ ${fraction} complete` }
    if (count > 0) return { fg: theme().textMuted, label: `○ ${fraction}` }
    return { fg: theme().textMuted, label: "○ ready" }
  })

  const visible = createMemo(
    () => messages().length > 1 || todos().length > 0,
  )

  return (
    <Show when={visible()}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text}>
            <b>Progress</b>
          </text>
          <text fg={progressSummary().fg}>{progressSummary().label}</text>
        </box>
        <Show when={barLine()}>
          <text fg={theme().textMuted}>{barLine()}</text>
        </Show>
        <Show when={trail()}>
          <box flexDirection="row" gap={1}>
            <text fg={theme().success}>✓</text>
            <text fg={theme().textMuted} wrapMode="none">
              {trail()}
            </text>
          </box>
        </Show>
        <Show when={blockedLine()}>
          <box flexDirection="row" gap={1}>
            <text fg={theme().warning}>⚠</text>
            <text fg={theme().warning}>{blockedLine()}</text>
          </box>
        </Show>
        <Show when={failedTool()}>
          <box flexDirection="row" gap={1}>
            <text fg={theme().error}>✗</text>
            <text fg={theme().error} wrapMode="none">
              {failedTool()}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  if (!api?.slots?.register || !api?.state?.session) {
    console.warn("[agent-progress] TUI slot/state API unavailable; skipping registration")
    return
  }

  try {
    api.slots.register({
      order: 200,
      slots: {
        sidebar_content(_ctx, props) {
          return <View api={api} session_id={props.session_id} />
        },
      },
    })
  } catch (err) {
    console.warn("[agent-progress] failed to register sidebar slot:", err)
  }
}

export default {
  id: "agent-progress",
  tui,
}
