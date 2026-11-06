/**
 * OpenCode Go usage — browser half.
 *
 * A quiet meter under the composer. Collapsed it is a single low-contrast line;
 * hovering, focusing or clicking it opens a detail card with reset countdowns,
 * burn pace and a trend sparkline per window. Data comes from the same-origin
 * Host route, so the API key never reaches this process.
 */
window.__ModuleLoader__.load({
  id: 'opencode-go-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'opencode-go-usage'
    const ROUTE = '/plugins/opencode-go-usage/usage'
    const STORAGE_KEY = 'opencode-go-usage/v1'
    const REFRESH_MS = 120000
    const STALE_AFTER_MS = 45000
    const HISTORY_LIMIT = 96
    const RATE_WINDOW_MS = 20 * 60 * 1000

    const ROWS = [
      { key: 'rolling', name: 'window.rolling', short: 'window.short.rolling' },
      { key: 'weekly', name: 'window.weekly', short: 'window.short.weekly' },
      { key: 'monthly', name: 'window.monthly', short: 'window.short.monthly' },
    ]

    const DICTS = {
      en: {
        'panel.title': 'OpenCode Go',
        'panel.subtitle': '5-hour · weekly · monthly',
        'window.rolling': '5-hour window',
        'window.weekly': 'Weekly window',
        'window.monthly': 'Monthly window',
        'window.short.rolling': '5h',
        'window.short.weekly': 'wk',
        'window.short.monthly': 'mo',
        'reset.in': 'Resets in {time}',
        'reset.expired': 'Reset due',
        'pace.idle': 'No movement in the last {minutes}m',
        'pace.caps': 'At this pace, full in ~{time}',
        'pace.safe': 'On track to stay under the cap',
        'status.updated': 'Updated {ago}',
        'status.refreshing': 'Refreshing…',
        'status.loading': 'Loading…',
        'status.unavailable': 'usage unavailable',
        'action.refresh': 'Refresh',
        'action.open': 'OpenCode Go quota',
        'error.no-key': 'No API key. Add OPENCODE_GO_API_KEY to ~/.dsh/.credentials.yaml.',
        'error.network': 'Could not reach opencode.ai.',
        'error.http': 'OpenCode rejected the request ({detail}).',
        'error.parse': 'Unexpected response from OpenCode.',
        'error.unknown': 'Could not read usage.',
      },
      zh: {
        'panel.title': 'OpenCode Go',
        'panel.subtitle': '5 小时 · 每周 · 每月',
        'window.rolling': '5 小时窗口',
        'window.weekly': '每周窗口',
        'window.monthly': '每月窗口',
        'window.short.rolling': '5时',
        'window.short.weekly': '周',
        'window.short.monthly': '月',
        'reset.in': '{time}后重置',
        'reset.expired': '即将重置',
        'pace.idle': '最近 {minutes} 分钟无变化',
        'pace.caps': '按此速度约 {time} 后用尽',
        'pace.safe': '按此速度不会触顶',
        'status.updated': '{ago}更新',
        'status.refreshing': '刷新中…',
        'status.loading': '加载中…',
        'status.unavailable': '额度不可用',
        'action.refresh': '刷新',
        'action.open': 'OpenCode Go 额度',
        'error.no-key': '未配置 API key：请在 ~/.dsh/.credentials.yaml 添加 OPENCODE_GO_API_KEY。',
        'error.network': '无法连接 opencode.ai。',
        'error.http': 'OpenCode 拒绝了请求（{detail}）。',
        'error.parse': 'OpenCode 返回了无法解析的数据。',
        'error.unknown': '无法读取额度。',
      },
    }

    const CSS = [
      '.ocg-root{display:flex;justify-content:flex-end;align-items:center;padding:0 10px;min-height:22px}',
      '.ocg-pill{display:inline-flex;align-items:center;gap:9px;padding:2px 9px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums;cursor:pointer;opacity:.66;transition:opacity .16s ease,background .16s ease}',
      '.ocg-pill:hover,.ocg-pill:focus-visible{opacity:1;background:var(--dsw-alias-bg-layer-1);outline:none}',
      '.ocg-pill:focus-visible{box-shadow:0 0 0 1px var(--dsw-alias-border-l2)}',
      '.ocg-cell{display:inline-flex;align-items:center;gap:5px}',
      '.ocg-name{letter-spacing:.02em}',
      '.ocg-track{display:inline-block;width:26px;height:3px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}',
      '.ocg-fill{display:block;height:100%;border-radius:999px;transition:width .35s ease,background .35s ease}',
      '.ocg-pct{font-weight:600}',
      '.ocg-sep{width:1px;height:9px;background:var(--dsw-alias-border-l1);flex:none}',
      '.ocg-dot{width:5px;height:5px;border-radius:50%;display:inline-block;flex:none}',
      '.ocg-panel{position:fixed;z-index:60;box-sizing:border-box;padding:12px 14px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 44px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45}',
      '.ocg-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}',
      '.ocg-title{font-weight:600;letter-spacing:.01em}',
      '.ocg-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.ocg-row{padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.ocg-head + .ocg-row{border-top:0;padding-top:2px}',
      '.ocg-rowtop{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:5px}',
      '.ocg-label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ocg-value{font-weight:650;font-variant-numeric:tabular-nums}',
      '.ocg-bar{height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}',
      '.ocg-barfill{height:100%;border-radius:999px;transition:width .35s ease,background .35s ease}',
      '.ocg-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:5px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ocg-pace{margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.9}',
      '.ocg-note{margin-top:8px;padding:6px 8px;border-radius:8px;font-size:10.5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-warn-primary)}',
      '.ocg-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:9px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ocg-action{padding:2px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font-size:11px;cursor:pointer}',
      '.ocg-action:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.ocg-action:focus-visible{outline:1px solid var(--dsw-alias-border-l2);outline-offset:1px}',
      '.ocg-offline{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
      '@media (max-width:560px){.ocg-track{display:none}.ocg-pill{gap:7px}}',
      '@media (prefers-reduced-motion:reduce){.ocg-pill,.ocg-fill,.ocg-barfill{transition:none}}',
    ].join('\n')

    // ---------------------------------------------------------------- helpers

    function translate(t, key, params) {
      let text
      if (typeof t === 'function') text = t(key, params)
      if (text === undefined || text === key) {
        text = DICTS.en[key]
        if (text !== undefined && params) {
          for (const name in params) text = text.split('{' + name + '}').join(String(params[name]))
        }
      }
      return text === undefined ? key : text
    }

    function tone(percent) {
      if (!Number.isFinite(percent)) return 'var(--dsw-alias-state-idle-primary)'
      if (percent >= 90) return 'var(--dsw-alias-state-error-primary)'
      if (percent >= 70) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-idle-primary)'
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0m'
      const minutes = Math.round(ms / 60000)
      if (minutes < 1) return '<1m'
      if (minutes < 60) return minutes + 'm'
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours < 24) return rest === 0 ? hours + 'h' : hours + 'h ' + rest + 'm'
      const days = Math.floor(hours / 24)
      const restHours = hours % 24
      return restHours === 0 ? days + 'd' : days + 'd ' + restHours + 'h'
    }

    function formatClock(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      const now = new Date()
      const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      if (date.toDateString() === now.toDateString()) return time
      const days = (date.getTime() - now.getTime()) / 86400000
      if (days < 6) {
        return date.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + time
      }
      return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    }

    function formatAgo(timestamp) {
      if (!timestamp) return '—'
      const ms = Date.now() - timestamp
      if (ms < 45000) return 'just now'
      return formatDuration(ms) + ' ago'
    }

    function remainingMs(resetsAt) {
      if (!resetsAt) return null
      const value = new Date(resetsAt).getTime()
      return Number.isNaN(value) ? null : value - Date.now()
    }

    function errorText(t, code, detail) {
      switch (code) {
        case 'no-key': return translate(t, 'error.no-key')
        case 'network':
        case 'offline': return translate(t, 'error.network')
        case 'http': return translate(t, 'error.http', { detail: detail || 'HTTP' })
        case 'parse':
        case 'bad-response': return translate(t, 'error.parse')
        default: return translate(t, 'error.unknown')
      }
    }

    function paceFor(history, key) {
      const now = Date.now()
      const recent = history.filter(function (sample) {
        return typeof sample[key] === 'number' && now - sample.t <= RATE_WINDOW_MS
      })
      if (recent.length < 2) return null
      const first = recent[0]
      const last = recent[recent.length - 1]
      const hours = (last.t - first.t) / 3600000
      if (hours <= 0.005) return null
      return { delta: last[key] - first[key], hours: hours }
    }

    function paceText(t, pace, percent, resetsAt) {
      if (pace === null) return null
      if (pace.delta <= 0.2) {
        return translate(t, 'pace.idle', { minutes: Math.max(1, Math.round(pace.hours * 60)) })
      }
      const perHour = pace.delta / pace.hours
      const hoursToFull = (100 - percent) / perHour
      const left = remainingMs(resetsAt)
      if (left !== null && hoursToFull * 3600000 > left) return translate(t, 'pace.safe')
      return translate(t, 'pace.caps', { time: formatDuration(hoursToFull * 3600000) })
    }

    // ------------------------------------------------------------------ store

    function readCache() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || !parsed.data || !parsed.data.windows) return null
        if (!parsed.data.windows.rolling) return null
        return parsed
      } catch (error) {
        return null
      }
    }

    function createStore() {
      const cache = readCache()
      const state = {
        data: cache ? cache.data : null,
        at: cache && typeof cache.at === 'number' ? cache.at : 0,
        history: cache && Array.isArray(cache.history) ? cache.history.slice(-HISTORY_LIMIT) : [],
        error: null,
        errorDetail: null,
        loading: false,
      }
      const listeners = new Set()

      function snapshot() {
        return {
          data: state.data,
          at: state.at,
          history: state.history,
          error: state.error,
          errorDetail: state.errorDetail,
          loading: state.loading,
        }
      }

      function emit() {
        const next = snapshot()
        listeners.forEach(function (listener) {
          try { listener(next) } catch (error) { /* one bad subscriber must not break the meter */ }
        })
      }

      function persist() {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            data: state.data,
            at: state.at,
            history: state.history.slice(-HISTORY_LIMIT),
          }))
        } catch (error) { /* storage can be full or disabled; the meter still works */ }
      }

      function commit(body) {
        const windows = body.windows
        state.data = { windows: windows, fetchedAt: body.fetchedAt || Date.now() }
        state.at = Date.now()
        state.error = body.error || null
        state.errorDetail = body.detail || null

        const sample = {
          t: state.at,
          rolling: windows.rolling.percent,
          weekly: windows.weekly.percent,
          monthly: windows.monthly.percent,
        }
        const last = state.history[state.history.length - 1]
        if (last && Math.abs(last.t - sample.t) <= 20000) state.history[state.history.length - 1] = sample
        else state.history.push(sample)
        if (state.history.length > HISTORY_LIMIT) state.history = state.history.slice(-HISTORY_LIMIT)
        persist()
      }

      async function refresh(force) {
        if (state.loading) return
        state.loading = true
        emit()
        try {
          const response = await fetch(ROUTE + (force === true ? '?force=1' : ''), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const body = await response.json()
          if (body && body.ok && body.windows) commit(body)
          else {
            state.error = (body && body.error) || 'unknown'
            state.errorDetail = body && body.detail ? body.detail : null
          }
        } catch (error) {
          state.error = 'offline'
          state.errorDetail = String((error && error.message) || error)
        } finally {
          state.loading = false
          emit()
        }
      }

      return {
        get: snapshot,
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
        refresh: refresh,
      }
    }

    // -------------------------------------------------------------- components

    function Sparkline(props) {
      const points = props.points
      if (!points || points.length < 3) return null
      const width = 54
      const height = 14
      const pad = 1.5
      let min = Infinity
      let max = -Infinity
      for (const value of points) {
        if (value < min) min = value
        if (value > max) max = value
      }
      const span = max - min < 1 ? 1 : max - min
      const step = (width - pad * 2) / (points.length - 1)
      let path = ''
      for (let index = 0; index < points.length; index += 1) {
        const x = pad + index * step
        const y = height - pad - ((points[index] - min) / span) * (height - pad * 2)
        path += (index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)
        if (index !== points.length - 1) path += ' '
      }
      return h('svg', {
        width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
        'aria-hidden': 'true', focusable: 'false', style: { flex: 'none', opacity: 0.85 },
      }, h('path', {
        d: path, fill: 'none', stroke: props.color, 'stroke-width': 1.25,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }))
    }

    function WindowRow(props) {
      const t = props.t
      const window = props.window
      const percent = window.percent
      const color = tone(percent)
      const left = remainingMs(window.resetsAt)
      const resetLine = left === null
        ? '—'
        : left <= 0
          ? translate(t, 'reset.expired')
          : translate(t, 'reset.in', { time: formatDuration(left) }) + ' · ' + formatClock(window.resetsAt)
      const pace = paceText(t, paceFor(props.history, props.windowKey), percent, window.resetsAt)
      const points = props.history
        .filter(function (sample) { return typeof sample[props.windowKey] === 'number' })
        .slice(-24)
        .map(function (sample) { return sample[props.windowKey] })

      return h('div', { className: 'ocg-row' },
        h('div', { className: 'ocg-rowtop' },
          h('span', { className: 'ocg-label' }, translate(t, props.nameKey)),
          h('span', { className: 'ocg-value', style: { color: percent >= 70 ? color : undefined } }, percent.toFixed(0) + '%'),
        ),
        h('div', { className: 'ocg-bar' },
          h('div', { className: 'ocg-barfill', style: { width: Math.max(1, Math.min(100, percent)) + '%', background: color } }),
        ),
        h('div', { className: 'ocg-meta' },
          h('span', null, resetLine + (window.status !== 'ok' ? ' · ' + window.status : '')),
          h(Sparkline, { points: points, color: color }),
        ),
        pace === null ? null : h('div', { className: 'ocg-pace' }, pace),
      )
    }

    function UsageMeter(props) {
      const store = props.store
      const t = props.t
      const [snap, setSnap] = React.useState(store.get())
      const [hover, setHover] = React.useState(false)
      const [pinned, setPinned] = React.useState(false)
      const [position, setPosition] = React.useState(null)
      const [, tick] = React.useState(0)
      const rootRef = React.useRef(null)

      React.useEffect(function () { return store.subscribe(setSnap) }, [store])

      const open = hover || pinned

      React.useEffect(function () {
        if (!open) return undefined
        const id = window.setInterval(function () { tick(function (value) { return value + 1 }) }, 15000)
        return function () { window.clearInterval(id) }
      }, [open])

      React.useLayoutEffect(function () {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const place = function () {
          const element = rootRef.current
          if (!element) return
          const rect = element.getBoundingClientRect()
          const width = Math.min(318, window.innerWidth - 24)
          const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
          const bottom = Math.max(12, window.innerHeight - rect.top + 10)
          setPosition({ left: left, bottom: bottom, width: width })
        }
        place()
        window.addEventListener('resize', place)
        return function () { window.removeEventListener('resize', place) }
      }, [open])

      React.useEffect(function () {
        if (!open) return undefined
        const onKey = function (event) {
          if (event.key === 'Escape') {
            setPinned(false)
            setHover(false)
          }
        }
        const onDown = function (event) {
          if (!pinned) return
          const element = rootRef.current
          if (element && !element.contains(event.target)) setPinned(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        return function () {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown)
        }
      }, [open, pinned])

      const windows = snap.data ? snap.data.windows : null
      const stale = snap.error !== null
      const cells = []
      const titleParts = []

      if (windows) {
        ROWS.forEach(function (row, index) {
          const window = windows[row.key]
          if (!window) return
          const color = tone(window.percent)
          if (index > 0) cells.push(h('span', { key: row.key + '-sep', className: 'ocg-sep' }))
          cells.push(h('span', { className: 'ocg-cell', key: row.key },
            h('span', { className: 'ocg-name' }, translate(t, row.short)),
            h('span', { className: 'ocg-track' },
              h('span', { className: 'ocg-fill', style: { width: Math.max(0, Math.min(100, window.percent)) + '%', background: color } }),
            ),
            h('span', { className: 'ocg-pct' }, window.percent.toFixed(0) + '%'),
          ))
          const left = remainingMs(window.resetsAt)
          titleParts.push(
            translate(t, row.name) + ': ' + window.percent.toFixed(0) + '%' +
            (left === null ? '' : ' (' + formatDuration(left) + ')'),
          )
        })
      }

      if (stale) {
        cells.unshift(h('span', {
          key: 'dot', className: 'ocg-dot',
          style: { background: 'var(--dsw-alias-state-warn-primary)' },
          'aria-hidden': 'true',
        }))
      }

      if (windows === null) {
        cells.push(h('span', { className: 'ocg-offline', key: 'offline' },
          h('span', {
            className: 'ocg-dot',
            style: { background: snap.error !== null
              ? 'var(--dsw-alias-state-error-primary)'
              : 'var(--dsw-alias-state-idle-primary)' },
            'aria-hidden': 'true',
          }),
          translate(t, snap.loading ? 'status.loading' : 'status.unavailable'),
        ))
      }

      const rows = windows
        ? ROWS.filter(function (row) { return windows[row.key] }).map(function (row) {
          return h(WindowRow, {
            key: row.key,
            t: t,
            window: windows[row.key],
            windowKey: row.key,
            nameKey: row.name,
            history: snap.history,
          })
        })
        : []

      const summary = windows === null
        ? translate(t, 'action.open')
        : translate(t, 'panel.title') + ' — ' + titleParts.join(' · ')

      const panel = open && position !== null
        ? h('div', {
          className: 'ocg-panel',
          role: 'dialog',
          'aria-label': translate(t, 'panel.title'),
          style: { left: position.left + 'px', bottom: position.bottom + 'px', width: position.width + 'px' },
        },
        h('div', { className: 'ocg-head' },
          h('span', { className: 'ocg-title' }, translate(t, 'panel.title')),
          h('span', { className: 'ocg-sub' }, translate(t, 'panel.subtitle')),
        ),
        windows === null
          ? h('div', { className: 'ocg-note' }, snap.error !== null
            ? errorText(t, snap.error, snap.errorDetail)
            : translate(t, 'status.loading'))
          : rows,
        stale && windows !== null
          ? h('div', { className: 'ocg-note' }, errorText(t, snap.error, snap.errorDetail))
          : null,
        h('div', { className: 'ocg-foot' },
          h('span', null, snap.loading
            ? translate(t, 'status.refreshing')
            : snap.at > 0 ? translate(t, 'status.updated', { ago: formatAgo(snap.at) }) : ''),
          h('button', {
            type: 'button',
            className: 'ocg-action',
            onClick: function () { store.refresh(true) },
          }, translate(t, 'action.refresh')),
        ))
        : null

      return h('div', {
        className: 'ocg-root',
        ref: rootRef,
        onMouseEnter: function () { setHover(true) },
        onMouseLeave: function () { setHover(false) },
      },
      h('button', {
        type: 'button',
        className: 'ocg-pill',
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': translate(t, 'action.open'),
        title: stale ? summary + ' — ' + errorText(t, snap.error, snap.errorDetail) : summary,
        onClick: function () {
          if (pinned) {
            setPinned(false)
            setHover(false)
          } else {
            setPinned(true)
          }
        },
        onFocus: function () { setHover(true) },
      }, cells),
      panel)
    }

    // ------------------------------------------------------------------- apply

    function apply(ctx) {
      const store = createStore()
      const locale = ctx.get('locale')

      ctx.effect(function () {
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.textContent = CSS
        document.head.appendChild(tag)
        return function () { tag.remove() }
      }, 'opencode-go-usage: styles')

      if (locale !== undefined) {
        ctx.effect(function () { return locale.register(NS, 'en', DICTS.en) }, 'opencode-go-usage: en locale')
        ctx.effect(function () { return locale.register(NS, 'zh', DICTS.zh) }, 'opencode-go-usage: zh locale')
      }

      store.refresh(false)

      ctx.interval(function () {
        if (!document.hidden) store.refresh(false)
      }, REFRESH_MS)

      ctx.effect(function () {
        const onVisible = function () {
          if (!document.hidden && Date.now() - store.get().at > STALE_AFTER_MS) store.refresh(false)
        }
        document.addEventListener('visibilitychange', onVisible)
        return function () { document.removeEventListener('visibilitychange', onVisible) }
      }, 'opencode-go-usage: visibility refresh')

      const slots = ctx.get('slots')
      if (slots === undefined) return

      slots.inject('conversation.composer.dock', function () {
        return slots.register({
          name: 'conversation.composer.dock',
          id: 'opencode-go-usage',
          order: 20,
          locale: locale !== undefined ? NS : undefined,
        }, function (props) {
          return h(UsageMeter, {
            store: store,
            t: props !== undefined ? props.t : undefined,
          })
        })
      })
    }

    return { inject: ['timer'], apply: apply }
  },
})
