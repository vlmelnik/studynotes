# Study session gestures, all over Windows (low-level mouse hook):
#   Ctrl + drag with the left button  -> a region screenshot (the drag is not
#                                        passed on to the app below)
#   drag to select / double-click     -> StudyNotes presses Ctrl+C for you, so
#                                        the selection is collected (not in
#                                        terminals, where Ctrl+C stops a program)
# Lines on stdout:  ready | snip-start x y | snip-move x y | snip-end x y | copied
# (x, y in physical screen pixels). With STUDY_HOOK_CHECK set it only compiles and exits.
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class StudyHook {
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct MSLL { public POINT pt; public uint mouseData, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public KEYBDINPUT ki; public uint pad1, pad2; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);

  const int WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_MOUSEMOVE = 0x200;
  static HookProc keep;
  static bool snipping;
  static int downX, downY, lastDownTime, lastMove;
  static bool down;

  static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

  static bool Terminal(IntPtr w) {
    var sb = new StringBuilder(256);
    GetClassName(w, sb, 256);
    string c = sb.ToString();
    if (c == "ConsoleWindowClass" || c == "CASCADIA_HOSTING_WINDOW_CLASS" || c.StartsWith("mintty") || c == "PuTTY") return true;
    try {
      uint pid; GetWindowThreadProcessId(w, out pid);
      string n = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
      if (n == "studynotes" || n == "electron" || n == "windowsterminal" || n == "conhost" || n == "powershell" || n == "pwsh" || n == "cmd") return true;
    } catch { }
    return false;
  }

  static void Copy() {
    var w = GetForegroundWindow();
    if (w == IntPtr.Zero || Terminal(w)) return;
    var i = new INPUT[4];
    for (int k = 0; k < 4; k++) i[k].type = 1;
    i[0].ki.vk = 0x11; i[1].ki.vk = 0x43;
    i[2].ki.vk = 0x43; i[2].ki.flags = 2;
    i[3].ki.vk = 0x11; i[3].ki.flags = 2;
    SendInput(4, i, Marshal.SizeOf(typeof(INPUT)));
    Say("copied");
  }

  static IntPtr Proc(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      var m = (MSLL)Marshal.PtrToStructure(lParam, typeof(MSLL));
      bool injected = (m.flags & 1) != 0;
      int msg = wParam.ToInt32();
      if (!injected) {
        bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
        if (msg == WM_LBUTTONDOWN && ctrl) { snipping = true; Say("snip-start " + m.pt.x + " " + m.pt.y); return (IntPtr)1; }
        if (snipping && msg == WM_MOUSEMOVE) { if (Environment.TickCount - lastMove > 15) { lastMove = Environment.TickCount; Say("snip-move " + m.pt.x + " " + m.pt.y); } }
        if (snipping && msg == WM_LBUTTONUP) { snipping = false; Say("snip-end " + m.pt.x + " " + m.pt.y); return (IntPtr)1; }
        if (!snipping && msg == WM_LBUTTONDOWN) {
          bool dbl = Environment.TickCount - lastDownTime < 400 && Math.Abs(m.pt.x - downX) < 6 && Math.Abs(m.pt.y - downY) < 6;
          lastDownTime = Environment.TickCount; downX = m.pt.x; downY = m.pt.y; down = true;
          if (dbl) { var t = new Timer { Interval = 120 }; t.Tick += (s, e) => { t.Stop(); t.Dispose(); Copy(); }; t.Start(); }
        }
        if (!snipping && msg == WM_LBUTTONUP && down) {
          down = false;
          if (Math.Abs(m.pt.x - downX) > 8 || Math.Abs(m.pt.y - downY) > 8) { var t = new Timer { Interval = 80 }; t.Tick += (s, e) => { t.Stop(); t.Dispose(); Copy(); }; t.Start(); }
        }
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }

  public static void Run() {
    SetProcessDPIAware();
    keep = Proc;
    SetWindowsHookEx(14, keep, GetModuleHandle(null), 0);
    Say("ready");
    Application.Run();
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms
if ($env:STUDY_HOOK_CHECK) { [Console]::Out.WriteLine('compiled'); exit 0 }
[StudyHook]::Run()
