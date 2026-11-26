# Study session gestures, all over Windows (low-level mouse hook):
#   Ctrl + drag with the left button  -> a region screenshot (the drag is not
#                                        passed on to the app below)
#   Alt + click on a window           -> that window (its rectangle on screen)
#   drag to select / double-click     -> StudyNotes presses Ctrl+C for you, so
#                                        the selection is collected (not in
#                                        terminals, where Ctrl+C stops a program)
# Lines on stdout:  ready | snip-start x y | snip-move x y | snip-end x y |
#                   window x y w h | copied | clip   (physical screen pixels;
#                   clip: the clipboard changed)
# Lines on stdin:   on | off  (a paused session keeps the hook, but it does nothing)
# With STUDY_HOOK_CHECK set it only compiles and exits.
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// tells StudyNotes when the clipboard changed (no polling of big pictures)
public class ClipWatch : NativeWindow {
  [DllImport("user32.dll")] static extern bool AddClipboardFormatListener(IntPtr h);
  public ClipWatch() { var cp = new CreateParams(); cp.Parent = new IntPtr(-3); CreateHandle(cp); AddClipboardFormatListener(Handle); }
  protected override void WndProc(ref Message m) { if (m.Msg == 0x031D && StudyHook.active) StudyHook.Say("clip"); base.WndProc(ref m); }
}

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
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  const int WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_MOUSEMOVE = 0x200;
  static HookProc keep;
  static bool snipping;
  static int downX, downY, lastDownTime, lastMove;
  static bool down, altClick;
  public static volatile bool active = true;

  public static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

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

  // Alt alone would open the menu bar of the app when it is let go: a harmless key in between stops that
  static void Key(ushort vk) {
    var i = new INPUT[2]; i[0].type = 1; i[1].type = 1;
    i[0].ki.vk = vk; i[1].ki.vk = vk; i[1].ki.flags = 2;
    SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
  }

  static void Window(POINT p) {
    var w = GetAncestor(WindowFromPoint(p), 2);
    if (w == IntPtr.Zero) return;
    RECT r;
    if (DwmGetWindowAttribute(w, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(w, out r);
    Say("window " + r.l + " " + r.t + " " + (r.r - r.l) + " " + (r.b - r.t));
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
      if (!injected && active) {
        bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
        bool alt = (GetAsyncKeyState(0x12) & 0x8000) != 0;
        if (msg == WM_LBUTTONDOWN && alt && !ctrl) { altClick = true; Key(0xE8); Window(m.pt); return (IntPtr)1; }
        if (altClick && msg == WM_LBUTTONUP) { altClick = false; return (IntPtr)1; }
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
    var clipWatch = new ClipWatch();
    var t = new System.Threading.Thread(() => { string l; while ((l = Console.In.ReadLine()) != null) { if (l == "on") active = true; else if (l == "off") { active = false; snipping = false; down = false; } } Environment.Exit(0); });
    t.IsBackground = true; t.Start();
    Say("ready");
    Application.Run();
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms
if ($env:STUDY_HOOK_CHECK) { [Console]::Out.WriteLine('compiled'); exit 0 }
[StudyHook]::Run()
