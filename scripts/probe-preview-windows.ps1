param([Parameter(Mandatory=$true)][int]$AppProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PreviewProbe {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint flag);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  public static IntPtr[] Windows(uint id) {
    var list=new List<IntPtr>(); EnumWindows((h,d)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==id)list.Add(h);return true;},IntPtr.Zero);return list.ToArray();
  }
}
"@
$results = @()
$index = 0
foreach ($handle in [PreviewProbe]::Windows($AppProcessId)) {
  $title = New-Object Text.StringBuilder 1024
  [void][PreviewProbe]::GetWindowText($handle,$title,1024)
  if (-not $title.ToString().Contains('只读预览')) { continue }
  $before = New-Object PreviewProbe+Rect
  [void][PreviewProbe]::GetWindowRect($handle,[ref]$before)
  # Task-owned windows only. Position at screen edge, independently of editor bounds.
  [void][PreviewProbe]::SetWindowPos($handle,[IntPtr]::Zero,(20+40*$index),(20+40*$index),800,580,0x14)
  $after = New-Object PreviewProbe+Rect
  [void][PreviewProbe]::GetWindowRect($handle,[ref]$after)
  $style = [PreviewProbe]::GetWindowLong($handle,-16)
  $extended = [PreviewProbe]::GetWindowLong($handle,-20)
  $results += [pscustomobject]@{Owner=[PreviewProbe]::GetWindow($handle,4).ToInt64();Topmost=($extended -band 8)-ne 0;Caption=($style -band 0xc00000)-eq 0xc00000;Resizable=($style -band 0x40000)-ne 0;Moved=($before.Left-ne $after.Left -or $before.Top-ne $after.Top);Resized=(($before.Right-$before.Left)-ne ($after.Right-$after.Left));Before=$before;After=$after}
  $index++
}
ConvertTo-Json -InputObject $results -Depth 3
