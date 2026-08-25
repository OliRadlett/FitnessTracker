/**
 * Agent Progress — TUI sidebar widget (experimental, undocumented API)
 *
 * Registers into the `sidebar_content` slot (right-hand panel) between the
 * Context and LSP widgets and shows a live narrative of what the agent is
 * doing:
 *
 *   Progress ● working
 *   ▰▰▰▱▱▱ 3/6 steps
 *   ◆ edit backend/app/api/goals.py
 *   ✓ read schema · ✓ update service layer
 *   "...adding validation helpers"
 *   ⚠ awaiting permission            (only when blocked)
 *   ✗ bash: 2 tests failed           (only on error)
 *
 * When the agent goes idle the final snapshot freezes until the next task.
 * Data comes reactively from `api.state`; no polling.
 *
 * Requires opencode >= 1.18.x (validated on 1.18.23). Uses the undocumented
 * TUI plugin API (`@opencode-ai/plugin/tui`) which may change between
 * versions — feature-detected below so drift degrades silently.
 * Registered explicitly in tui.json because the auto-glob only covers
 * *.ts/*.js, not *.tsx.
 */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createComputed, createMemo, createSignal, For, Show } from "solid-js"

const LINE_CHARS = 30
const TRAIL_ITEM_CHARS = 12
const MAX_RUNNING_SHOWN = 1
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

const VERBS: Record<string, string> = {
  read: "reading",
  edit: "editing",
  multiedit: "editing",
  write: "writing",
  apply_patch: "patching",
  bash: "running",
  task: "delegating",
  glob: "searching",
  grep: "searching",
  list: "listing",
  webfetch: "fetching",
  websearch: "searching",
  todowrite: "planning",
  question: "asking",
}

function targetOf(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim()
  const path = flat.match(/([\w@.-]+[/\\])*([\w@.-]+\.[A-Za-z0-9]{1,8})\)?$/)
  if (path) return path[2]
  const tokens = flat.split(" ").filter(Boolean)
  return tokens[tokens.length - 1] ?? flat
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

  const runningTools = createMemo(() =>
    recentParts()
      .filter((part) => {
        if (part.type !== "tool") return false
        return part.state?.status === "running" || part.state?.status === "pending"
      })
      .slice(-MAX_RUNNING_SHOWN),
  )

  const failedTool = createMemo(() => {
    const failed = recentParts().filter((part) => part.type === "tool" && part.state?.status === "error")
    const last = failed[failed.length - 1]
    if (!last) return ""
    return fitTail(last.state?.title || last.tool || "tool failed", LINE_CHARS)
  })

  const activeTodo = createMemo(() => {
    const list = todos()
    const current = list.find((item) => item.status === "in_progress")
    return current ? truncate(current.content ?? "", LINE_CHARS) : ""
  })

  const blockedLine = createMemo(() => {
    if (permissions().length > 0) return `awaiting permission (${permissions().length})`
    if (questions().length > 0) return `awaiting your answer (${questions().length})`
    return ""
  })

  // Where-it's-at summary: running tool (verb + target) → active todo step
  // → "thinking…" while the model generates between tools. Frozen via
  // lastSummary so the snapshot persists when idle.
  const liveSummary = createMemo<{ label: string; thinking: boolean } | null>(() => {
    if (blockedLine()) return null
    const running = runningTools()[runningTools().length - 1]
    if (running) {
      const tool = (running.tool ?? "").toLowerCase()
      const verb = VERBS[tool] ?? `${tool || "working"}…`
      const target = running.state?.title ? targetOf(running.state.title) : ""
      const label = truncate(target ? `${verb} ${target}` : verb, LINE_CHARS)
      return { label, thinking: false }
    }
    const active = activeTodo()
    if (active) return { label: active, thinking: false }
    if (status()?.type === "busy") return { label: "thinking…", thinking: true }
    return null
  })

  const [lastSummary, setLastSummary] = createSignal<{ label: string; thinking: boolean } | null>(null)
  createComputed(() => {
    const current = liveSummary()
    if (current) setLastSummary(current)
  })
  const summary = createMemo(() => liveSummary() ?? lastSummary())

  const trail = createMemo(() => {
    const done = todos().filter((item) => item.status === "completed")
    let items: string[]
    if (done.length >= 1) {
      items = done.slice(-2).map((item) => truncate(item.content ?? "", TRAIL_ITEM_CHARS))
    } else {
      const completedTools = recentParts()
        .filter((part) => part.type === "tool" && part.state?.status === "completed" && part.state?.title)
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

  const statusInfo = createMemo(() => {
    const type = status()?.type ?? "idle"
    if (type === "busy") return { label: "● working", fg: theme().accent }
    if (type === "retry") return { label: "↻ retrying", fg: theme().warning }
    if (type === "compacting") return { label: "◌ compacting", fg: theme().warning }
    if (type === "idle") return { label: "○ idle", fg: theme().textMuted }
    return { label: `● ${type}`, fg: theme().warning }
  })

  const visible = createMemo(
    () => messages().length > 1 || todos().length > 0 || runningTools().length > 0,
  )

  return (
    <Show when={visible()}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text}>
            <b>Progress</b>
          </text>
          <text fg={statusInfo().fg}>{statusInfo().label}</text>
        </box>
        <Show when={barLine()}>
          <text fg={theme().textMuted}>{barLine()}</text>
        </Show>
        <Show when={summary()}>
          <box flexDirection="row" gap={1}>
            <Show when={summary()!.thinking} fallback={<text fg={theme().accent}>◆</text>}>
              <text fg={theme().textMuted}>◇</text>
            </Show>
            <text fg={summary()!.thinking ? theme().textMuted : theme().text} wrapMode="none">
              {summary()!.label}
            </text>
          </box>
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
