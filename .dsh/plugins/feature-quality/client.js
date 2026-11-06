/**
 * Client half: a "Quality prompt" control above the message composer.
 *
 * Collapsed it is one row — a button and, once a run exists, its evidence count.
 * Expanded it is a launcher, not a form: the four inputs that gate submission are
 * always visible, the seven that may stay placeholders sit behind a disclosure,
 * and the delivered message is summarised before it is shown in full.
 *
 * Submitting posts the same `/quality …` line the slash command takes to the
 * plugin's host route, so both entry points run one operation and log the same
 * `command/run` — including the same required-field refusal.
 *
 * Nothing leaves the browser except the line: the draft and the recent list live
 * in `localStorage`, keyed per browser, and are cleared on submit.
 *
 * Colours are `--dsw-alias-*` tokens with literal fallbacks, so a token missing
 * from the hosting theme degrades to a legible control instead of an invisible
 * one. Plain JS, no JSX: the factory receives React from the browser module
 * table and nothing else.
 */
window.__ModuleLoader__.load({
  id: '@local/feature-quality',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useRef, useEffect } = React

    const COMMAND_NAME = 'quality'
    const SLOT = 'conversation.input.dock'
    const START_URL = '/plugins/feature-quality/start'
    const PREVIEW_URL = '/plugins/feature-quality/preview'
    const STATUS_URL = '/plugins/feature-quality/status'
    const DEFAULTS_URL = '/plugins/feature-quality/defaults'
    const REQUEST_TIMEOUT_MS = 20000
    const PREVIEW_DEBOUNCE_MS = 300
    const DRAFT_KEY = 'dsh.feature-quality.draft.v2'
    const RECENT_KEY = 'dsh.feature-quality.recent.v1'
    const RECENT_LIMIT = 5
    const STYLE_ID = 'feature-quality-style'

    /**
     * Mirrors `FIELDS` in `index.js`. The wiring lab compares the two lists, so
     * a field added on one side and forgotten on the other fails a check instead
     * of surfacing as a gap the host silently fills.
     */
    const FIELDS = [
      { key: 'FEATURE', label: 'FEATURE', tier: 'required', hint: 'Ride quality badge on the routes page' },
      {
        key: 'SURFACE', label: 'SURFACE', tier: 'required',
        hint: 'page / flow / API / algorithm / integration',
        options: ['page', 'flow', 'API', 'algorithm', 'integration'],
      },
      { key: 'USER_JOB', label: 'USER JOB', tier: 'required', hint: 'what the user is trying to get done', placeholder: 'what the user needs' },
      { key: 'CURRENT_STATE', label: 'CURRENT STATE', tier: 'optional', hint: 'links, screenshots, plans, code' },
      { key: 'REAL_FIXTURE', label: 'REAL FIXTURE', tier: 'optional', hint: 'one real ride / week / account / dataset' },
      { key: 'REFERENCES', label: 'REFERENCES', tier: 'optional', hint: '3\u20135 links or frames that show "good"' },
      { key: 'ANTI_REFERENCES', label: 'ANTI-REFERENCES', tier: 'optional', hint: '1\u20132 links or frames to avoid' },
      { key: 'EXTERNAL_SOURCES', label: 'EXTERNAL SOURCES', tier: 'optional', hint: 'APIs, map providers, models, data' },
      { key: 'PRODUCTION_LIMITS', label: 'PRODUCTION LIMITS', tier: 'optional', hint: 'keys, cost, mobile, offline, ToS' },
      {
        key: 'FIRST_LOOK', label: 'FIRST LOOK', tier: 'optional',
        hint: 'date or "5\u201310 working days"',
        suggestions: ['5 working days', '10 working days'],
      },
      { key: 'OWNER', label: 'OWNER', tier: 'required', hint: 'who is accountable for the artifact', placeholder: 'who is accountable' },
    ]

    const REQUIRED_FIELDS = FIELDS.filter((field) => field.tier === 'required')
    const OPTIONAL_FIELDS = FIELDS.filter((field) => field.tier === 'optional')

    const TEXT = 'var(--dsw-alias-label-primary, #18181b)'
    const MUTED = 'var(--dsw-alias-label-secondary, #52525b)'
    const SUBTLE = 'var(--dsw-alias-label-tertiary, #71717a)'
    const BORDER = 'var(--dsw-alias-border-l1, #e4e4e7)'
    const BORDER_STRONG = 'var(--dsw-alias-border-l2, #a1a1aa)'
    const SURFACE = 'var(--dsw-alias-bg-layer-1, #fafafa)'
    const RAISED = 'var(--dsw-alias-bg-layer-2, #f4f4f5)'
    const DANGER = 'var(--dsw-alias-state-error-primary, #b42318)'
    const SUCCESS = 'var(--dsw-alias-state-success-primary, #1a7f37)'
    const BRAND = 'var(--dsw-alias-brand-primary, #2563eb)'
    const BRAND_SOFT = 'color-mix(in srgb, var(--dsw-alias-brand-primary, #2563eb) 18%, transparent)'

    const style = {
      row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '2px 2px 4px' },
      toggle: {
        display: 'inline-flex', alignItems: 'center', gap: 5,
        border: `1px solid ${BORDER}`,
        background: 'transparent',
        color: MUTED,
        borderRadius: 8, padding: '2px 7px 2px 6px',
        font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer',
        flex: 'none',
      },
      toggleOpen: { background: RAISED, color: TEXT },
      meter: { fontSize: 11, lineHeight: '16px', color: MUTED, flex: 'none', whiteSpace: 'nowrap' },
      meterDone: { fontSize: 11, lineHeight: '16px', color: SUCCESS, flex: 'none', whiteSpace: 'nowrap' },
      run: {
        border: `1px solid ${BORDER}`,
        background: 'transparent', color: SUBTLE,
        borderRadius: 999, padding: '0 8px',
        font: 'inherit', fontSize: 11, lineHeight: '17px', cursor: 'pointer',
        flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
      panel: {
        border: `1px solid ${BORDER}`,
        background: SURFACE,
        borderRadius: 12, padding: '10px 12px 11px',
        display: 'flex', flexDirection: 'column', gap: 10,
        maxHeight: 'min(56vh, 520px)',
      },
      // The body scrolls, the footer does not: a preview of a 16 KB message must
      // never push "Start prompt" out of the panel.
      panelBody: {
        display: 'flex', flexDirection: 'column', gap: 10,
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto', paddingRight: 2,
      },
      // auto-fit, not a fixed pair: the same markup is two columns on a desktop
      // dock and one on a narrow window, without a media query. `flexShrink: 0`
      // on every direct child of the scroll body is load-bearing — without it the
      // message box and the run strip squeeze each other instead of scrolling.
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px 10px', flexShrink: 0 },
      optionalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px 10px', flexShrink: 0 },
      field: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexShrink: 0 },
      label: {
        color: MUTED, fontSize: 10, lineHeight: '14px', letterSpacing: '0.04em',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      },
      labelRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
      presetBadge: {
        border: `1px solid ${BORDER}`, background: 'transparent', color: SUBTLE,
        borderRadius: 999, padding: '0 6px', font: 'inherit',
        fontSize: 9, lineHeight: '15px', letterSpacing: '0.03em',
        cursor: 'pointer', flex: 'none',
      },
      requiredMark: { color: DANGER, fontSize: 10, lineHeight: '14px' },
      input: {
        width: '100%', boxSizing: 'border-box',
        border: `1px solid ${BORDER}`,
        background: RAISED,
        color: TEXT,
        borderRadius: 6, padding: '4px 8px', font: 'inherit', fontSize: 12, lineHeight: '18px',
        caretColor: BRAND,
        transition: 'border-color 90ms ease, box-shadow 90ms ease',
        outline: 'none',
      },
      inputFocused: { borderColor: BRAND, boxShadow: `0 0 0 3px ${BRAND_SOFT}` },
      inputInvalid: { borderColor: DANGER },
      sectionRow: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4,
        borderTop: `1px solid ${BORDER}`, paddingTop: 8, minWidth: 0,
        flexShrink: 0,
      },
      disclosure: {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: 0, background: 'transparent', padding: 0,
        font: 'inherit', color: MUTED, fontSize: 11, lineHeight: '18px', cursor: 'pointer',
        flex: 'none',
      },
      // The summary row wraps rather than shrinking its pills: at a phone-width
      // dock three ellipses ("feat…", "11 placehol…") carry no information.
      sectionTitle: { color: MUTED, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap', flexShrink: 0 },
      pill: {
        border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED,
        borderRadius: 999, padding: '0 7px', fontSize: 10, lineHeight: '16px',
        whiteSpace: 'nowrap', flexShrink: 0, maxWidth: 200,
        overflow: 'hidden', textOverflow: 'ellipsis',
      },
      pillOk: {
        border: `1px solid ${BORDER}`, background: 'transparent', color: SUCCESS,
        borderRadius: 999, padding: '0 7px', fontSize: 10, lineHeight: '16px',
        whiteSpace: 'nowrap', flexShrink: 0,
      },
      hint: { color: MUTED, fontSize: 11, lineHeight: '16px' },
      banner: {
        display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap',
        border: `1px solid ${BORDER}`, background: RAISED, borderRadius: 8,
        padding: '5px 8px', color: MUTED, fontSize: 11, lineHeight: '16px', flexShrink: 0,
      },
      bannerLabel: { color: TEXT, fontSize: 11 },
      pre: {
        margin: 0, maxHeight: 210, overflow: 'auto',
        border: `1px solid ${BORDER}`, background: RAISED, borderRadius: 8,
        padding: '8px 10px', flexShrink: 0,
        color: TEXT, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11, lineHeight: '16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
      runPanel: { display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '4px 10px' },
      chip: { color: MUTED, fontSize: 11, lineHeight: '16px', cursor: 'default' },
      chipMet: { color: TEXT, fontSize: 11, lineHeight: '16px', cursor: 'default' },
      footer: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        flex: 'none', borderTop: `1px solid ${BORDER}`, paddingTop: 8,
      },
      // Start is differentiated by weight and border, never by a fill whose text
      // colour could collide with it.
      primary: {
        border: `1px solid ${BORDER_STRONG}`,
        background: RAISED, color: TEXT,
        borderRadius: 6, padding: '3px 12px', font: 'inherit', fontSize: 12,
        lineHeight: '18px', cursor: 'pointer', fontWeight: 600,
      },
      primaryBusy: {
        border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED,
        borderRadius: 6, padding: '3px 12px', font: 'inherit', fontSize: 12,
        lineHeight: '18px', cursor: 'default', fontWeight: 600,
      },
      primaryBlocked: {
        border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED,
        borderRadius: 6, padding: '3px 12px', font: 'inherit', fontSize: 12,
        lineHeight: '18px', cursor: 'not-allowed', fontWeight: 600,
      },
      secondary: {
        border: `1px solid ${BORDER}`,
        background: 'transparent', color: TEXT,
        borderRadius: 6, padding: '3px 10px', font: 'inherit', fontSize: 12,
        lineHeight: '18px', cursor: 'pointer',
      },
      count: { color: SUBTLE, fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' },
      note: { color: MUTED, fontSize: 11, marginLeft: 'auto' },
      ok: { color: SUCCESS, fontSize: 11, marginLeft: 'auto' },
      error: { color: DANGER, fontSize: 11, marginLeft: 'auto' },
      hidden: {
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
      },
    }

    function chevron(open) {
      return h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true,
        style: {
          display: 'block', flex: 'none', transition: 'transform 120ms ease',
          transform: open ? 'rotate(90deg)' : 'none',
        },
      }, h('path', {
        d: 'M6 3.5l4.5 4.5L6 12.5', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /** Session-scoped slots carry the receiving session under one of these. */
    function resolveSessionId(props) {
      const candidate = props?.sessionId
        ?? props?.session?.id
        ?? props?.session?.sessionId
        ?? props?.agentId
      return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
    }

    function collapse(value) {
      return String(value ?? '').replace(/\s+/gu, ' ').trim()
    }

    function storage() {
      try {
        return typeof localStorage === 'undefined' ? undefined : localStorage
      } catch {
        return undefined
      }
    }

    function readJson(key) {
      const store = storage()
      if (store === undefined) return undefined
      try {
        const raw = store.getItem(key)
        return raw === null ? undefined : JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    function writeJson(key, value) {
      const store = storage()
      if (store === undefined) return
      try {
        if (value === undefined) store.removeItem(key)
        else store.setItem(key, JSON.stringify(value))
      } catch {
        // A full or disabled store must not break the control.
      }
    }

    function loadDraft() {
      const draft = readJson(DRAFT_KEY)
      return {
        values: draft !== null && typeof draft === 'object' && draft.values !== null && typeof draft.values === 'object'
          ? draft.values
          : {},
        freshSession: typeof draft?.freshSession === 'boolean' ? draft.freshSession : true,
      }
    }

    function loadRecent() {
      const recent = readJson(RECENT_KEY)
      return Array.isArray(recent) ? recent.filter((entry) => typeof entry?.feature === 'string') : []
    }

    /** The one built-in scrollbar surface the caller cannot style inline. */
    function ensureScrollerStyle() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = [
        '[data-feature-quality-body]{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#a1a1aa) transparent}',
        '[data-feature-quality-body]::-webkit-scrollbar{width:8px;height:8px}',
        '[data-feature-quality-body]::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#a1a1aa);border-radius:8px}',
        '[data-feature-quality-body]::-webkit-scrollbar-track{background:transparent}',
      ].join('')
      document.head.appendChild(element)
    }

    function prefersReducedMotion() {
      try {
        return typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        return false
      }
    }

    /**
     * The command line for these inputs. Empty fields are omitted, so the
     * prompt keeps its original bracketed description for them.
     */
    function buildLine(values) {
      const parts = []
      for (const field of FIELDS) {
        const value = collapse(values[field.key])
        if (value.length > 0) parts.push(`${field.label}: ${value}`)
      }
      return parts.length === 0 ? `/${COMMAND_NAME}` : `/${COMMAND_NAME} ${parts.join(' | ')}`
    }

    function missingRequiredFields(values) {
      return FIELDS.filter((field) => field.tier === 'required' && collapse(values[field.key]) === '')
    }

    /** POST JSON to one of the plugin's routes. */
    async function post(url, payload, signal) {
      return fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
    }

    function statusLabel(status) {
      if (status === undefined || status?.found === false) return undefined
      return `run ${status.met}/${status.total}`
    }

    function statusTitle(status) {
      if (status === undefined || status?.found === false) return 'No quality run recorded for this workspace yet'
      const lines = [`Quality run: ${status.slug}`, '']
      for (const deliverable of status.deliverables) {
        lines.push(`${deliverable.exists ? '\u2713' : '\u00b7'} ${deliverable.id} ${deliverable.label} — ${deliverable.path}${deliverable.exists ? ` (${deliverable.detail})` : ''}`)
      }
      if (status.next !== null) lines.push('', `Next: ${status.next.label} (${status.next.path})`)
      if (typeof status.note === 'string') lines.push(status.note)
      return lines.join('\n')
    }

    function QualityPrompt(props) {
      // Read from the device once, not once per render.
      const [initial] = useState(loadDraft)
      const [open, setOpen] = useState(false)
      const [values, setValues] = useState(initial.values)
      const [freshSession, setFreshSession] = useState(initial.freshSession)
      const [status, setStatus] = useState(undefined)
      const [busy, setBusy] = useState(false)
      const [run, setRun] = useState(undefined)
      const [preview, setPreview] = useState(undefined)
      const [previewError, setPreviewError] = useState(undefined)
      const [recent] = useState(loadRecent)
      const [touched, setTouched] = useState({})
      const [focusKey, setFocusKey] = useState(undefined)
      const [presetKeys, setPresetKeys] = useState([])
      const [presetValues, setPresetValues] = useState({})
      const [optionalOpen, setOptionalOpen] = useState(false)
      const [messageOpen, setMessageOpen] = useState(false)
      const [runOpen, setRunOpen] = useState(false)
      const [entered, setEntered] = useState(false)
      const firstField = useRef(undefined)

      const sessionId = resolveSessionId(props)
      const missing = missingRequiredFields(values)
      const filled = FIELDS.filter((field) => collapse(values[field.key]).length > 0).length
      const optionalFilled = OPTIONAL_FIELDS.filter((field) => collapse(values[field.key]).length > 0).length
      const requiredFilled = REQUIRED_FIELDS.length - missing.length

      // Presets arrive from the host's `defaults.json`, so the form and the
      // `/quality` command fill from the same file. They never overwrite a draft:
      // a half-written brief is the user's, not the file's.
      useEffect(() => {
        if (sessionId === undefined) return undefined
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        post(DEFAULTS_URL, {}, controller.signal)
          .then(async (response) => {
            const body = await response.json().catch(() => undefined)
            if (!response.ok || body?.defaults === undefined) return
            const defaults = body.defaults
            const keys = Object.keys(defaults).filter((key) => typeof defaults[key] === 'string' && collapse(defaults[key]) !== '')
            if (keys.length === 0) return
            setValues((current) => {
              // A draft wins; so does anything typed before the file arrived.
              if (Object.keys(current).some((key) => collapse(current[key]) !== '')) return current
              const next = { ...current }
              for (const key of keys) next[key] = defaults[key]
              return next
            })
            setPresetValues(defaults)
            setPresetKeys((current) => (current.length > 0 ? current : keys))
          })
          .catch(() => {})
          .finally(() => clearTimeout(timer))
        return () => {
          clearTimeout(timer)
          controller.abort()
        }
      }, [sessionId])

      useEffect(() => {
        if (!open) return
        const node = firstField.current
        if (node !== null && typeof node?.focus === 'function') node.focus()
      }, [open])

      // Scrollbar styling is a real browser surface and cannot be set inline.
      useEffect(() => {
        ensureScrollerStyle()
        return undefined
      }, [])

      // One authored moment: the panel settles open. Opacity and a 2px rise only,
      // and nothing at all when the reader asked for reduced motion.
      useEffect(() => {
        if (!open) {
          setEntered(false)
          return undefined
        }
        if (prefersReducedMotion()) {
          setEntered(true)
          return undefined
        }
        const schedule = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (callback) => setTimeout(callback, 0)
        const frame = schedule(() => setEntered(true))
        return () => {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
          else clearTimeout(frame)
        }
      }, [open])

      // Draft survives a reload and a closed panel; it is not a server record.
      useEffect(() => {
        if (filled === 0) writeJson(DRAFT_KEY, undefined)
        else writeJson(DRAFT_KEY, { values, freshSession })
      }, [values, freshSession, filled])

      // The run strip is cheap (a filesystem scan on the host) and only useful
      // while a session is attached. Re-reading it on open keeps the ticks
      // current without polling.
      useEffect(() => {
        if (sessionId === undefined) return undefined
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        post(STATUS_URL, { sessionId }, controller.signal)
          .then(async (response) => {
            const body = await response.json().catch(() => undefined)
            if (response.ok && body?.ok !== false) setRun({ value: body })
          })
          .catch(() => {})
          .finally(() => clearTimeout(timer))
        return () => {
          clearTimeout(timer)
          controller.abort()
        }
      }, [sessionId, open])

      // The preview is the exact message the host would submit, so it is built by
      // the host rather than approximated here. It is always live while the panel
      // is open: the summary line is the cheapest way to see what is missing.
      useEffect(() => {
        if (!open) return undefined
        const controller = new AbortController()
        const timer = setTimeout(() => {
          post(PREVIEW_URL, { line: buildLine(values) }, controller.signal)
            .then(async (response) => {
              const body = await response.json().catch(() => undefined)
              if (response.ok) {
                setPreview(body)
                setPreviewError(undefined)
              } else {
                setPreview(undefined)
                setPreviewError(body?.error ?? `Preview failed (${response.status}).`)
              }
            })
            .catch((error) => {
              if (error?.name !== 'AbortError') setPreviewError(error instanceof Error ? error.message : String(error))
            })
        }, PREVIEW_DEBOUNCE_MS)
        return () => {
          clearTimeout(timer)
          controller.abort()
        }
      }, [open, values])

      const submit = async () => {
        if (busy) return
        if (sessionId === undefined) {
          setStatus({ kind: 'error', text: 'Open a session first.' })
          return
        }
        if (missing.length > 0) {
          const node = firstField.current
          if (node !== null && typeof node?.focus === 'function') node.focus()
          setStatus({ kind: 'error', text: `Required before the prompt can start: ${missing.map((field) => field.label).join(', ')}.` })
          return
        }
        setBusy(true)
        setStatus({ kind: 'pending', text: 'Starting\u2026' })
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const response = await post(START_URL, {
            sessionId,
            line: buildLine(values),
            mode: freshSession ? 'new' : 'current',
          }, controller.signal)
          // An unregistered path falls through to the SPA fallback, which answers
          // HTML (405 for a POST). Only the plugin route answers JSON.
          const contentType = response.headers.get('content-type') ?? ''
          if (!contentType.includes('application/json')) {
            setStatus({
              kind: 'error',
              text: 'The request reached the web app, not the plugin route. The host half has not registered it — restart the app.',
            })
            return
          }
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            setStatus({ kind: 'error', text: body.error ?? `The harness refused the request (${response.status}).` })
            return
          }
          if (body.ok === false) {
            setStatus({ kind: 'error', text: body.error ?? 'The prompt was rejected.' })
            return
          }
          setStatus({ kind: 'ok', text: body.text ?? 'Quality prompt submitted.' })
          if (body.status !== undefined) setRun({ value: body.status })
          const feature = collapse(values.FEATURE)
          if (feature !== '') {
            const next = [{ feature, values, at: new Date().toISOString() }]
              .concat(recent.filter((entry) => entry.feature !== feature))
              .slice(0, RECENT_LIMIT)
            writeJson(RECENT_KEY, next)
          }
          setValues({})
          setPresetKeys([])
          setPreview(undefined)
          setMessageOpen(false)
          setOpen(false)
        } catch (error) {
          const text = error?.name === 'AbortError'
            ? `No answer from the harness within ${REQUEST_TIMEOUT_MS / 1000}s.`
            : (error instanceof Error ? error.message : String(error))
          setStatus({ kind: 'error', text })
          console.warn('[feature-quality] start failed', error)
        } finally {
          clearTimeout(timer)
          setBusy(false)
        }
      }

      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [open, values, freshSession, busy])

      const setField = (key) => (event) => {
        const next = event.target.value
        setValues((current) => ({ ...current, [key]: next }))
        // Typing over a preset makes it the user's value, not the file's.
        setPresetKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : current))
      }

      /** Clear one preset back to its placeholder. */
      const clearPreset = (key) => () => {
        setValues((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
        setPresetKeys((current) => current.filter((item) => item !== key))
      }

      const runStatus = run?.value
      const badge = statusLabel(runStatus)
      const runVisible = runStatus !== undefined && runStatus?.found !== false

      const fieldNode = (field, isFirst) => {
        const required = field.tier === 'required'
        const empty = collapse(values[field.key]) === ''
        // A mark means "this value is the preset, untouched". Deriving it from the
        // value keeps it honest when a draft blocked the preset, when the field was
        // cleared, and when the user typed something else (even the same string).
        const presetValue = presetValues[field.key]
        const isPreset = typeof presetValue === 'string'
          && presetKeys.includes(field.key)
          && collapse(values[field.key]) === collapse(presetValue)
        // A pristine form is not an error state: the mark says "required", and the
        // border only turns red once that field has been left empty.
        const invalid = required && empty && touched[field.key] === true
        const focused = focusKey === field.key
        const inputStyle = invalid
          ? { ...style.input, ...style.inputInvalid }
          : focused ? { ...style.input, ...style.inputFocused } : style.input
        const markTouched = () => {
          setFocusKey(undefined)
          setTouched((current) => (current[field.key] === true ? current : { ...current, [field.key]: true }))
        }
        return h('div', {
          key: field.key,
          style: field.key === 'FEATURE' ? { ...style.field, gridColumn: '1 / -1' } : style.field,
        },
          h('div', { style: style.labelRow },
            h('label', { htmlFor: `fq-input-${field.key}`, style: style.label },
              field.label,
              required
                ? h('span', { style: style.requiredMark, title: 'Required before the prompt can start', 'aria-hidden': true }, '*')
                : null,
            ),
            // A preset is the user's value the moment they keep it, so it must be
            // visible as one: marked, and one click from going back to a placeholder.
            isPreset
              ? h('button', {
                  type: 'button',
                  style: style.presetBadge,
                  title: 'Preset from defaults.json — click to clear',
                  'data-feature-quality-preset': field.key,
                  onClick: clearPreset(field.key),
                }, 'preset \u00d7')
              : null,
            h('span', { id: `fq-why-${field.key}`, style: style.hidden },
              required ? 'Required. ' : 'Optional. ',
              field.hint),
          ),
          field.options === undefined
            ? h('input', {
                id: `fq-input-${field.key}`,
                ref: isFirst ? firstField : undefined,
                type: 'text',
                value: values[field.key] ?? '',
                placeholder: field.placeholder ?? field.hint,
                spellCheck: false,
                autoComplete: 'off',
                'data-feature-quality-field': field.key,
                'aria-required': required,
                'aria-invalid': invalid,
                'aria-describedby': `fq-why-${field.key}`,
                list: field.suggestions === undefined ? undefined : `fq-${field.key}`,
                style: inputStyle,
                onChange: setField(field.key),
                onFocus: () => setFocusKey(field.key),
                onBlur: markTouched,
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submit()
                  }
                },
              })
            : h('select', {
                id: `fq-input-${field.key}`,
                value: values[field.key] ?? '',
                style: inputStyle,
                'data-feature-quality-field': field.key,
                'aria-required': required,
                'aria-invalid': invalid,
                'aria-describedby': `fq-why-${field.key}`,
                onChange: setField(field.key),
                onFocus: () => setFocusKey(field.key),
                onBlur: markTouched,
              },
                h('option', { value: '' }, 'choose\u2026'),
                ...field.options.map((option) => h('option', { key: option, value: option }, option)),
              ),
          field.suggestions === undefined
            ? null
            : h('datalist', { id: `fq-${field.key}` },
                ...field.suggestions.map((value) => h('option', { key: value, value }))),
        )
      }

      const statusNode = status === undefined
        ? null
        : h('span', {
            role: status.kind === 'error' ? 'alert' : 'status',
            'aria-live': 'polite',
            style: status.kind === 'error' ? style.error : status.kind === 'ok' ? style.ok : style.note,
          }, status.text)

      const trigger = h('button', {
        type: 'button',
        'aria-expanded': open,
        'aria-controls': 'feature-quality-panel',
        'data-feature-quality-trigger': true,
        title: open ? 'Close the Quality prompt' : 'Open the Generic Feature Quality Prompt',
        style: open ? { ...style.toggle, ...style.toggleOpen } : style.toggle,
        onClick: () => {
          setOpen((value) => !value)
          if (open) setStatus(undefined)
        },
      }, chevron(open), 'Quality prompt')

      const runBadge = badge === undefined
        ? null
        : h('button', {
            type: 'button',
            'data-feature-quality-run': true,
            title: statusTitle(runStatus),
            style: style.run,
            'aria-expanded': open && runOpen,
            onClick: () => {
              setOpen(true)
              // One detail at a time: the message is 210px of text, and the run
              // details must not open underneath it.
              setMessageOpen(false)
              setRunOpen((value) => !value)
            },
          }, badge)

      if (!open) {
        const draftGap = filled > 0 && missing.length > 0
          ? h('span', { style: style.meter, 'data-feature-quality-gap': true },
              `${missing.length} required left`)
          : null
        return h('div', { style: style.row, 'data-feature-quality': 'collapsed' },
          trigger,
          draftGap,
          runBadge,
          statusNode,
        )
      }

      const meterNode = h('span', {
        style: missing.length === 0 ? style.meterDone : style.meter,
        'data-feature-quality-meter': true,
      }, missing.length === 0
        ? `\u2713 ${requiredFilled} of ${REQUIRED_FIELDS.length} required`
        : `${requiredFilled} of ${REQUIRED_FIELDS.length} required`)

      const submitButton = h('button', {
        type: 'button',
        style: busy ? style.primaryBusy : missing.length === 0 ? style.primary : style.primaryBlocked,
        disabled: busy || missing.length > 0,
        title: missing.length === 0
          ? 'Submit and start Phase 0'
          : `Fill ${missing.map((field) => field.label).join(', ')} first`,
        'data-feature-quality-submit': true,
        onClick: () => submit(),
      }, busy ? 'Starting\u2026' : missing.length === 0 ? 'Start prompt' : `Fill ${missing.length} required`)

      // Guidance, not an error: the form opens with the gap named, and the line
      // disappears the moment the four are there.
      const gapLine = missing.length > 0
        ? h('div', { style: style.banner, 'data-feature-quality-gap': true },
            h('span', { style: style.bannerLabel }, filled === 0 ? 'Four inputs start it' : 'Still required'),
            h('span', {}, filled === 0 ? '\u2014 the other seven may stay placeholders; Phase 0 resolves them.' : `\u2014 ${missing.map((field) => field.label).join(', ')}`),
          )
        : null

      const previewChips = preview === undefined
        ? []
        : [
            h('span', { key: 'slug', style: style.pill, title: 'run slug — the deliverable paths use it' }, preview.slug),
            preview.surface === null || preview.surface === undefined
              ? null
              : h('span', { key: 'surface', style: style.pill }, preview.surface),
            h('span', { key: 'supplied', style: style.pill }, `${preview.supplied}/${FIELDS.length}`),
            (preview.unfilled ?? []).length === 0
              ? h('span', { key: 'complete', style: style.pillOk }, 'no placeholders')
              : h('span', { key: 'unfilled', style: style.pill }, `${(preview.unfilled ?? []).length} placeholder${(preview.unfilled ?? []).length === 1 ? '' : 's'}`),
          ].filter(Boolean)

      const messageRow = h('div', { style: style.sectionRow },
        h('span', { style: style.sectionTitle }, 'What will be sent'),
        ...previewChips,
        previewError === undefined
          ? null
          : h('span', { style: { color: DANGER, fontSize: 11 }, role: 'alert' }, previewError),
        h('button', {
          type: 'button',
          style: { ...style.disclosure, marginLeft: 'auto', whiteSpace: 'nowrap' },
          'aria-expanded': messageOpen,
          'data-feature-quality-message-toggle': true,
          onClick: () => {
            setRunOpen(false)
            setMessageOpen((value) => !value)
          },
        }, chevron(messageOpen), messageOpen ? 'Hide message' : 'Show message'),
      )

      const optionalHeader = h('button', {
        type: 'button',
        style: style.disclosure,
        'aria-expanded': optionalOpen,
        'aria-controls': 'feature-quality-optional',
        'data-feature-quality-optional-toggle': true,
        onClick: () => setOptionalOpen((value) => !value),
      },
        chevron(optionalOpen),
        optionalOpen ? 'Hide optional inputs' : `${OPTIONAL_FIELDS.length} optional inputs`,
        h('span', { style: optionalFilled === 0 ? style.pill : style.pillOk },
          optionalFilled === 0 ? 'all placeholders' : `${optionalFilled} filled`),
      )

      const panelStyle = {
        ...style.panel,
        opacity: entered ? 1 : 0,
        transform: entered ? 'none' : 'translateY(-2px)',
        transition: prefersReducedMotion() ? 'none' : 'opacity 120ms ease, transform 120ms ease',
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, 'data-feature-quality': 'open' },
        h('div', { style: style.row }, trigger, meterNode, runBadge, statusNode),
        h('div', {
          style: panelStyle,
          id: 'feature-quality-panel',
          role: 'group',
          'aria-label': 'Generic Feature Quality Prompt inputs',
        },
          h('div', { style: style.panelBody, 'data-feature-quality-body': true },
            gapLine,
            h('div', { style: style.grid }, ...REQUIRED_FIELDS.map((field, index) => fieldNode(field, index === 0))),
            h('label', {
              style: { ...style.field, flexDirection: 'row', alignItems: 'center', gap: 6 },
            },
              h('input', {
                type: 'checkbox',
                checked: freshSession,
                onChange: (event) => setFreshSession(event.target.checked),
                style: { margin: 0, accentColor: BRAND },
                'data-feature-quality-fresh': true,
              }),
              h('span', { style: { ...style.label, letterSpacing: 0, color: TEXT } }, 'New session'),
              h('span', { style: { color: SUBTLE, fontSize: 11 } }, '\u2014 the prompt becomes its first message'),
            ),
            h('div', { style: style.sectionRow }, optionalHeader),
            optionalOpen
              ? h('div', { id: 'feature-quality-optional', style: style.optionalGrid },
                  ...OPTIONAL_FIELDS.map((field) => fieldNode(field, false)))
              : null,
            messageRow,
            messageOpen && preview !== undefined
              ? h('pre', { style: style.pre, 'data-feature-quality-message': true }, preview.text)
              : null,
            runVisible && runOpen
              ? h('div', { style: { ...style.runPanel, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }, 'data-feature-quality-status': 'open' },
                  h('div', { style: style.chips },
                    ...(runStatus.deliverables ?? []).map((deliverable) => h('span', {
                      key: deliverable.key,
                      style: deliverable.exists ? style.chipMet : style.chip,
                      title: `${deliverable.path}\n${deliverable.detail}`,
                    }, `${deliverable.exists ? '\u2713' : '\u00b7'} ${deliverable.label}`)),
                  ),
                  h('span', { style: { color: SUBTLE, fontSize: 11 } },
                    runStatus.next === null
                      ? 'All deliverables present. Next: the production decision.'
                      : `Next: ${runStatus.next?.label ?? '—'} \u2014 ${runStatus.next?.path ?? ''}`),
                  h('span', { style: { color: SUBTLE, fontSize: 11 } }, String(runStatus.note ?? '')),
                )
              : null,
          ),
          h('div', { style: style.footer },
            submitButton,
            recent.length === 0
              ? null
              : h('select', {
                  style: { ...style.secondary, padding: '3px 6px', maxWidth: 190 },
                  value: '',
                  title: 'Fill from a previous submission on this device',
                  'aria-label': 'Fill from a previous submission',
                  onChange: (event) => {
                    const index = Number(event.target.value)
                    if (Number.isInteger(index) && recent[index] !== undefined) {
                      setValues(recent[index].values ?? {})
                    }
                  },
                },
                  h('option', { value: '' }, 'Recent\u2026'),
                  ...recent.map((entry, index) => h('option', { key: `${entry.feature}-${index}`, value: String(index) }, entry.feature)),
                ),
            h('button', {
              type: 'button',
              style: style.secondary,
              disabled: busy,
              onClick: () => {
                setOpen(false)
                setStatus(undefined)
              },
            }, 'Cancel'),
            h('span', {
              style: style.count,
              'data-feature-quality-count': true,
            }, `${filled}/${FIELDS.length} filled`),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(pluginContext) {
        pluginContext.slots.inject(SLOT, () => pluginContext.slots.register({
          name: SLOT,
          id: 'feature-quality',
          order: 4,
        }, QualityPrompt))
      },
    }
  },
})
