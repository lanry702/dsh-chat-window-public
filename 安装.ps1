<#
  chat-window-kit — installer.

  Two things this does, and nothing else:

  1. Finds the DSH profile that has chat-in-dsh installed.
  2. Adds the one line to chat-in-dsh's client.js that tells this plugin to open
     a window when the Chat entry is picked. The line lives inside someone
     else's package, so this is the only way to get it there without a fork.

  Installing the plugin itself is a Plugins > Add plugin step in DSH, not
  something a script can do for you. This prints the path to pick.

  Idempotent: running it twice changes nothing the second time. A backup is
  written next to client.js before the first edit.
#>
param(
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Say([string]$text) { Write-Host $text }

# --- locate the harness home -------------------------------------------------
if ([string]::IsNullOrWhiteSpace($DshHome)) {
  if (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    $DshHome = $env:DSH_HOME
  } elseif (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $DshHome = Join-Path $env:USERPROFILE '.dsh'
  }
}

if (-not (Test-Path -LiteralPath $DshHome)) {
  Say "没有找到 DSH 的数据目录：$DshHome"
  Say '先打开一次 DSH，再跑这个脚本。'
  exit 1
}
Say "DSH 数据目录：$DshHome"

$profilesRoot = Join-Path $DshHome 'profiles'
if (-not (Test-Path -LiteralPath $profilesRoot)) {
  Say "这个 DSH 里还没有任何 profile：$profilesRoot"
  Say '先打开一次 DSH，再跑这个脚本。'
  exit 1
}

# --- find every profile that carries chat-in-dsh ------------------------------
$targets = @()
foreach ($profileDir in (Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
  $file = Join-Path $profileDir.FullName 'node_modules\chat-in-dsh\client.js'
  if (Test-Path -LiteralPath $file) {
    $targets += [pscustomobject]@{ Profile = $profileDir.Name; File = $file }
  }
}

$pluginDir = Join-Path $PSScriptRoot 'plugin'
$chatDir = Join-Path $PSScriptRoot 'chat-in-dsh'

if ($targets.Count -eq 0) {
  Say ''
  Say '你的 DSH 里还没有 chat-in-dsh（聊天界面本身），所以现在没有东西可以打补丁。'
  Say ''
  Say '这种情况不用跑这个脚本 —— 直接装包里这两个文件夹就行。'
  Say '包里那份 chat-in-dsh 的补丁已经打好了，装完就能用。'
  Say ''
  Say '  1. 打开 DSH → Plugins（插件）→「添加插件」'
  Say "     选：$chatDir"
  Say '  2. 再「添加插件」一次'
  Say "     选：$pluginDir"
  Say '  3. 重启 DSH'
  Say ''
  Say '重启后点侧栏的 Chat，窗口就出来了。'
  Say ''
  Say '（如果你打算自己从 Plugins 里搜 chat-in-dsh 装官方那份，那就装完重启之后'
  Say '  再双击一次这个 安装.bat，让它把补丁补到官方那份上。）'
  exit 0
}

Say "找到 chat-in-dsh 的 profile：$(($targets | ForEach-Object { $_.Profile }) -join ', ')"

# --- patch anchors -----------------------------------------------------------
$ANCHOR_LABEL = '    /** 左侧面板：完整的网页版，带它自己的会话列表。 */'
$ANCHOR_PANEL = '    function Panel() {'
$ANCHOR_MOUNT = '        importBus.listeners.add(listener)'
$ANCHOR_APPLY = "      inject: ['slots', 'layout', 'contextMenus'],`n      apply(ctx) {"

$DECLARE = "    // Set by apply(); raises the frame-wide overlay owned by @local/dsh-chat-focus`n" +
           "    // and drops this panel so the harness is not left showing a second sidebar.`n" +
           "    let raiseFocus = () => {}`n`n"

$TRIGGER_DEF = @"
      inject: ['slots', 'layout', 'contextMenus'],
      apply(ctx) {
        raiseFocus = () => {
          window.dispatchEvent(new CustomEvent('chat-in-dsh:selected'))
          try {
            ctx.layout.selectPanel(null)
          } catch {}
        }
"@

$failed = @()

foreach ($target in $targets) {
  $file = $target.File
  Say ''
  Say "→ $($target.Profile)"

  $text = [System.IO.File]::ReadAllText($file, $utf8)
  $before = $text

  if ($text.Contains('raiseFocus')) {
    Say '  已经装过了，跳过。'
    continue
  }

  # 1. declare the hook above the Panel component. The comment above Panel is the
  #    anchor on the version this was built against; on a newer chat-in-dsh the
  #    comment may have been reworded, so `function Panel()` is the fallback.
  if ($text.Contains($ANCHOR_LABEL)) {
    $text = $text.Replace($ANCHOR_LABEL, $DECLARE + $ANCHOR_LABEL)
  } elseif ($text.Contains($ANCHOR_PANEL)) {
    $text = $text.Replace($ANCHOR_PANEL, $DECLARE + $ANCHOR_PANEL)
  } else {
    $failed += "${file}: 找不到 Panel 组件，没法在第 1 处打补丁"
    continue
  }

  # 2. call it when the panel mounts
  if ($text.Contains($ANCHOR_MOUNT)) {
    $text = $text.Replace($ANCHOR_MOUNT, $ANCHOR_MOUNT + "`n        raiseFocus()")
  } else {
    $failed += "${file}: 找不到 importBus.listeners.add(listener)"
    continue
  }

  # 3. give the hook a body
  if ($text.Contains($ANCHOR_APPLY)) {
    $text = $text.Replace($ANCHOR_APPLY, $TRIGGER_DEF)
  } else {
    $failed += "${file}: 找不到 apply(ctx) 的开头"
    continue
  }

  if (-not ($text.Contains('chat-in-dsh:selected') -and $text.Contains('raiseFocus()'))) {
    $failed += "${file}: 拼出来的结果不对，没有写入"
    continue
  }

  $backup = "$file.bak-chat-window-kit"
  if (-not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $file -Destination $backup -Force
    Say "  备份到 $(Split-Path -Leaf $backup)"
  }
  [System.IO.File]::WriteAllText($file, $text, $utf8)
  Say '  已打补丁。'
}

Say ''
if ($failed.Count -gt 0) {
  Say '有几处没打上：'
  foreach ($item in $failed) { Say "  - $item" }
  Say ''
  Say '这说明你装的 chat-in-dsh 版本和这个插件对不上。不用急，'
  Say '先把上面的内容发回去，对着那一版改一下就好。DSH 现在还是能用的，'
  Say '只是点 Chat 还是会在面板里打开，不会弹窗口。'
  exit 3
}

Say '补丁完成。剩下一步，只能在 DSH 界面里做：'
Say ''
Say '  1. 打开 DSH → Plugins（插件）'
Say '  2. 「添加插件」→ 选择这个文件夹：'
Say "     $pluginDir"
Say '  3. 重启 DSH'
Say ''
Say '重启后点侧栏的 Chat，聊天会单独开一个窗口，任务栏上是它自己的图标。'
Say ''
Say '别把这个文件夹删了、也别挪走 —— DSH 装本地插件是直接指向这个目录的。'
