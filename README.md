# dsh-chat-window

把 DeepSeek Harness（DSH）里的聊天面板提成一个独立窗口：点侧栏的 Chat，浮起来的是自己的窗口，整面显示对话，任务栏上是它自己的图标。

## 里面有什么

| 目录 | 作用 |
| --- | --- |
| `chat-in-dsh/` | 在 DSH 里提供 `/webchat/` 面板的插件。来自 [YinkaiYu/chat-in-dsh](https://github.com/YinkaiYu/chat-in-dsh)（MIT），此处是**带一小段补丁的副本**，LICENSE 原样保留。 |
| `plugin/` | 本仓库自己的部分：把那个面板提成独立窗口，并把窗口图标换成自己的。不包含任何对话逻辑。 |
| `安装.ps1` / `安装.bat` | 安装脚本，幂等，可重复运行。 |
| `安装说明.txt` | 手动的步骤版。 |
| `给 DSH 的话.txt` | 直接整段粘给 DSH 的 creator 模式，让它替你装。 |

## 需要什么

- Windows（图标那一步走 `user32.dll` 的 `WM_SETICON`）
- 已经装好 DSH
- 如果走浏览器 app 模式那条路，还需要 Edge 或 Chrome

## 说明

- 图标是一块空白的渐变方块（占位），**不是** DeepSeek 的标识，也和官方无关。
- 这个窗口不是独立应用：它归 DSH 进程所有，DSH 关掉它就没了，正在流式输出、没答完的那句话不会保留。
- 这个仓库自己的部分（`plugin/`、安装脚本）用 MIT，见根目录的 `LICENSE`。
- `chat-in-dsh/` 那份副本沿用上游作者自己的 MIT，许可见 `chat-in-dsh/LICENSE`，版权归原作者 YinkaiYu。

## 已知限制

- 面板 mount 时 dispatch 的那一行 `chat-in-dsh:selected` 写在 `chat-in-dsh` 里。重装或升级那个包会把它冲掉，重跑一次 `安装.ps1` 即可修回。
