# Chat window

Chat already lives in a panel inside the harness. This plugin takes the same
conversation and puts it in a window of its own, so the chat fills the whole
surface and the taskbar button carries the chat's icon rather than the
harness's.

## What it does

Picking **Chat** in the sidebar no longer swaps the middle column. It raises a
separate window that loads the same `/webchat/` panel edge to edge, and the
sidebar panel is dropped so the harness is not left showing two sidebars at
once. Closing the window, Escape, or the harness itself ends it.

Two routes to that window, tried in order:

1. A window the host creates through the Electron API, when the desktop shell
   exposes it. The icon is handed over at creation.
2. A browser in app mode (`--app=`), which draws one page with no tab strip and
   no address bar. Chromium builds that window's icon from a 32 px favicon and
   upscales it, which looks soft on a scaled display, so `icon-apply.ps1`
   replaces it on every launch through `WM_SETICON`.

Either way the window loads a wrapper page rather than `/webchat/` directly:
the wrapper carries the icon links and the window title, and it sizes the frame
to fill the window.

## What it needs

`chat-in-dsh` must be installed, because it is what serves `/webchat/` in the
first place. This plugin contributes no chat of its own.

It also needs one line in `chat-in-dsh`'s `client.js`, which the installer adds:
the panel dispatches `chat-in-dsh:selected` when it mounts, which is what tells
this plugin to open the window. That line lives in someone else's package, so an
upgrade or reinstall of `chat-in-dsh` removes it. Re-run the installer if the
sidebar Chat goes back to opening a panel instead of a window; it is idempotent.

## Limits

- Windows only. The icon step calls `user32.dll` and the browser discovery looks
  at `Program Files` paths.
- The app-mode route needs Edge or Chrome. Without one of them, and without an
  Electron API, the window cannot open.
- The window is not a separate application: it is owned by the running harness,
  so closing the harness closes the chat. An answer still streaming when the
  window closes is not kept anywhere.
