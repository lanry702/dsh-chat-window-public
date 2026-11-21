# Give the chat window the icon we drew, once, right after it opens.
#
# Chromium builds an --app window's icon out of a 32 px favicon and upscales it to
# whatever the taskbar draws, which is soft on a scaled display. The icon is
# window-scoped, so it has to be installed on every launch — and it has to land in
# the small slot, because the taskbar reads ICON_SMALL; setting only ICON_BIG
# looks like the browser ignoring the request.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
#     -File icon-apply.ps1 -Icon <path to .ico> [-ProfileMarker <--user-data-dir>]
#
# The plugin cannot pass a pid (its subprocess service hides it), so windows are
# matched through the browser's command line instead.

param(
  [Parameter(Mandatory = $true)][string]$Icon,
  [string]$ProfileMarker = '',
  [string]$LogPath = '',
  [int]$SettleSeconds = 20
)

if ([string]::IsNullOrEmpty($LogPath)) {
  $logDir = $env:TEMP
  if ([string]::IsNullOrEmpty($logDir)) { $logDir = $PSScriptRoot }
  $LogPath = Join-Path $logDir 'chat-focus-apply.log'
}
function Write-Log([string]$message) {
  try { Add-Content -LiteralPath $LogPath -Value ('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $message) -ErrorAction SilentlyContinue } catch {}
}

Write-Log "start marker=$ProfileMarker icon=$Icon lang=$($ExecutionContext.SessionState.LanguageMode)"

try {
  Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ChatIcon {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr inst, string name, uint type, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr p);

  const uint WM_SETICON = 0x0080;
  const int ICON_SMALL = 0, ICON_BIG = 1, ICON_SMALL2 = 2;

  public static IntPtr Big, Small;

  // The chat window is a Chromium app window titled after its page. Hidden
  // windows count: when the host starts the browser, that first window comes up
  // with the startup show state, i.e. hidden.
  public static IntPtr[] Find(List<uint> pids) {
    var found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      var cls = new StringBuilder(128);
      GetClassName(h, cls, cls.Capacity);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      uint owner;
      GetWindowThreadProcessId(h, out owner);
      if (pids != null && pids.Count > 0 && !pids.Contains(owner)) return true;
      var txt = new StringBuilder(512);
      GetWindowText(h, txt, txt.Capacity);
      if (txt.ToString() != "DeepSeek") return true;
      found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  public static bool Reveal(IntPtr hwnd) {
    if (IsWindowVisible(hwnd)) return false;
    ShowWindow(hwnd, 9);   // SW_RESTORE
    SetForegroundWindow(hwnd);
    return true;
  }

  public static bool Install(IntPtr hwnd) {
    if (Big == IntPtr.Zero || Small == IntPtr.Zero) return false;
    SendMessage(hwnd, WM_SETICON, (IntPtr)ICON_BIG, Big);
    SendMessage(hwnd, WM_SETICON, (IntPtr)ICON_SMALL, Small);
    SendMessage(hwnd, WM_SETICON, (IntPtr)ICON_SMALL2, Small);
    return true;
  }
}
"@ -ErrorAction Stop
}
catch {
  Write-Log ('add-type failed: ' + $_.Exception.Message)
  exit 4
}

try {
  [ChatIcon]::SetProcessDPIAware() | Out-Null
  # Both slots come from above the drawn size, so the taskbar only ever downscales
  # — it enlarges the button of the active window.
  [ChatIcon]::Big = [ChatIcon]::LoadImage([IntPtr]::Zero, $Icon, 1, 128, 128, 0x10)
  [ChatIcon]::Small = [ChatIcon]::LoadImage([IntPtr]::Zero, $Icon, 1, 96, 96, 0x10)
  Write-Log ('icons loaded big=' + [ChatIcon]::Big + ' small=' + [ChatIcon]::Small)
  if ([ChatIcon]::Big -eq [IntPtr]::Zero) { exit 3 }
}
catch {
  Write-Log ('load failed: ' + $_.Exception.Message)
  exit 5
}

function Get-BrowserPids {
  if ([string]::IsNullOrEmpty($ProfileMarker)) { return @() }
  $found = @()
  try {
    foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop)) {
      if ($p.CommandLine -like "*$ProfileMarker*") { $found += [uint32]$p.ProcessId }
    }
  } catch {}
  return $found
}

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  $pids = Get-BrowserPids
  $windows = [ChatIcon]::Find([System.Collections.Generic.List[uint32]]$pids)
  if ($windows.Count -gt 0) { break }
  Start-Sleep -Milliseconds 250
}
Write-Log ('windows found: ' + $windows.Count)
if ($windows.Count -eq 0) { exit 1 }

# Chromium reinstalls its own icon once the page settles, so sweep for a while.
$settle = (Get-Date).AddSeconds($SettleSeconds)
$installs = 0
$revealed = $false
while ((Get-Date) -lt $settle) {
  $pids = Get-BrowserPids
  foreach ($h in [ChatIcon]::Find([System.Collections.Generic.List[uint32]]$pids)) {
    if (-not $revealed -and [ChatIcon]::Reveal($h)) {
      $revealed = $true
      Write-Log 'revealed the window'
    }
    if ([ChatIcon]::Install($h)) { $installs++ }
  }
  Start-Sleep -Milliseconds 700
}
Write-Log ('done, installs=' + $installs)
