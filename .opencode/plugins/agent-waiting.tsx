/**
 * Agent Waiting — TUI sidebar widget (experimental, undocumented API)
 *
 * Shows OTHER sessions (including subagents) that are blocked waiting for
 * user input, above the Context block in the right sidebar:
 *
 *   Waiting 2
 *   ⚠ fix whoop sync          ← awaiting permission (click switches session)
 *   ? refactor routes         ← awaiting question answer
 *
 * Discovery: client.session.list() + state.session.{permission,question}.
 * Reactivity: reconciles on permission/question/session events, with a
 * slow interval as a safety net. Rows for the currently displayed session
 * are hidden (its blockers already show in the Progress widget).
 *
 * Requires opencode >= 1.18.x (validated on 1.18.23). Uses the undocumented
 * TUI plugin API (`@opencode-ai/plugin/tui`) — feature-detected so drift
 * degrades silently. Registered explicitly in tui.json because the
 * auto-glob only covers *.ts/*.js, not *.tsx.
 */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"

const TITLE_CHARS = 52
const RECONCILE_DELAY_MS = 150
const SAFETY_INTERVAL_MS = 20000

type WaitingRow = {
  sessionID: string
  title: string
  kind: "permission" | "question"
  count: number
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

function listOf(result: unknown): Array<{ id?: string; title?: string }> {
  if (Array.isArray(result)) return result
  const wrapper = result as { data?: unknown }
  if (wrapper && Array.isArray(wrapper.data)) return wrapper.data
  return []
}

function createWaitingStore(api: TuiPluginApi) {
  const [rows, setRows] = createSignal<WaitingRow[]>([])

  let debounce: ReturnType<typeof setTimeout> | null = null

  const schedule = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(run, RECONCILE_DELAY_MS)
  }

  for (const type of [
    "session.created",
    "session.deleted",
    "session.updated",
    "session.status",
    "permission.asked",
    "permission.replied",
    "permission.v2.updated",
    "question.updated",
    "question.replied",
  ]) {
    try {
      api.event.on(type as never, () => schedule())
    } catch {
      // event type unknown in this host version — ignore
    }
  }

  async function run() {
    debounce = null
    try {
      const result = await (api.client.session as { list: () => Promise<unknown> }).list()
      const next: WaitingRow[] = []
      for (const session of listOf(result)) {
        if (!session?.id) continue
        const perms = api.state.session.permission(session.id)?.length ?? 0
        const asks = api.state.session.question(session.id)?.length ?? 0
        if (!perms && !asks) continue
        next.push({
          sessionID: session.id,
          title: session.title || "untitled session",
          kind: perms > 0 ? "permission" : "question",
          count: perms + asks,
        })
      }
      next.sort((a, b) => b.count - a.count)
      setRows(next)
    } catch {
      // SDK hiccup — keep previous rows; the interval will retry
    }
  }

  void run()
  const interval = setInterval(run, SAFETY_INTERVAL_MS)

  return {
    rows,
    dispose: () => {
      if (debounce) clearTimeout(debounce)
      clearInterval(interval)
    },
  }
}

function WaitingView(props: {
  api: TuiPluginApi
  store: ReturnType<typeof createWaitingStore>
  session_id: string
}) {
  const theme = () => props.api.theme.current

  const others = createMemo(() =>
    props.store.rows().filter((row) => row.sessionID !== props.session_id),
  )

  const open = async (sessionID: string) => {
    try {
      await (
        props.api.client.tui as unknown as {
          selectSession: (input: { body: { sessionID: string } }) => Promise<unknown>
        }
      ).selectSession({ body: { sessionID } })
    } catch {
      // switching is best-effort
    }
  }

  return (
    <Show when={others().length > 0}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text}>
            <b>Waiting</b>
          </text>
          <text fg={theme().warning}>{others().length}</text>
        </box>
        <For each={others()}>
          {(row) => (
            <box flexDirection="row" gap={1} onMouseDown={() => void open(row.sessionID)}>
              <Show
                when={row.kind === "permission"}
                fallback={<text fg={theme().accent}>?</text>}
              >
                <text fg={theme().warning}>⚠</text>
              </Show>
              <text fg={theme().textMuted} wrapMode="word">
                {truncate(row.title, TITLE_CHARS)}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  if (!api?.slots?.register || !api?.event?.on || !api?.client?.session) {
    console.warn("[agent-waiting] TUI plugin APIs unavailable; skipping registration")
    return
  }

  const store = createWaitingStore(api)
  api.lifecycle?.onDispose?.(store.dispose)

  try {
    api.slots.register({
      order: 50,
      slots: {
        sidebar_content(_ctx, props) {
          return <WaitingView api={api} store={store} session_id={props.session_id} />
        },
      },
    })
  } catch (err) {
    console.warn("[agent-waiting] failed to register sidebar slot:", err)
  }
}

export default {
  id: "agent-waiting",
  tui,
}
