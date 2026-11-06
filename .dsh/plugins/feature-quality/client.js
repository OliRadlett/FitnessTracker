/**
 * Client half: a "Quality prompt" control above the message composer.
 *
 * Collapsed it is one small button; expanded it is the prompt's Inputs block as a
 * form. Submitting posts the same `/quality …` line the slash command takes to
 * the plugin's host route, so both entry points run one operation and log the
 * same `command/run`.
 *
 * Nothing is stored: the values live in component state while the form is open,
 * are cleared on submit, and the control holds no session data of its own.
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
    const REQUEST_TIMEOUT_MS = 20000

    const FIELDS = [
      { key: 'FEATURE', label: 'FEATURE', hint: 'Ride quality badge on the routes page' },
      {
        key: 'SURFACE', label: 'SURFACE', hint: 'page / flow / API / algorithm / integration',
        options: ['page', 'flow', 'API', 'algorithm', 'integration'],
      },
      { key: 'USER_JOB', label: 'USER JOB', hint: 'what the user is trying to get done' },
      { key: 'CURRENT_STATE', label: 'CURRENT STATE', hint: 'links, screenshots, plans, code' },
      { key: 'REAL_FIXTURE', label: 'REAL FIXTURE', hint: 'one real ride / week / account / dataset' },
      { key: 'REFERENCES', label: 'REFERENCES', hint: '3\u20135 links or frames that show "good"' },
      { key: 'ANTI_REFERENCES', label: 'ANTI-REFERENCES', hint: '1\u20132 links or frames to avoid' },
      { key: 'EXTERNAL_SOURCES', label: 'EXTERNAL SOURCES', hint: 'APIs, map providers, models, data' },
      { key: 'PRODUCTION_LIMITS', label: 'PRODUCTION LIMITS', hint: 'keys, cost, mobile, offline, ToS' },
      { key: 'FIRST_LOOK', label: 'FIRST LOOK', hint: 'date or "5\u201310 working days"', suggestions: ['5 working days', '10 working days'] },
      { key: 'OWNER', label: 'OWNER', hint: 'who is accountable for the artifact' },
    ]

    const TEXT = 'var(--dsw-alias-label-primary, #18181b)'
    const MUTED = 'var(--dsw-alias-label-secondary, #52525b)'
    const BORDER = 'var(--dsw-alias-border-l1, #e4e4e7)'
    const BORDER_STRONG = 'var(--dsw-alias-border-l2, #a1a1aa)'
    const SURFACE = 'var(--dsw-alias-bg-layer-1, #fafafa)'
    const RAISED = 'var(--dsw-alias-bg-layer-2, #f4f4f5)'

    const style = {
      row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '2px 2px 4px' },
      toggle: {
        display: 'inline-flex', alignItems: 'center', gap: 5,
        border: `1px solid ${BORDER}`,
        background: 'transparent',
        color: MUTED,
        borderRadius: 8, padding: '2px 7px 2px 6px',
        font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer',
      },
      toggleOpen: { background: RAISED, color: TEXT },
      panel: {
        border: `1px solid ${BORDER}`,
        background: SURFACE,
        borderRadius: 12, padding: '10px 12px 11px',
        display: 'flex', flexDirection: 'column', gap: 10,
        maxHeight: 'min(48vh, 430px)', overflowY: 'auto',
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 10px' },
      field: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
      label: {
        color: MUTED, fontSize: 10, lineHeight: '14px', letterSpacing: '0.04em',
      },
      input: {
        width: '100%', boxSizing: 'border-box',
        border: `1px solid ${BORDER}`,
        background: RAISED,
        color: TEXT,
        borderRadius: 6, padding: '4px 8px', font: 'inherit', fontSize: 12, lineHeight: '18px',
      },
      footer: { display: 'flex', alignItems: 'center', gap: 8 },
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
      secondary: {
        border: `1px solid ${BORDER}`,
        background: 'transparent', color: TEXT,
        borderRadius: 6, padding: '3px 10px', font: 'inherit', fontSize: 12,
        lineHeight: '18px', cursor: 'pointer',
      },
      note: { color: MUTED, fontSize: 11, marginLeft: 'auto' },
      ok: { color: 'var(--dsw-alias-state-success-primary, #1a7f37)', fontSize: 11, marginLeft: 'auto' },
      error: { color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 11, marginLeft: 'auto' },
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

    /** POST the line to the plugin's host route. */
    async function send(sessionId, line, mode, signal) {
      return fetch(START_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, line, mode }),
        signal,
      })
    }

    function QualityPrompt(props) {
      const [open, setOpen] = useState(false)
      const [values, setValues] = useState({})
      const [status, setStatus] = useState(undefined)
      const [busy, setBusy] = useState(false)
      // The prompt says "first message of a new session"; default to that, and let
      // the user opt into the open one.
      const [freshSession, setFreshSession] = useState(true)
      const firstField = useRef(undefined)

      const sessionId = resolveSessionId(props)
      const filled = FIELDS.filter((field) => collapse(values[field.key]).length > 0).length
      const blank = FIELDS.length - filled

      useEffect(() => {
        if (!open) return
        const node = firstField.current
        if (node !== null && typeof node?.focus === 'function') node.focus()
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [open])

      const setField = (key) => (event) => {
        const next = event.target.value
        setValues((current) => ({ ...current, [key]: next }))
      }

      const submit = async () => {
        if (busy) return
        if (sessionId === undefined) {
          setStatus({ kind: 'error', text: 'Open a session first.' })
          return
        }
        setBusy(true)
        setStatus({ kind: 'pending', text: 'Starting\u2026' })
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const response = await send(sessionId, buildLine(values), freshSession ? 'new' : 'current', controller.signal)
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
          } else if (body.ok === false) {
            setStatus({ kind: 'error', text: body.error ?? 'The prompt was rejected.' })
          } else {
            setStatus({ kind: 'ok', text: body.text ?? 'Quality prompt submitted.' })
            setValues({})
            setOpen(false)
          }
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

      const statusNode = status === undefined
        ? null
        : h('span', {
            role: status.kind === 'error' ? 'alert' : 'status',
            style: status.kind === 'error' ? style.error : status.kind === 'ok' ? style.ok : style.note,
          }, status.text)

      const trigger = h('button', {
        type: 'button',
        'aria-expanded': open,
        'aria-controls': 'feature-quality-panel',
        'data-feature-quality-trigger': true,
        title: 'Open the Generic Feature Quality Prompt',
        style: open ? { ...style.toggle, ...style.toggleOpen } : style.toggle,
        onClick: () => {
          setOpen((value) => !value)
          if (open) setStatus(undefined)
        },
      }, chevron(open), 'Quality prompt')

      if (!open) {
        return h('div', { style: style.row, 'data-feature-quality': 'collapsed' },
          trigger,
          statusNode,
        )
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, 'data-feature-quality': 'open' },
        h('div', { style: style.row }, trigger, statusNode),
        h('div', { style: style.panel, id: 'feature-quality-panel' },
          h('div', { style: style.grid },
            ...FIELDS.map((field, index) => h('label', {
              key: field.key,
              style: field.key === 'FEATURE' ? { ...style.field, gridColumn: '1 / -1' } : style.field,
            },
              h('span', { style: style.label }, field.label),
              field.options === undefined
                ? h('input', {
                    ref: index === 0 ? firstField : undefined,
                    type: 'text',
                    value: values[field.key] ?? '',
                    placeholder: field.hint,
                    spellCheck: false,
                    list: field.suggestions === undefined ? undefined : `fq-${field.key}`,
                    style: style.input,
                    onChange: setField(field.key),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void submit()
                      }
                    },
                  })
                : h('select', {
                    value: values[field.key] ?? '',
                    style: style.input,
                    onChange: setField(field.key),
                  },
                    h('option', { value: '' }, '\u2014'),
                    ...field.options.map((option) => h('option', { key: option, value: option }, option)),
                  ),
              field.suggestions === undefined
                ? null
                : h('datalist', { id: `fq-${field.key}` },
                    ...field.suggestions.map((value) => h('option', { key: value, value }))),
            )),
            h('label', {
              style: {
                ...style.field, gridColumn: '1 / -1', flexDirection: 'row',
                alignItems: 'center', gap: 6, paddingTop: 2,
              },
            },
              h('input', {
                type: 'checkbox',
                checked: freshSession,
                onChange: (event) => setFreshSession(event.target.checked),
                style: { margin: 0, accentColor: 'var(--dsw-alias-brand-primary, #2563eb)' },
              }),
              h('span', { style: { ...style.label, letterSpacing: 0 } },
                'Start in a new session \u2014 the prompt becomes its first message'),
            ),
          ),
          h('div', { style: style.footer },
            h('button', {
              type: 'button',
              style: busy ? style.primaryBusy : style.primary,
              disabled: busy,
              title: blank === 0
                ? 'Submit with every input supplied'
                : `${blank} input${blank === 1 ? ' is' : 's are'} empty \u2014 the prompt's "When to ask" section handles them`,
              'data-feature-quality-submit': true,
              onClick: () => void submit(),
            }, busy ? 'Starting\u2026' : blank === 0 ? 'Start prompt' : 'Start anyway'),
            h('button', {
              type: 'button',
              style: style.secondary,
              disabled: busy,
              onClick: () => {
                setOpen(false)
                setStatus(undefined)
              },
            }, 'Cancel'),
            h('span', { style: style.note }, `${filled}/${FIELDS.length} filled`),
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
