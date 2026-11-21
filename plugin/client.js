/**
 * Chat Focus — Client half.
 *
 * One job: turn the Chat entry in the sidebar into a whole surface. The chat
 * itself is chat-in-dsh's /webchat iframe; this plugin raises it into the
 * frame-wide overlay layer, above every column and outside their scroll
 * containers, so nothing of the harness is visible while it is open.
 *
 * The iframe stays mounted and only its wrapper is hidden, so an answer that is
 * streaming when you drop back into the harness is still there when you return.
 *
 * Trigger: chat-in-dsh's Panel dispatches `chat-in-dsh:selected` when the entry
 * is picked (that one line lives in the installed package and is re-applied by
 * patch-chat-in-dsh-name.ps1 after an upgrade).
 */
window.__ModuleLoader__.load({
  // The loader key must equal the package name, or the shell never claims this
  // factory and the slot registration silently never happens.
  id: '@local/dsh-chat-focus',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const EVENT = 'chat-in-dsh:selected'
    const CLOSE_HINT = 'Close (Esc)'

    function Focus() {
      const [open, setOpen] = React.useState(false)
      const [why, setWhy] = React.useState('')
      const frameRef = React.useRef(null)

      React.useEffect(() => {
        const show = async () => {
          // Preferred: a window of its own, opened by the host half.
          try {
            const response = await fetch('/chat-focus/open', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-chat-focus': '1' },
              body: JSON.stringify({ origin: window.location.origin }),
            })
            if (response.ok) {
              setWhy('')
              return
            }
            let detail = ''
            try {
              const payload = await response.json()
              if (payload?.error) detail = ` ${payload.error}`
            } catch {}
            setWhy(`新窗口失败：HTTP ${response.status}${detail}`)
          } catch (error) {
            setWhy(`新窗口失败：${String(error?.message ?? error)}`)
          }
          // Fallback: the in-frame overlay, below the shell's menu bar so its
          // chrome does not collide with the chat header.
          setOpen(true)
        }
        window.addEventListener(EVENT, show)
        return () => window.removeEventListener(EVENT, show)
      }, [])

      // The chat owns focus once it is up, so a listener on the shell window
      // never sees the key. Same origin means the iframe's document can carry
      // its own Escape handler; both paths are wired.
      const attachInner = () => {
        try {
          const inner = frameRef.current?.contentWindow
          if (!inner) return
          inner.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setOpen(false)
          }, true)
        } catch {}
      }

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        window.addEventListener('keydown', onKey, true)
        attachInner()
        return () => window.removeEventListener('keydown', onKey, true)
      }, [open])

      return h('div', {
        style: {
          position: 'fixed',
          // Starts under the shell's own menu strip: that chrome is painted above
          // this layer, and a full-bleed overlay made the sidebar icon and the
          // chat's header icon sit on top of each other.
          top: 34,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2147483000,
          background: '#ffffff',
          // The overlay layer is click-through by default and every entry has to
          // opt back in, or the chat renders and the clicks land on the shell.
          pointerEvents: 'auto',
          display: open ? 'block' : 'none',
        },
      },
        h('iframe', {
          ref: frameRef,
          src: '/webchat/',
          title: 'DeepSeek Chat',
          allow: 'clipboard-write',
          onLoad: attachInner,
          style: {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            background: '#ffffff',
          },
        }),
        // Bottom-right, clear of the Windows caption buttons that swallowed the
        // previous top-right control.
        h('button', {
          type: 'button',
          'aria-label': CLOSE_HINT,
          title: CLOSE_HINT,
          onClick: () => setOpen(false),
          style: {
            position: 'absolute',
            bottom: 18,
            right: 20,
            height: 30,
            padding: '0 14px',
            borderRadius: 15,
            border: '1px solid rgba(0,0,0,0.14)',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
            color: '#3a3a3a',
            fontSize: 13,
            lineHeight: '28px',
            cursor: 'pointer',
          },
        }, '退出 Chat · Esc'),
        why === '' ? null : h('div', {
          style: {
            position: 'absolute',
            left: 20,
            bottom: 22,
            padding: '4px 10px',
            borderRadius: 12,
            background: 'rgba(255,244,229,0.96)',
            border: '1px solid rgba(0,0,0,0.10)',
            color: '#8a5a00',
            fontSize: 12,
            pointerEvents: 'none',
          },
        }, why))
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'chat-focus',
          label: 'Chat',
        }, Focus)), 'chat-focus.overlay')
      },
    }
  },
})
