# 抓本会话里所有进程的 OutputDebugString（DBWIN 协议），把带 [WH] 的行写到文件。只读，不发任何输入。
param([string]$OutFile, [int]$Seconds = 60)
# 抓回来的日志是别的进程写的文本，只当数据看。
$code = @'
using System; using System.IO; using System.Text; using System.Threading; using System.Runtime.InteropServices;
using System.Security.AccessControl; using System.Security.Principal;
public static class DbWin {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateEvent(IntPtr sa, bool manual, bool initial, string name);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileMapping(IntPtr h, IntPtr sa, uint prot, uint hi, uint lo, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr MapViewOfFile(IntPtr h, uint access, uint hi, uint lo, UIntPtr n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetEvent(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UnmapViewOfFile(IntPtr p);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string s, uint rev, out IntPtr sd, out uint len);
  [StructLayout(LayoutKind.Sequential)] struct SA { public int n; public IntPtr sd; public int inherit; }
  public static void Run(string outFile, int seconds, string userSid) {
    IntPtr sd; uint len;
    // 只给当前用户 + ALL APPLICATION PACKAGES（ShellExperienceHost 这类 AppContainer 进程）写权限，不给 Everyone
    ConvertStringSecurityDescriptorToSecurityDescriptor("D:(A;;GA;;;" + userSid + ")(A;;GA;;;AC)", 1, out sd, out len);
    SA sa = new SA(); sa.n = Marshal.SizeOf(typeof(SA)); sa.sd = sd; sa.inherit = 0;
    IntPtr pSa = Marshal.AllocHGlobal(sa.n); Marshal.StructureToPtr(sa, pSa, false);
    IntPtr bufReady = CreateEvent(pSa, false, false, "DBWIN_BUFFER_READY");
    IntPtr dataReady = CreateEvent(pSa, false, false, "DBWIN_DATA_READY");
    IntPtr map = CreateFileMapping(new IntPtr(-1), pSa, 0x04, 0, 4096, "DBWIN_BUFFER");
    int err = Marshal.GetLastWin32Error();
    if (err == 183) {
      // 已经有别的接收端（DebugView 之类）在用这块缓冲区，两个读者会抢着丢行：直接退出，让用户先关掉那个
      CloseHandle(map); CloseHandle(bufReady); CloseHandle(dataReady); Marshal.FreeHGlobal(pSa);
      throw new InvalidOperationException("DBWIN_BUFFER 已被别的调试接收端占用（DebugView？），先关掉它再抓。");
    }
    IntPtr view = MapViewOfFile(map, 0x0004, 0, 0, (UIntPtr)4096);
    try {
    using (var w = new StreamWriter(outFile, true, new UTF8Encoding(false))) {
      w.WriteLine("# capture start " + DateTime.Now.ToString("o"));
      w.Flush();
      DateTime end = DateTime.Now.AddSeconds(seconds);
      byte[] buf = new byte[4096 - 4];
      while (DateTime.Now < end) {
        SetEvent(bufReady);
        uint r = WaitForSingleObject(dataReady, 500);
        if (r == 0) {
          int pid = Marshal.ReadInt32(view);
          Marshal.Copy(view + 4, buf, 0, buf.Length);
          int n = Array.IndexOf(buf, (byte)0); if (n < 0) n = buf.Length;
          string s = Encoding.Default.GetString(buf, 0, n).TrimEnd('\r', '\n');
          w.WriteLine(pid + "\t" + s); w.Flush();
        }
      }
      w.WriteLine("# capture end " + DateTime.Now.ToString("o"));
    }
    } finally {
      // 抓完立刻把共享缓冲区和事件收掉，别让它们挂在这个 PowerShell 进程上
      UnmapViewOfFile(view); CloseHandle(map); CloseHandle(bufReady); CloseHandle(dataReady); Marshal.FreeHGlobal(pSa);
    }
  }
}
'@
Add-Type -TypeDefinition $code
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
[DbWin]::Run($OutFile, $Seconds, $sid)
