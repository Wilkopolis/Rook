using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CrushExplorer;

public class RookWindow : Form
{
    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    private const int WM_NCLBUTTONDOWN = 0x00A1;
    private const int HT_CAPTION = 0x0002;
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_GETMINMAXINFO = 0x0024;
    private const uint MONITOR_DEFAULTTONEAREST = 0x00000002;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public int dwFlags;
    }

    private readonly WebView2 _webView;
    private readonly string _appUrl;
    private double _savedZoom = 1.0;
    private static readonly string WindowStatePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "window.json"
    );

    public RookWindow(string appUrl)
    {
        _appUrl = appUrl;
        Text = "Rook";
        Width = 1400;
        Height = 860;
        MinimumSize = new Size(900, 560);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(11, 15, 25);

        RestoreWindowBounds();

        try
        {
            var icoPath = Path.Combine(AppContext.BaseDirectory, "app.ico");
            if (File.Exists(icoPath))
            {
                Icon = new Icon(icoPath);
            }
            else
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
        }
        catch { }

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(11, 15, 25)
        };
        Controls.Add(_webView);

        Load += async (_, _) => await InitWebViewAsync();
        FormClosing += (_, _) => SaveWindowBounds();
    }

    private void RestoreWindowBounds()
    {
        try
        {
            if (!File.Exists(WindowStatePath)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(WindowStatePath));
            var root = doc.RootElement;
            int w = root.TryGetProperty("width", out var wp) && wp.TryGetInt32(out int wi) ? wi : 1400;
            int h = root.TryGetProperty("height", out var hp) && hp.TryGetInt32(out int hi) ? hi : 860;
            Width = Math.Max(900, w);
            Height = Math.Max(560, h);

            if (root.TryGetProperty("left", out var lp) && lp.TryGetInt32(out int l) &&
                root.TryGetProperty("top", out var tp) && tp.TryGetInt32(out int t))
            {
                var rect = new Rectangle(l, t, Width, Height);
                bool onScreen = Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect));
                if (onScreen)
                {
                    StartPosition = FormStartPosition.Manual;
                    Left = l;
                    Top = t;
                }
            }

            if (root.TryGetProperty("maximized", out var mp) && mp.ValueKind == JsonValueKind.True)
            {
                WindowState = FormWindowState.Maximized;
            }

            if (root.TryGetProperty("zoom", out var zp) && zp.TryGetDouble(out double z) && z >= 0.25 && z <= 5.0)
            {
                _savedZoom = z;
            }
        }
        catch { }
    }

    private void SaveWindowBounds()
    {
        try
        {
            var dir = Path.GetDirectoryName(WindowStatePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var payload = new
            {
                left = bounds.Left,
                top = bounds.Top,
                width = Math.Max(900, bounds.Width),
                height = Math.Max(560, bounds.Height),
                maximized = WindowState == FormWindowState.Maximized,
                zoom = Math.Round((_webView != null && _webView.ZoomFactor >= 0.25 && _webView.ZoomFactor <= 5.0) ? _webView.ZoomFactor : _savedZoom, 4)
            };
            File.WriteAllText(WindowStatePath, JsonSerializer.Serialize(payload));
        }
        catch { }
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            var userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Rook",
                "WebView2Profile"
            );
            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
            await _webView.EnsureCoreWebView2Async(env);
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;

            _webView.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(_appUrl, StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                }
            };

            _webView.CoreWebView2.WebMessageReceived += (_, args) =>
            {
                try
                {
                    using var doc = JsonDocument.Parse(args.WebMessageAsJson);
                    var root = doc.RootElement;

                    if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "startDrag")
                    {
                        var dragPaths = new List<string>();
                        if (root.TryGetProperty("paths", out var pathsProp) && pathsProp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var el in pathsProp.EnumerateArray())
                            {
                                var p = el.GetString();
                                if (!string.IsNullOrEmpty(p)) dragPaths.Add(p);
                            }
                        }
                        if (dragPaths.Count > 0)
                        {
                            StartFileDrag(dragPaths.ToArray());
                        }
                        return;
                    }

                    var paths = new List<string>();
                    if (args.AdditionalObjects != null)
                    {
                        foreach (var obj in args.AdditionalObjects)
                        {
                            if (obj is CoreWebView2File file && !string.IsNullOrEmpty(file.Path))
                            {
                                paths.Add(file.Path);
                            }
                        }
                    }
                    if (paths.Count == 0) return;

                    string? targetDir = null;
                    bool copy = false;
                    if (root.TryGetProperty("targetDir", out var td) && td.ValueKind == JsonValueKind.String)
                    {
                        targetDir = td.GetString();
                    }
                    if (root.TryGetProperty("copy", out var cp) && cp.ValueKind == JsonValueKind.True)
                    {
                        copy = true;
                    }

                    var payloadJson = JsonSerializer.Serialize(new { paths, targetDir, copy });
                    _ = _webView.CoreWebView2.ExecuteScriptAsync(
                        $"window.dispatchEvent(new CustomEvent('rook-external-drop', {{ detail: {payloadJson} }}));"
                    );
                }
                catch (Exception ex)
                {
                    RookLog.Error("webview/message", "Failed to handle web message", ex);
                }
            };

            _webView.CoreWebView2.ProcessFailed += (_, e) =>
            {
                string frames = "";
                try
                {
                    frames = string.Join(", ", (e.FrameInfosForFailedProcess ?? Enumerable.Empty<CoreWebView2FrameInfo>())
                        .Select(f => $"{f.Name}:{f.Source}"));
                }
                catch { }
                RookLog.Error("webview/process-failed",
                    $"WebView2 process failed: kind={e.ProcessFailedKind} reason={e.Reason} exitCode={e.ExitCode} " +
                    $"process={e.ProcessDescription} frames=[{frames}]");
            };

            _webView.ZoomFactorChanged += (_, _) =>
            {
                _savedZoom = _webView.ZoomFactor;
                RookLog.Info("action", $"WebView zoom factor changed to {_webView.ZoomFactor:0.###}");

                SaveWindowBounds();
                try
                {
                    _ = _webView.CoreWebView2?.ExecuteScriptAsync(
                        $"window.dispatchEvent(new CustomEvent('rook-zoom-change', {{ detail: {{ zoom: {_webView.ZoomFactor.ToString(System.Globalization.CultureInfo.InvariantCulture)} }} }}));"
                    );
                }
                catch { }
            };

            if (_savedZoom >= 0.25 && _savedZoom <= 5.0 && Math.Abs(_savedZoom - 1.0) > 0.001)
            {
                try { _webView.ZoomFactor = _savedZoom; } catch { }
            }

            _webView.NavigationCompleted += (_, _) =>
            {
                if (_savedZoom >= 0.25 && _savedZoom <= 5.0 && Math.Abs(_webView.ZoomFactor - _savedZoom) > 0.001)
                {
                    try { _webView.ZoomFactor = _savedZoom; } catch { }
                }
            };



            _webView.Source = new Uri(_appUrl);
        }
        catch (Exception ex)
        {
            RookLog.Error("webview/init", "WebView2 initialization failed; falling back to the default browser", ex);
            // Fallback if WebView2 runtime encounters an issue
            Process.Start(new ProcessStartInfo { FileName = _appUrl, UseShellExecute = true });
        }
    }

    private void NotifyWebViewMaximizeState()
    {
        try
        {
            if (_webView?.CoreWebView2 != null)
            {
                bool isMax = WindowState == FormWindowState.Maximized;
                _ = _webView.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('rook-window-state', {{ detail: {{ isMaximized: {(isMax ? "true" : "false")} }} }}));"
                );
            }
        }
        catch { }
    }

    public void StartFileDrag(string[] paths)
    {
        BeginInvoke(new Action(() =>
        {
            var valid = paths.Where(p => File.Exists(p) || Directory.Exists(p)).ToArray();
            if (valid.Length == 0) return;

            try
            {
                short left = GetAsyncKeyState(0x01); // VK_LBUTTON
                short right = GetAsyncKeyState(0x02); // VK_RBUTTON
                if ((left & 0x8000) == 0 && (right & 0x8000) == 0)
                {
                    return;
                }

                ReleaseCapture();
                var data = new DataObject(DataFormats.FileDrop, valid);
                data.SetData("application/x-rook-paths", JsonSerializer.Serialize(valid));
                data.SetData(DataFormats.UnicodeText, string.Join(Environment.NewLine, valid));
                data.SetData(DataFormats.Text, string.Join(Environment.NewLine, valid));

                // text/uri-list for browsers (Chrome, Edge, Firefox drop zones and web upload inputs)
                var uriList = string.Join("\r\n", valid.Select(p => new Uri(p).AbsoluteUri));
                data.SetData("text/uri-list", uriList);

                // UniformResourceLocatorW & UniformResourceLocator for browser tab bars / address bars
                if (valid.Length > 0)
                {
                    var firstUri = new Uri(valid[0]).AbsoluteUri;
                    byte[] uriBytes = Encoding.Unicode.GetBytes(firstUri + "\0");
                    data.SetData("UniformResourceLocatorW", new MemoryStream(uriBytes));
                    byte[] asciiBytes = Encoding.ASCII.GetBytes(firstUri + "\0");
                    data.SetData("UniformResourceLocator", new MemoryStream(asciiBytes));

                    data.SetData("FileNameW", valid[0]);
                    data.SetData("FileName", valid[0]);
                }

                // Preferred DropEffect format: allow Copy and Move
                byte[] dropEffect = new byte[] { (byte)(DragDropEffects.Copy | DragDropEffects.Move), 0, 0, 0 };
                var dropEffectStream = new MemoryStream(dropEffect);
                data.SetData("Preferred DropEffect", dropEffectStream);

                var effect = _webView.DoDragDrop(data, DragDropEffects.Copy | DragDropEffects.Move | DragDropEffects.Link);

                try
                {
                    if (_webView?.CoreWebView2 != null)
                    {
                        _ = _webView.CoreWebView2.ExecuteScriptAsync(
                            "window.dispatchEvent(new CustomEvent('rook-drag-completed'));"
                        );
                    }
                }
                catch { }
            }
            catch (Exception ex)
            {
                RookLog.Error("drag", "StartFileDrag failed", ex);
            }
        }));
    }

    public void DragWindow()
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(DragWindow));
            return;
        }

        if (WindowState == FormWindowState.Maximized)
        {
            var startCursor = Cursor.Position;
            bool draggedBeyondThreshold = false;
            while ((Control.MouseButtons & MouseButtons.Left) == MouseButtons.Left)
            {
                var cur = Cursor.Position;
                if (Math.Abs(cur.X - startCursor.X) > 6 || Math.Abs(cur.Y - startCursor.Y) > 6)
                {
                    draggedBeyondThreshold = true;
                    break;
                }
                Application.DoEvents();
                Thread.Sleep(8);
            }

            if (!draggedBeyondThreshold)
            {
                return;
            }

            var currentScreen = Screen.FromPoint(Cursor.Position);
            double xRatio = currentScreen.WorkingArea.Width > 0
                ? Math.Clamp((double)(Cursor.Position.X - currentScreen.WorkingArea.Left) / currentScreen.WorkingArea.Width, 0.1, 0.9)
                : 0.5;

            WindowState = FormWindowState.Normal;
            Left = Cursor.Position.X - (int)(Width * xRatio);
            Top = Math.Max(currentScreen.WorkingArea.Top + 14, Cursor.Position.Y - 16);
            NotifyWebViewMaximizeState();
        }

        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);

        // When drag completes, if docked to the top of a monitor, maximize to fill that screen
        var dropCursor = Cursor.Position;
        var targetScreen = Screen.FromPoint(dropCursor);
        bool dockedToTop =
            dropCursor.Y <= targetScreen.WorkingArea.Top + 12 ||
            dropCursor.Y <= targetScreen.Bounds.Top + 12 ||
            (Top <= targetScreen.WorkingArea.Top + 4 && Top >= targetScreen.Bounds.Top - 24);

        if (WindowState == FormWindowState.Normal && dockedToTop)
        {
            Left = targetScreen.WorkingArea.Left + Math.Max(0, (targetScreen.WorkingArea.Width - Width) / 2);
            Top = targetScreen.WorkingArea.Top + Math.Max(0, (targetScreen.WorkingArea.Height - Height) / 2);
            WindowState = FormWindowState.Maximized;
            NotifyWebViewMaximizeState();
        }
    }

    public void ResizeWindow(string dir)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => ResizeWindow(dir)));
            return;
        }
        if (WindowState == FormWindowState.Maximized) return;

        int ht = dir switch
        {
            "left" => 10,        // HTLEFT
            "right" => 11,       // HTRIGHT
            "top" => 12,         // HTTOP
            "topLeft" => 13,     // HTTOPLEFT
            "topRight" => 14,    // HTTOPRIGHT
            "bottom" => 15,      // HTBOTTOM
            "bottomLeft" => 16,  // HTBOTTOMLEFT
            "bottomRight" => 17, // HTBOTTOMRIGHT
            _ => 17
        };

        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, ht, 0);
    }

    public void MinimizeWindow()
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(MinimizeWindow));
            return;
        }
        WindowState = FormWindowState.Minimized;
    }

    public bool ToggleMaximizeWindow()
    {
        if (InvokeRequired)
        {
            return (bool)Invoke(new Func<bool>(ToggleMaximizeWindow));
        }
        WindowState = WindowState == FormWindowState.Maximized
            ? FormWindowState.Normal
            : FormWindowState.Maximized;
        NotifyWebViewMaximizeState();
        return WindowState == FormWindowState.Maximized;
    }

    public void CloseWindow()
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(CloseWindow));
            return;
        }
        Close();
    }

    public void SetZoom(double zoom)
    {
        if (zoom < 0.25 || zoom > 5.0) return;
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => SetZoom(zoom)));
            return;
        }
        try
        {
            _savedZoom = zoom;
            if (_webView != null) _webView.ZoomFactor = zoom;
            SaveWindowBounds();
        }
        catch { }
    }

    public double GetZoom()
    {
        return _webView?.ZoomFactor ?? _savedZoom;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_GETMINMAXINFO)
        {
            var mmi = Marshal.PtrToStructure<MINMAXINFO>(m.LParam);
            IntPtr monitor = MonitorFromWindow(Handle, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var monitorInfo = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                if (GetMonitorInfo(monitor, ref monitorInfo))
                {
                    var rcWorkArea = monitorInfo.rcWork;
                    var rcMonitorArea = monitorInfo.rcMonitor;
                    mmi.ptMaxPosition.X = Math.Abs(rcWorkArea.Left - rcMonitorArea.Left);
                    mmi.ptMaxPosition.Y = Math.Abs(rcWorkArea.Top - rcMonitorArea.Top);
                    mmi.ptMaxSize.X = Math.Abs(rcWorkArea.Right - rcWorkArea.Left);
                    mmi.ptMaxSize.Y = Math.Abs(rcWorkArea.Bottom - rcWorkArea.Top);
                    mmi.ptMinTrackSize.X = MinimumSize.Width;
                    mmi.ptMinTrackSize.Y = MinimumSize.Height;
                    Marshal.StructureToPtr(mmi, m.LParam, true);
                    m.Result = IntPtr.Zero;
                    return;
                }
            }
        }
        base.WndProc(ref m);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // Enable native taskbar minimize/restore & maximize box on a borderless form
            cp.Style |= 0x00020000 | 0x00010000; // WS_MINIMIZEBOX | WS_MAXIMIZEBOX
            cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
            return cp;
        }
    }
}

public partial class Program
{
    private static RookWindow? MainWindow;

    private static readonly string ThumbCacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "Thumbnails"
    );

    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "settings.json"
    );

    private static readonly string FolderSizeDbPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "folder_sizes.json"
    );

    private static readonly string UiStatePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "ui-state.json"
    );

    public class FolderSizeRecord
    {
        public long SizeBytes { get; set; }
        public int FileCount { get; set; }
        public int DirCount { get; set; }
        public long LastWriteTicks { get; set; }
        public long ScannedAtMs { get; set; }
    }

    private static readonly ConcurrentDictionary<string, FolderSizeRecord> FolderSizeCache =
        new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, byte> PendingFolderScans =
        new(StringComparer.OrdinalIgnoreCase);
    private static readonly BlockingCollection<string> FolderScanQueue = new(new ConcurrentQueue<string>());
    private static int FolderScannerStarted = 0;
    private static int SaveDbScheduled = 0;

    private static string NormalizeFolderKey(string path)
    {
        try
        {
            return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        catch
        {
            return path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
    }

    // ---- Integrated console: one-shot PowerShell command runner ----
    private static Process? ActiveShellProcess;
    private static readonly object ShellLock = new();
    private const string RookCwdMarker = "__ROOK_CWD__=";
    private const string RookExitMarker = "__ROOK_EXIT__=";

    private static void KillActiveShellCommand()
    {
        lock (ShellLock)
        {
            try
            {
                if (ActiveShellProcess != null && !ActiveShellProcess.HasExited)
                {
                    ActiveShellProcess.Kill(entireProcessTree: true);
                }
            }
            catch { }
        }
    }

    private static async Task<object> RunShellCommandAsync(string command, string cwd, CancellationToken requestAborted)
    {
        var escapedCwd = cwd.Replace("'", "''");
        // Wrap the user's command so output is formatted to text before our markers,
        // errors are captured in-order, and the final working directory + exit code are reported.
        var script =
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" +
            "$ProgressPreference = 'SilentlyContinue'\n" +
            $"Set-Location -LiteralPath '{escapedCwd}'\n" +
            "$global:LASTEXITCODE = 0\n" +
            "$__rookErrs = $Error.Count\n" +
            "try {\n" +
            "  & {\n" + command + "\n  } 2>&1 | Out-String -Stream -Width 220\n" +
            "} catch {\n" +
            "  $_ | Out-String -Stream -Width 220\n" +
            "}\n" +
            "$__rookCode = if ($global:LASTEXITCODE) { $global:LASTEXITCODE } elseif ($Error.Count -gt $__rookErrs) { 1 } else { 0 }\n" +
            $"Write-Output \"{RookCwdMarker}$((Get-Location).ProviderPath)\"\n" +
            $"Write-Output \"{RookExitMarker}$__rookCode\"\n";

        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}",
            WorkingDirectory = cwd,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        KillActiveShellCommand();
        using var proc = new Process { StartInfo = psi };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) lock (stdout) stdout.AppendLine(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data); };

        proc.Start();
        lock (ShellLock) { ActiveShellProcess = proc; }
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        // No interactive input: close stdin so prompts fail fast instead of hanging.
        try { proc.StandardInput.Close(); } catch { }

        bool timedOut = false;
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        timeoutCts.CancelAfter(TimeSpan.FromMinutes(5));
        try
        {
            await proc.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            timedOut = !requestAborted.IsCancellationRequested;
            try { proc.Kill(entireProcessTree: true); } catch { }
        }
        try { proc.WaitForExit(2000); } catch { }

        lock (ShellLock)
        {
            if (ReferenceEquals(ActiveShellProcess, proc)) ActiveShellProcess = null;
        }

        string outText;
        lock (stdout) outText = stdout.ToString();
        string errText;
        lock (stderr) errText = stderr.ToString();

        string newCwd = cwd;
        int exitCode = proc.HasExited ? proc.ExitCode : -1;
        bool sawExitMarker = false;
        var keptLines = new List<string>();
        foreach (var rawLine in outText.Replace("\r\n", "\n").Split('\n'))
        {
            if (rawLine.StartsWith(RookCwdMarker))
            {
                var p = rawLine.Substring(RookCwdMarker.Length).Trim();
                if (Directory.Exists(p)) newCwd = p;
                continue;
            }
            if (rawLine.StartsWith(RookExitMarker))
            {
                if (int.TryParse(rawLine.Substring(RookExitMarker.Length).Trim(), out int code))
                {
                    exitCode = code;
                    sawExitMarker = true;
                }
                continue;
            }
            keptLines.Add(rawLine);
        }

        var output = string.Join("\n", keptLines).TrimEnd('\n', ' ');
        bool cancelled = !sawExitMarker && !timedOut;
        if (timedOut)
        {
            output += (output.Length > 0 ? "\n" : "") + "[Command timed out after 5 minutes and was stopped]";
        }

        return new
        {
            output,
            error = errText.TrimEnd(),
            exitCode,
            cwd = newCwd,
            timedOut,
            cancelled,
        };
    }

    private static void LoadFolderSizeDb()
    {
        try
        {
            if (!File.Exists(FolderSizeDbPath)) return;
            var json = File.ReadAllText(FolderSizeDbPath);
            var dict = JsonSerializer.Deserialize<Dictionary<string, FolderSizeRecord>>(json);
            if (dict != null)
            {
                foreach (var kv in dict)
                {
                    FolderSizeCache[NormalizeFolderKey(kv.Key)] = kv.Value;
                }
            }
        }
        catch { }
    }

    private static void ScheduleSaveFolderSizeDb()
    {
        if (Interlocked.Exchange(ref SaveDbScheduled, 1) == 1) return;
        Task.Run(async () =>
        {
            await Task.Delay(2000);
            Interlocked.Exchange(ref SaveDbScheduled, 0);
            try
            {
                var dir = Path.GetDirectoryName(FolderSizeDbPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var snapshot = FolderSizeCache.ToDictionary(k => k.Key, v => v.Value, StringComparer.OrdinalIgnoreCase);
                var json = JsonSerializer.Serialize(snapshot);
                await File.WriteAllTextAsync(FolderSizeDbPath, json);
            }
            catch { }
        });
    }

    private static void InvalidateFolderAndAncestors(string path)
    {
        var curr = NormalizeFolderKey(path);
        while (!string.IsNullOrEmpty(curr))
        {
            FolderSizeCache.TryRemove(curr, out _);
            var parent = Path.GetDirectoryName(curr);
            if (string.IsNullOrEmpty(parent) || string.Equals(parent, curr, StringComparison.OrdinalIgnoreCase))
                break;
            curr = NormalizeFolderKey(parent);
        }
    }

    private static void EnqueueFolderScan(string folderPath)
    {
        StartFolderSizeScanner();
        var key = NormalizeFolderKey(folderPath);
        // Skip drive roots (e.g. "C:") from automatic full-disk scan
        if (key.Length <= 3 && key.EndsWith(":", StringComparison.Ordinal)) return;
        if (PendingFolderScans.TryAdd(key, 1))
        {
            FolderScanQueue.Add(key);
        }
    }

    private static void StartFolderSizeScanner()
    {
        if (Interlocked.Exchange(ref FolderScannerStarted, 1) == 1) return;
        for (int w = 0; w < 2; w++)
        {
            Task.Factory.StartNew(() =>
            {
                foreach (var folderKey in FolderScanQueue.GetConsumingEnumerable())
                {
                    try
                    {
                        ComputeAndCacheFolderSize(folderKey);
                    }
                    catch { }
                    finally
                    {
                        PendingFolderScans.TryRemove(folderKey, out _);
                    }
                }
            }, TaskCreationOptions.LongRunning);
        }
    }

    private static (long sizeBytes, int fileCount, int dirCount) ComputeAndCacheFolderSize(string folderPath, int depth = 0)
    {
        var key = NormalizeFolderKey(folderPath);
        var dirInfo = new DirectoryInfo(folderPath);
        if (!dirInfo.Exists) return (0, 0, 0);

        // If already cached and fresh at deeper recursion levels, reuse it!
        if (depth > 0 && FolderSizeCache.TryGetValue(key, out var existing) &&
            existing.LastWriteTicks == dirInfo.LastWriteTimeUtc.Ticks)
        {
            return (existing.SizeBytes, existing.FileCount, existing.DirCount);
        }

        long totalBytes = 0;
        int files = 0;
        int dirs = 0;

        try
        {
            foreach (var entry in dirInfo.EnumerateFileSystemInfos())
            {
                if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                    continue;

                if ((entry.Attributes & FileAttributes.Directory) != 0)
                {
                    dirs++;
                    if (depth < 2)
                    {
                        var sub = ComputeAndCacheFolderSize(entry.FullName, depth + 1);
                        totalBytes += sub.sizeBytes;
                        files += sub.fileCount;
                        dirs += sub.dirCount;
                    }
                    else
                    {
                        // Fast flat enumeration for deeper levels
                        var enumOpts = new EnumerationOptions
                        {
                            RecurseSubdirectories = true,
                            IgnoreInaccessible = true,
                            AttributesToSkip = FileAttributes.ReparsePoint
                        };
                        var subDir = (DirectoryInfo)entry;
                        foreach (var subEntry in subDir.EnumerateFileSystemInfos("*", enumOpts))
                        {
                            if ((subEntry.Attributes & FileAttributes.Directory) != 0)
                            {
                                dirs++;
                            }
                            else if (subEntry is FileInfo sfi)
                            {
                                files++;
                                try { totalBytes += sfi.Length; } catch { }
                            }
                        }
                    }
                }
                else if (entry is FileInfo fi)
                {
                    files++;
                    try { totalBytes += fi.Length; } catch { }
                }
            }
        }
        catch { }

        FolderSizeCache[key] = new FolderSizeRecord
        {
            SizeBytes = totalBytes,
            FileCount = files,
            DirCount = dirs,
            LastWriteTicks = dirInfo.LastWriteTimeUtc.Ticks,
            ScannedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        if (depth == 0)
        {
            Interlocked.Increment(ref DirChangeSequence);
            ScheduleSaveFolderSizeDb();
        }

        return (totalBytes, files, dirs);
    }

    private static long MaxCacheBytes = 250L * 1024L * 1024L; // Default 250 MB cap
    private static FileSystemWatcher? ActiveWatcher;
    private static readonly object WatcherLock = new();
    private static long DirChangeSequence = 0;

    private static void WatchDirectory(string dirPath)
    {
        lock (WatcherLock)
        {
            try
            {
                if (!Directory.Exists(dirPath)) return;
                if (ActiveWatcher != null && string.Equals(ActiveWatcher.Path, dirPath, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
                ActiveWatcher?.Dispose();
                var watcher = new FileSystemWatcher(dirPath)
                {
                    IncludeSubdirectories = false,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size
                };
                FileSystemEventHandler onChanged = (_, e) =>
                {
                    InvalidateFolderAndAncestors(e.FullPath);
                    Interlocked.Increment(ref DirChangeSequence);
                };
                RenamedEventHandler onRenamed = (_, e) =>
                {
                    InvalidateFolderAndAncestors(e.OldFullPath);
                    InvalidateFolderAndAncestors(e.FullPath);
                    Interlocked.Increment(ref DirChangeSequence);
                };
                watcher.Created += onChanged;
                watcher.Deleted += onChanged;
                watcher.Changed += onChanged;
                watcher.Renamed += onRenamed;
                watcher.EnableRaisingEvents = true;
                ActiveWatcher = watcher;
            }
            catch { }
        }
    }

    private static void LoadSettings()
    {
        LoadFolderSizeDb();
        StartFolderSizeScanner();
        try
        {
            if (File.Exists(SettingsPath))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(SettingsPath));
                if (doc.RootElement.TryGetProperty("maxCacheMb", out var prop) && prop.TryGetInt32(out int mb))
                {
                    int clampedMb = Math.Clamp(mb, 16, 10240);
                    MaxCacheBytes = clampedMb * 1024L * 1024L;
                }
                if (doc.RootElement.TryGetProperty("loggingEnabled", out var logProp))
                {
                    RookLog.Enabled = logProp.ValueKind == JsonValueKind.True;
                }
            }
        }
        catch (Exception ex)
        {
            RookLog.Error("settings", "Failed to load settings.json", ex);
        }
    }

    private static void SaveSettings()
    {
        try
        {
            var dir = Path.GetDirectoryName(SettingsPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            int maxCacheMb = (int)(MaxCacheBytes / (1024L * 1024L));
            File.WriteAllText(SettingsPath, JsonSerializer.Serialize(new { maxCacheMb, loggingEnabled = RookLog.Enabled }));
        }
        catch (Exception ex)
        {
            RookLog.Error("settings", "Failed to save settings.json", ex);
        }
    }

    private static void DeleteItemWithRecycleOption(string targetPath, bool permanent)
    {
        var recycleOpt = permanent
            ? Microsoft.VisualBasic.FileIO.RecycleOption.DeletePermanently
            : Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin;

        if (Directory.Exists(targetPath))
        {
            Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(
                targetPath,
                Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                recycleOpt
            );
        }
        else if (File.Exists(targetPath))
        {
            Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(
                targetPath,
                Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                recycleOpt
            );
        }
    }

    private static readonly SemaphoreSlim ThumbWorkerSemaphore = new(
        Math.Clamp(Environment.ProcessorCount / 2, 2, 6)
    );

    private static readonly ConcurrentDictionary<string, Lazy<Task<bool>>> InFlightThumbs = new();
    private static int CacheWritesSinceLastPurgeCheck = 0;

    private static readonly HashSet<string> ImageExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"
    };

    private static readonly HashSet<string> VideoExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "mp4", "webm", "mov", "mkv", "avi"
    };

    private static readonly HashSet<string> AudioExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "mp3", "wav", "ogg", "flac", "m4a"
    };

    [ComImport]
    [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage([In, MarshalAs(UnmanagedType.Struct)] SIZE size, [In] int flags, out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE
    {
        public int cx;
        public int cy;
        public SIZE(int x, int y) { cx = x; cy = y; }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(
        [In] string pszPath,
        [In] IntPtr pbc,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        out IShellItemImageFactory ppv
    );

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    private static bool TryExtractViaWindowsShell(string filePath, int targetSize, string outPngPath)
    {
        try
        {
            var iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            int hr = SHCreateItemFromParsingName(filePath, IntPtr.Zero, iid, out var factory);
            if (hr == 0 && factory != null)
            {
                int flags = 0x01 | 0x08;
                hr = factory.GetImage(new SIZE(targetSize, targetSize), flags, out IntPtr hBitmap);
                if (hr != 0 || hBitmap == IntPtr.Zero)
                {
                    hr = factory.GetImage(new SIZE(targetSize, targetSize), 0x00, out hBitmap);
                }
                if (hr == 0 && hBitmap != IntPtr.Zero)
                {
                    try
                    {
                        using var bmp = Image.FromHbitmap(hBitmap);
                        var tmpPath = outPngPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
                        bmp.Save(tmpPath, ImageFormat.Png);
                        File.Move(tmpPath, outPngPath, overwrite: true);
                        return true;
                    }
                    finally
                    {
                        DeleteObject(hBitmap);
                    }
                }
            }
        }
        catch { }
        return false;
    }

    // ---- Media metadata via the Windows property system (no external codecs/libraries) ----

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
        public PROPERTYKEY(string fmtid, uint pid) { this.fmtid = new Guid(fmtid); this.pid = pid; }
    }

    // Opaque PROPVARIANT storage (24 bytes on x64, 16 on x86); only handed to propsys helpers.
    [StructLayout(LayoutKind.Sequential)]
    private struct PROPVARIANT
    {
        public ushort vt;
        public ushort r1;
        public ushort r2;
        public ushort r3;
        public IntPtr p1;
        public IntPtr p2;
    }

    [ComImport]
    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint cProps);
        [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        [PreserveSig] int Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHGetPropertyStoreFromParsingName(
        [In] string pszPath,
        [In] IntPtr pbc,
        [In] int flags,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ppv
    );

    [DllImport("propsys.dll", PreserveSig = true)]
    private static extern ulong PropVariantToUInt64WithDefault(ref PROPVARIANT pv, ulong ulDefault);

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int PropVariantClear(ref PROPVARIANT pv);

    private const string PkVideoFmt = "64440491-4C8B-11D1-8B70-080036B11A03";
    private const string PkMediaFmt = "64440490-4C8B-11D1-8B70-080036B11A03";
    private const string PkImageFmt = "6444048F-4C8B-11D1-8B70-080036B11A03";

    private static ulong? ReadPropUInt64(IPropertyStore store, PROPERTYKEY key)
    {
        if (store.GetValue(ref key, out var pv) != 0) return null;
        try
        {
            if (pv.vt == 0) return null; // VT_EMPTY: property not present
            var v = PropVariantToUInt64WithDefault(ref pv, 0UL);
            return v == 0 ? null : v;
        }
        finally { PropVariantClear(ref pv); }
    }

    private sealed record MediaProps(int? Width, int? Height, double? DurationSeconds, long? Bitrate);

    private static MediaProps ReadMediaProps(string path, bool isVideo)
    {
        int? width = null, height = null;
        double? duration = null;
        long? bitrate = null;
        IPropertyStore? store = null;
        try
        {
            var iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
            if (SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0 /* GPS_DEFAULT */, iid, out store) != 0 || store == null)
                return new MediaProps(null, null, null, null);

            if (isVideo)
            {
                width = (int?)ReadPropUInt64(store, new PROPERTYKEY(PkVideoFmt, 3));   // System.Video.FrameWidth
                height = (int?)ReadPropUInt64(store, new PROPERTYKEY(PkVideoFmt, 4));  // System.Video.FrameHeight
                var dur100ns = ReadPropUInt64(store, new PROPERTYKEY(PkMediaFmt, 3));  // System.Media.Duration (100 ns units)
                if (dur100ns.HasValue) duration = dur100ns.Value / 10_000_000.0;
                var br = ReadPropUInt64(store, new PROPERTYKEY(PkVideoFmt, 43))        // System.Video.TotalBitrate
                         ?? ReadPropUInt64(store, new PROPERTYKEY(PkVideoFmt, 8));     // System.Video.EncodingBitrate
                if (br.HasValue) bitrate = (long)br.Value;
            }
            else
            {
                width = (int?)ReadPropUInt64(store, new PROPERTYKEY(PkImageFmt, 3));   // System.Image.HorizontalSize
                height = (int?)ReadPropUInt64(store, new PROPERTYKEY(PkImageFmt, 4));  // System.Image.VerticalSize
            }
        }
        catch { }
        finally
        {
            if (store != null) { try { Marshal.ReleaseComObject(store); } catch { } }
        }
        return new MediaProps(width, height, duration, bitrate);
    }

    private static bool TryGenerateThumbnail(string filePath, int targetSize, string outPngPath)
    {
        var ext = Path.GetExtension(filePath).TrimStart('.').ToLowerInvariant();

        if (ext is "jpg" or "jpeg" or "webp" or "mp4" or "webm" or "mov" or "mkv" or "pdf")
        {
            if (TryExtractViaWindowsShell(filePath, targetSize, outPngPath))
                return true;
        }

        if (ext == "psd")
        {
            // Native decoder first; fall back to a shell thumbnail handler if one is installed.
            if (TryGeneratePsdThumbnail(filePath, targetSize, outPngPath))
                return true;
        }

        if (ext is "png" or "jpg" or "jpeg" or "bmp" or "gif" or "ico")
        {
            try
            {
                using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                using var img = Image.FromStream(fs, useEmbeddedColorManagement: false, validateImageData: false);
                int srcW = Math.Max(1, img.Width);
                int srcH = Math.Max(1, img.Height);
                double scale = Math.Min((double)targetSize / srcW, (double)targetSize / srcH);
                if (scale > 1.0) scale = 1.0;
                int dstW = Math.Max(1, (int)Math.Round(srcW * scale));
                int dstH = Math.Max(1, (int)Math.Round(srcH * scale));

                using var bmp = new Bitmap(dstW, dstH, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.Transparent);
                    g.InterpolationMode = scale < 1.0 ? InterpolationMode.HighQualityBicubic : InterpolationMode.NearestNeighbor;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(img, new Rectangle(0, 0, dstW, dstH));
                }
                var tmpPath = outPngPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
                bmp.Save(tmpPath, ImageFormat.Png);
                File.Move(tmpPath, outPngPath, overwrite: true);
                return true;
            }
            catch { }
        }

        return TryExtractViaWindowsShell(filePath, targetSize, outPngPath);
    }

    private static Task<bool> GetOrGenerateThumbAsync(string fullPath, int size, string cachedPng)
    {
        var lazyTask = InFlightThumbs.GetOrAdd(cachedPng, key => new Lazy<Task<bool>>(async () =>
        {
            await ThumbWorkerSemaphore.WaitAsync();
            try
            {
                if (File.Exists(cachedPng)) return true;
                bool ok = await Task.Run(() => TryGenerateThumbnail(fullPath, size, cachedPng));
                if (ok && Interlocked.Increment(ref CacheWritesSinceLastPurgeCheck) % 25 == 0)
                {
                    _ = Task.Run(EnforceCacheCap);
                }
                return ok;
            }
            finally
            {
                ThumbWorkerSemaphore.Release();
                InFlightThumbs.TryRemove(cachedPng, out var _);
            }
        }));
        return lazyTask.Value;
    }

    private static string ComputeThumbKey(string fullPath, long lastWriteTicks, long sizeBytes, int thumbSize)
    {
        var raw = $"{fullPath.ToLowerInvariant()}|{lastWriteTicks}|{sizeBytes}|{thumbSize}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(hash)[..24].ToLowerInvariant();
    }

    private static (int count, long totalBytes) GetCacheTelemetry()
    {
        if (!Directory.Exists(ThumbCacheDir)) return (0, 0L);
        var dir = new DirectoryInfo(ThumbCacheDir);
        var files = dir.GetFiles("*.png");
        long sum = files.Sum(f => f.Length);
        return (files.Length, sum);
    }

    private static void EnforceCacheCap()
    {
        try
        {
            if (!Directory.Exists(ThumbCacheDir)) return;
            var dir = new DirectoryInfo(ThumbCacheDir);
            var files = dir.GetFiles("*.png");
            long total = files.Sum(f => f.Length);
            if (total <= MaxCacheBytes) return;

            foreach (var fi in files.OrderBy(f => f.LastAccessTimeUtc))
            {
                try
                {
                    long len = fi.Length;
                    fi.Delete();
                    total -= len;
                    if (total <= MaxCacheBytes * 0.8) break;
                }
                catch { }
            }
        }
        catch { }
    }

    private static string FindSublimePath()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\sublime_text.exe")
                         ?? Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\sublime_text.exe");
            var val = key?.GetValue("") as string;
            if (!string.IsNullOrEmpty(val) && File.Exists(val)) return val;
        }
        catch { }

        var progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        var candidates = new[]
        {
            Path.Combine(progFiles, "Sublime Text", "sublime_text.exe"),
            Path.Combine(progFiles, "Sublime Text 3", "sublime_text.exe"),
            Path.Combine(progFiles, "Sublime Text 4", "sublime_text.exe"),
            Path.Combine(progFilesX86, "Sublime Text", "sublime_text.exe"),
            Path.Combine(progFilesX86, "Sublime Text 3", "sublime_text.exe"),
            Path.Combine(localAppData, "Programs", "Sublime Text", "sublime_text.exe"),
            Path.Combine(localAppData, "Programs", "Sublime Text 3", "sublime_text.exe")
        };

        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }

        return "sublime_text.exe";
    }

    private static string FindNotepadPlusPlusPath()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\notepad++.exe")
                         ?? Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\notepad++.exe");
            var val = key?.GetValue("") as string;
            if (!string.IsNullOrEmpty(val) && File.Exists(val)) return val;
        }
        catch { }

        var progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        var candidates = new[]
        {
            Path.Combine(progFiles, "Notepad++", "notepad++.exe"),
            Path.Combine(progFilesX86, "Notepad++", "notepad++.exe"),
            Path.Combine(localAppData, "Programs", "Notepad++", "notepad++.exe")
        };

        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }

        return "notepad++.exe";
    }

    private static void InstallCrashHandlers()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            RookLog.Fatal("crash", $"Unhandled exception (terminating={e.IsTerminating})", e.ExceptionObject as Exception);
        };
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            RookLog.Error("unobserved-task", "Unobserved task exception", e.Exception);
        };
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) =>
        {
            RookLog.Error("ui-thread", "Unhandled UI thread exception", e.Exception);
            // Preserve the default WinForms behavior: let the user continue or quit.
            try
            {
                using var dlg = new ThreadExceptionDialog(e.Exception);
                if (dlg.ShowDialog() == DialogResult.Abort) Application.Exit();
            }
            catch { }
        };
    }

    // Requests that are high-frequency, user-paced (window drag/resize block until mouse-up) or the logger itself.
    private static readonly HashSet<string> UntimedActions = new(StringComparer.OrdinalIgnoreCase)
    {
        "log", "logSettings", "dirVersion", "winDrag", "winResize", "saveUiState", "thumbStats", "folderSizeStats", "setZoom", "getZoom"
    };

    [STAThread]
    public static void Main(string[] args)
    {
        InstallCrashHandlers();
        Directory.CreateDirectory(ThumbCacheDir);
        LoadSettings();
        RookLog.Info("lifecycle", "Host starting");
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        int chosenPort = 0;
        for (int candidate = 45873; candidate <= 45883; candidate++)
        {
            try
            {
                using var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, candidate);
                probe.Start();
                probe.Stop();
                chosenPort = candidate;
                break;
            }
            catch { }
        }

        var builder = WebApplication.CreateBuilder(args);
        builder.WebHost.UseKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, chosenPort);
        });

        var app = builder.Build();

        // API timing + last-chance exception logging for every /api/fs request.
        app.Use(async (ctx, next) =>
        {
            var reqPath = ctx.Request.Path.Value ?? "";
            if (!reqPath.StartsWith("/api/fs/", StringComparison.OrdinalIgnoreCase))
            {
                await next();
                return;
            }
            var action = reqPath.Substring("/api/fs/".Length);
            var sw = Stopwatch.StartNew();
            try
            {
                await next();
            }
            catch (Exception ex)
            {
                RookLog.Error($"api/{action}", $"Unhandled exception in {ctx.Request.Method} {reqPath}", ex);
                throw;
            }
            finally
            {
                sw.Stop();
                if (RookLog.Enabled && !UntimedActions.Contains(action))
                {
                    long ms = sw.ElapsedMilliseconds;
                    bool isThumbOrRaw = action is "thumb" or "raw";
                    // Thumbnails/raw media are requested in bulk; only record the slow ones.
                    if (!isThumbOrRaw || ms >= 250)
                    {
                        RookLog.Write(ms >= 1000 ? "warn" : "perf", "api",
                            $"{action} {ctx.Response.StatusCode} {ms}ms");
                    }
                }
            }
        });
        var asm = Assembly.GetExecutingAssembly();
        var resourceNames = asm.GetManifestResourceNames();

        string GetContentType(string path)
        {
            var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
            return ext switch
            {
                "html" => "text/html; charset=utf-8",
                "js" => "application/javascript; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "jpg" or "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                "ico" => "image/x-icon",
                "mp4" => "video/mp4",
                "webm" => "video/webm",
                "mov" => "video/quicktime",
                "mp3" => "audio/mpeg",
                "wav" => "audio/wav",
                "ogg" => "audio/ogg",
                "json" => "application/json; charset=utf-8",
                _ => "application/octet-stream"
            };
        }

        Stream? GetEmbeddedFile(string relativePath)
        {
            var clean = relativePath.TrimStart('/').Replace('/', '.').Replace('\\', '.').Replace('-', '_');
            var exact = resourceNames.FirstOrDefault(r =>
                r.EndsWith(relativePath.TrimStart('/').Replace('/', '.'), StringComparison.OrdinalIgnoreCase) ||
                r.EndsWith(clean, StringComparison.OrdinalIgnoreCase));
            return exact != null ? asm.GetManifestResourceStream(exact) : null;
        }

        app.MapGet("/api/fs/thumb", async (HttpContext ctx) =>
        {
            var rawPath = ctx.Request.Query["path"].ToString();
            if (SshManager.IsSshPath(rawPath))
            {
                int sshSize = int.TryParse(ctx.Request.Query["size"], out int ss) ? Math.Clamp(ss, 32, 512) : 128;
                await ServeSshMediaSafelyAsync(ctx, () => ServeSshThumbAsync(ctx, rawPath, sshSize, GetContentType));
                return;
            }
            if (string.IsNullOrWhiteSpace(rawPath) || !File.Exists(rawPath))
            {
                ctx.Response.StatusCode = 404;
                return;
            }

            int size = int.TryParse(ctx.Request.Query["size"], out int s) ? Math.Clamp(s, 32, 512) : 128;
            var fi = new FileInfo(rawPath);
            var ext = fi.Extension.TrimStart('.').ToLowerInvariant();

            if (ext == "svg")
            {
                ctx.Response.ContentType = "image/svg+xml";
                ctx.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
                await ctx.Response.SendFileAsync(fi.FullName);
                return;
            }

            var key = ComputeThumbKey(fi.FullName, fi.LastWriteTimeUtc.Ticks, fi.Length, size);
            var cachedPng = Path.Combine(ThumbCacheDir, $"{key}.png");

            if (!File.Exists(cachedPng))
            {
                bool ok = await GetOrGenerateThumbAsync(fi.FullName, size, cachedPng);
                if (!ok || !File.Exists(cachedPng))
                {
                    if (ImageExts.Contains(ext) && fi.Length < 10 * 1024 * 1024)
                    {
                        ctx.Response.ContentType = GetContentType(fi.FullName);
                        await ctx.Response.SendFileAsync(fi.FullName);
                        return;
                    }
                    ctx.Response.StatusCode = 404;
                    return;
                }
            }

            ctx.Response.ContentType = "image/png";
            ctx.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            await ctx.Response.SendFileAsync(cachedPng);
        });

        app.MapGet("/api/fs/raw", async (HttpContext ctx) =>
        {
            var rawPath = ctx.Request.Query["path"].ToString();
            if (SshManager.IsSshPath(rawPath))
            {
                await ServeSshMediaSafelyAsync(ctx, () => ServeSshRawAsync(ctx, rawPath, GetContentType));
                return;
            }
            if (string.IsNullOrWhiteSpace(rawPath) || !File.Exists(rawPath))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            ctx.Response.ContentType = GetContentType(rawPath);
            await ctx.Response.SendFileAsync(rawPath);
        });

        app.MapPost("/api/fs/{action}", async (string action, HttpContext ctx) =>
        {
            try
            {
                using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                var root = doc.RootElement;

                if (!IsFileMutatingAction(action)) return await DispatchFsAction(action, ctx, root);

                // File-mutating actions are recorded in the file action log (see Program.FileActionAudit.cs).
                IResult result;
                try
                {
                    result = await DispatchFsAction(action, ctx, root);
                }
                catch (Exception ex)
                {
                    LogFileAction(action, root, null, ex);
                    throw;
                }
                LogFileAction(action, root, result);
                return result;
            }
            catch (OperationCanceledException)
            {
                // A transfer cancelled from the UI, or the page dropped the request.
                return Results.Json(new { error = "Cancelled" }, statusCode: 499);
            }
            catch (Exception ex)
            {
                RookLog.Error($"api/{action}", $"Action '{action}' failed: {ex.Message}", ex);
                return Results.Json(new { error = ex.Message }, statusCode: 500);
            }
        });

        async Task<IResult> DispatchFsAction(string action, HttpContext ctx, JsonElement root)
        {
            {
                // Copy/move progress jobs; see Program.Transfers.cs.
                if (TryHandleTransferAction(action, root) is { } transferResult)
                {
                    return transferResult;
                }
                if (action == "transferPlan")
                {
                    return await Task.Run(() => HandleTransferPlanAsync(root, ctx.RequestAborted));
                }
                if (action == "remoteCopyCheck")
                {
                    // Can the SSH host fetch these files itself? See Program.RemoteCopy.cs.
                    return await Task.Run(() => HandleRemoteCopyCheckAsync(root, ctx.RequestAborted));
                }

                // Paths on SSH hosts (ssh://{id}/...) are served over SFTP; see Program.Ssh.cs.
                if (await TryHandleSshActionAsync(action, root, ctx.RequestAborted) is { } sshResult)
                {
                    return sshResult;
                }

                // Frameless window controls
                if (action == "winDrag")
                {
                    MainWindow?.DragWindow();
                    return Results.Json(new { ok = true });
                }
                if (action == "winResize")
                {
                    var dir = root.TryGetProperty("dir", out var dProp) && dProp.ValueKind == JsonValueKind.String
                        ? dProp.GetString() ?? "bottomRight"
                        : "bottomRight";
                    MainWindow?.ResizeWindow(dir);
                    return Results.Json(new { ok = true });
                }
                // Native OS drag-out: starts a Win32 DoDragDrop with a FileDrop (CF_HDROP)
                // data object so other apps (Explorer, Discord, browsers...) accept the drop.
                // Must be called while the mouse button is still held (from the page's dragstart).
                if (action == "startDrag")
                {
                    if (!root.TryGetProperty("paths", out var pathsProp) || pathsProp.ValueKind != JsonValueKind.Array)
                    {
                        return Results.Json(new { error = "paths must be an array of strings" }, statusCode: 400);
                    }
                    var dragPaths = pathsProp.EnumerateArray()
                        .Where(p => p.ValueKind == JsonValueKind.String)
                        .Select(p => p.GetString())
                        .Where(p => !string.IsNullOrWhiteSpace(p))
                        .Select(p => Path.GetFullPath(p!))
                        .Where(p => File.Exists(p) || Directory.Exists(p))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToArray();
                    if (dragPaths.Length == 0)
                    {
                        return Results.Json(new { error = "No existing files or folders to drag" }, statusCode: 400);
                    }
                    if (MainWindow == null)
                    {
                        return Results.Json(new { error = "Native drag requires the desktop window" }, statusCode: 409);
                    }
                    MainWindow.StartFileDrag(dragPaths);
                    return Results.Json(new { ok = true, started = true, count = dragPaths.Length });
                }
                if (action == "winMinimize")
                {
                    MainWindow?.MinimizeWindow();
                    return Results.Json(new { ok = true });
                }
                if (action == "winMaximize")
                {
                    bool isMax = MainWindow?.ToggleMaximizeWindow() ?? false;
                    return Results.Json(new { ok = true, isMaximized = isMax });
                }
                if (action == "winClose")
                {
                    MainWindow?.CloseWindow();
                    return Results.Json(new { ok = true });
                }

                if (action == "getZoom")
                {
                    double z = MainWindow?.GetZoom() ?? 1.0;
                    return Results.Json(new { zoom = z });
                }
                if (action == "setZoom")
                {
                    if (root.TryGetProperty("zoom", out var zProp) && zProp.TryGetDouble(out double z))
                    {
                        MainWindow?.SetZoom(z);
                        return Results.Json(new { ok = true, zoom = z });
                    }
                    return Results.BadRequest(new { error = "Invalid zoom" });
                }

                if (action == "info")
                {
                    var cwd = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
                    var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    var readyDrives = DriveInfo.GetDrives().Where(d => d.IsReady).ToList();
                    var drives = readyDrives.Select(d => d.Name).ToList();
                    var driveDetails = readyDrives.Select(d =>
                    {
                        string label = "";
                        long totalBytes = 0;
                        long freeBytes = 0;
                        try { label = d.VolumeLabel; } catch { }
                        try { totalBytes = d.TotalSize; } catch { }
                        try { freeBytes = d.AvailableFreeSpace; } catch { }
                        return new { name = d.Name, label, totalBytes, freeBytes };
                    }).ToList();
                    return Results.Json(new { cwd, home, drives, driveDetails, platform = "win32" });
                }

                if (action == "thumbStats")
                {
                    var (count, totalBytes) = GetCacheTelemetry();
                    int maxCacheMb = (int)(MaxCacheBytes / (1024L * 1024L));
                    return Results.Json(new { count, totalBytes, maxCacheMb, cacheDir = ThumbCacheDir });
                }

                if (action == "setThumbMaxSize")
                {
                    int reqMb = root.TryGetProperty("maxCacheMb", out var mbProp) && mbProp.TryGetInt32(out int m)
                        ? m
                        : 250;
                    int clampedMb = Math.Clamp(reqMb, 16, 10240);
                    MaxCacheBytes = clampedMb * 1024L * 1024L;
                    SaveSettings();
                    EnforceCacheCap();
                    var (count, totalBytes) = GetCacheTelemetry();
                    return Results.Json(new { count, totalBytes, maxCacheMb = clampedMb, cacheDir = ThumbCacheDir });
                }

                if (action == "clearThumbs")
                {
                    if (Directory.Exists(ThumbCacheDir))
                    {
                        foreach (var f in Directory.GetFiles(ThumbCacheDir, "*.png"))
                        {
                            try { File.Delete(f); } catch { }
                        }
                    }
                    int maxCacheMb = (int)(MaxCacheBytes / (1024L * 1024L));
                    return Results.Json(new { ok = true, count = 0, totalBytes = 0, maxCacheMb, cacheDir = ThumbCacheDir });
                }

                if (action == "folderSizeStats")
                {
                    long dbBytes = File.Exists(FolderSizeDbPath) ? new FileInfo(FolderSizeDbPath).Length : 0L;
                    return Results.Json(new
                    {
                        folderCount = FolderSizeCache.Count,
                        dbBytes,
                        pendingScans = PendingFolderScans.Count,
                        dbPath = FolderSizeDbPath
                    });
                }

                if (action == "clearFolderSizes")
                {
                    FolderSizeCache.Clear();
                    try
                    {
                        if (File.Exists(FolderSizeDbPath)) File.Delete(FolderSizeDbPath);
                    }
                    catch { }
                    Interlocked.Increment(ref DirChangeSequence);
                    return Results.Json(new
                    {
                        folderCount = 0,
                        dbBytes = 0L,
                        pendingScans = PendingFolderScans.Count,
                        dbPath = FolderSizeDbPath
                    });
                }

                if (action == "rescanFolderSizes")
                {
                    var reqPath = root.TryGetProperty("path", out var pProp) && pProp.ValueKind == JsonValueKind.String
                        ? pProp.GetString()
                        : null;
                    if (!string.IsNullOrWhiteSpace(reqPath) && Directory.Exists(reqPath))
                    {
                        InvalidateFolderAndAncestors(reqPath);
                        foreach (var subDir in Directory.EnumerateDirectories(reqPath))
                        {
                            FolderSizeCache.TryRemove(NormalizeFolderKey(subDir), out _);
                            EnqueueFolderScan(subDir);
                        }
                    }
                    long dbBytes = File.Exists(FolderSizeDbPath) ? new FileInfo(FolderSizeDbPath).Length : 0L;
                    return Results.Json(new
                    {
                        folderCount = FolderSizeCache.Count,
                        dbBytes,
                        pendingScans = PendingFolderScans.Count,
                        dbPath = FolderSizeDbPath
                    });
                }

                if (action == "list")
                {
                    var reqPath = root.TryGetProperty("path", out var pProp) && pProp.ValueKind == JsonValueKind.String
                        ? pProp.GetString()
                        : null;
                    var targetPath = string.IsNullOrWhiteSpace(reqPath)
                        ? AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)
                        : Path.GetFullPath(reqPath);

                    bool watch = !root.TryGetProperty("watch", out var wProp) || wProp.ValueKind != JsonValueKind.False;
                    if (watch)
                    {
                        WatchDirectory(targetPath);
                    }

                    var dirInfo = new DirectoryInfo(targetPath);
                    var items = new List<object>();

                    foreach (var entry in dirInfo.EnumerateFileSystemInfos().Take(500))
                    {
                        bool isDir = (entry.Attributes & FileAttributes.Directory) == FileAttributes.Directory;
                        long sizeBytes = 0;
                        if (isDir)
                        {
                            var key = NormalizeFolderKey(entry.FullName);
                            if (FolderSizeCache.TryGetValue(key, out var rec))
                            {
                                sizeBytes = rec.SizeBytes;
                                if (rec.LastWriteTicks != entry.LastWriteTimeUtc.Ticks)
                                {
                                    EnqueueFolderScan(entry.FullName);
                                }
                            }
                            else
                            {
                                sizeBytes = -1;
                                EnqueueFolderScan(entry.FullName);
                            }
                        }
                        else if (entry is FileInfo fi)
                        {
                            try { sizeBytes = fi.Length; } catch { }
                        }
                        long modifiedMs = new DateTimeOffset(entry.LastWriteTimeUtc).ToUnixTimeMilliseconds();
                        long createdMs = modifiedMs;
                        try { createdMs = new DateTimeOffset(entry.CreationTimeUtc).ToUnixTimeMilliseconds(); } catch { }
                        string ext = isDir ? "folder" : entry.Extension.TrimStart('.').ToLowerInvariant();

                        items.Add(new
                        {
                            name = entry.Name,
                            path = entry.FullName,
                            isDirectory = isDir,
                            sizeBytes,
                            modifiedMs,
                            createdMs,
                            extension = ext
                        });
                    }

                    string? parentPath = dirInfo.Parent?.FullName;
                    return Results.Json(new
                    {
                        path = targetPath,
                        parentPath,
                        items,
                        version = Interlocked.Read(ref DirChangeSequence)
                    });
                }

                if (action == "dirVersion")
                {
                    return Results.Json(new { version = Interlocked.Read(ref DirChangeSequence) });
                }

                if (action == "search")
                {
                    var reqPath = root.TryGetProperty("path", out var pProp) && pProp.ValueKind == JsonValueKind.String
                        ? pProp.GetString()
                        : null;
                    var query = root.TryGetProperty("query", out var qProp) && qProp.ValueKind == JsonValueKind.String
                        ? qProp.GetString()?.Trim() ?? ""
                        : "";
                    var targetPath = string.IsNullOrWhiteSpace(reqPath)
                        ? AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)
                        : Path.GetFullPath(reqPath);

                    var items = new List<object>();
                    if (!string.IsNullOrEmpty(query) && Directory.Exists(targetPath))
                    {
                        var dirInfo = new DirectoryInfo(targetPath);
                        var enumOpts = new EnumerationOptions
                        {
                            RecurseSubdirectories = true,
                            IgnoreInaccessible = true,
                            MaxRecursionDepth = 6
                        };

                        foreach (var entry in dirInfo.EnumerateFileSystemInfos("*", enumOpts))
                        {
                            if (!entry.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
                                continue;

                            bool isDir = (entry.Attributes & FileAttributes.Directory) == FileAttributes.Directory;
                            long sizeBytes = 0;
                            if (!isDir && entry is FileInfo fi)
                            {
                                try { sizeBytes = fi.Length; } catch { }
                            }
                            long modifiedMs = 0;
                            try { modifiedMs = new DateTimeOffset(entry.LastWriteTimeUtc).ToUnixTimeMilliseconds(); } catch { }
                            long createdMs = modifiedMs;
                            try { createdMs = new DateTimeOffset(entry.CreationTimeUtc).ToUnixTimeMilliseconds(); } catch { }
                            string ext = isDir ? "folder" : entry.Extension.TrimStart('.').ToLowerInvariant();

                            items.Add(new
                            {
                                name = entry.Name,
                                path = entry.FullName,
                                isDirectory = isDir,
                                sizeBytes,
                                modifiedMs,
                                createdMs,
                                extension = ext
                            });

                            if (items.Count >= 200) break;
                        }
                    }

                    return Results.Json(new { path = targetPath, items });
                }

                if (action == "mediaInfo")
                {
                    var reqPath = root.TryGetProperty("path", out var pProp) && pProp.ValueKind == JsonValueKind.String
                        ? pProp.GetString()
                        : null;
                    if (string.IsNullOrWhiteSpace(reqPath))
                        return Results.Json(new { error = "path is required" }, statusCode: 400);

                    var targetPath = Path.GetFullPath(reqPath);
                    if (!File.Exists(targetPath))
                        return Results.Json(new { error = "File not found" }, statusCode: 404);

                    var fi = new FileInfo(targetPath);
                    var ext = fi.Extension.TrimStart('.').ToLowerInvariant();
                    long createdMs = new DateTimeOffset(fi.CreationTimeUtc).ToUnixTimeMilliseconds();
                    long modifiedMs = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeMilliseconds();

                    string kind = ImageExts.Contains(ext) ? "image" : VideoExts.Contains(ext) ? "video" : "other";
                    int? width = null, height = null;
                    double? durationSeconds = null;
                    long? bitrate = null;

                    if (kind == "image")
                    {
                        if (ext is "png" or "jpg" or "jpeg" or "bmp" or "gif" or "ico")
                        {
                            try
                            {
                                using var fs = new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                                using var img = Image.FromStream(fs, false, false);
                                width = img.Width;
                                height = img.Height;
                            }
                            catch { }
                        }
                        if (width == null || height == null)
                        {
                            var props = ReadMediaProps(targetPath, isVideo: false);
                            width = props.Width;
                            height = props.Height;
                        }
                    }
                    else if (kind == "video")
                    {
                        var props = ReadMediaProps(targetPath, isVideo: true);
                        width = props.Width;
                        height = props.Height;
                        durationSeconds = props.DurationSeconds;
                        bitrate = props.Bitrate;
                        if (bitrate == null && durationSeconds is > 0)
                        {
                            bitrate = (long)Math.Round(fi.Length * 8.0 / durationSeconds.Value);
                        }
                    }

                    return Results.Json(new
                    {
                        kind,
                        width,
                        height,
                        durationSeconds,
                        bitrate,
                        sizeBytes = fi.Length,
                        createdMs,
                        modifiedMs
                    });
                }

                if (action == "preview")
                {
                    var targetPath = Path.GetFullPath(root.GetProperty("path").GetString()!);
                    if (Directory.Exists(targetPath))
                    {
                        var children = Directory.EnumerateFileSystemEntries(targetPath)
                            .Take(40)
                            .Select(Path.GetFileName)
                            .ToList();
                        return Results.Json(new { kind = "directory", children });
                    }

                    var fi = new FileInfo(targetPath);
                    var ext = fi.Extension.TrimStart('.').ToLowerInvariant();

                    if (ImageExts.Contains(ext))
                    {
                        int? width = null;
                        int? height = null;
                        if (ext is "png" or "jpg" or "jpeg" or "bmp" or "gif" or "ico")
                        {
                            try
                            {
                                using var fs = new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                                using var img = Image.FromStream(fs, false, false);
                                width = img.Width;
                                height = img.Height;
                            }
                            catch { }
                        }
                        return Results.Json(new
                        {
                            kind = "image",
                            url = $"/api/fs/raw?path={Uri.EscapeDataString(targetPath)}&m={fi.LastWriteTimeUtc.Ticks}",
                            thumbUrl = $"/api/fs/thumb?path={Uri.EscapeDataString(targetPath)}&size=256&m={fi.LastWriteTimeUtc.Ticks}",
                            width,
                            height
                        });
                    }

                    if (VideoExts.Contains(ext))
                    {
                        return Results.Json(new
                        {
                            kind = "video",
                            url = $"/api/fs/raw?path={Uri.EscapeDataString(targetPath)}&m={fi.LastWriteTimeUtc.Ticks}"
                        });
                    }

                    if (AudioExts.Contains(ext))
                    {
                        return Results.Json(new
                        {
                            kind = "audio",
                            url = $"/api/fs/raw?path={Uri.EscapeDataString(targetPath)}&m={fi.LastWriteTimeUtc.Ticks}"
                        });
                    }

                    if (fi.Length > 256 * 1024)
                    {
                        return Results.Json(new
                        {
                            kind = "binary",
                            message = $"Large file ({fi.Length / 1024.0:F1} KB) — preview truncated"
                        });
                    }

                    var bytes = await File.ReadAllBytesAsync(targetPath);
                    bool isBinary = bytes.Take(512).Any(b => b == 0);
                    if (isBinary)
                    {
                        return Results.Json(new { kind = "binary", message = $"Binary file ({fi.Length} bytes)" });
                    }
                    var content = Encoding.UTF8.GetString(bytes);
                    if (content.Length > 8000) content = content[..8000];
                    return Results.Json(new { kind = "text", content });
                }

                if (action == "mkdir")
                {
                    var dir = root.GetProperty("dir").GetString()!;
                    var name = root.GetProperty("name").GetString()!;
                    var targetPath = Path.Combine(dir, name);
                    Directory.CreateDirectory(targetPath);
                    return Results.Json(new { ok = true, path = targetPath });
                }

                if (action == "createFile")
                {
                    var dir = root.GetProperty("dir").GetString()!;
                    var name = root.GetProperty("name").GetString()!;
                    var content = root.TryGetProperty("content", out var cProp) ? cProp.GetString() ?? "" : "";
                    var targetPath = Path.Combine(dir, name);
                    await File.WriteAllTextAsync(targetPath, content);
                    return Results.Json(new { ok = true, path = targetPath });
                }

                if (action == "rename")
                {
                    var oldPath = root.GetProperty("oldPath").GetString()!;
                    var newName = root.GetProperty("newName").GetString()!;
                    var newPath = Path.Combine(Path.GetDirectoryName(oldPath)!, newName);
                    if (Directory.Exists(oldPath)) Directory.Move(oldPath, newPath);
                    else File.Move(oldPath, newPath);
                    return Results.Json(new { ok = true, path = newPath });
                }

                if (action == "delete")
                {
                    var targetPath = root.GetProperty("path").GetString()!;
                    bool permanent = root.TryGetProperty("permanent", out var permProp) &&
                                     permProp.ValueKind == JsonValueKind.True;
                    DeleteItemWithRecycleOption(targetPath, permanent);
                    return Results.Json(new { ok = true });
                }

                if (action == "copy" || action == "move")
                {
                    // Merge-aware copy/move with progress; see Program.Transfers.cs.
                    return await Task.Run(() => HandleCopyMoveAsync(action, root, ctx.RequestAborted));
                }

                if (action == "zipCompress")
                {
                    var pathsList = new List<string>();
                    if (root.TryGetProperty("paths", out var pathsProp) && pathsProp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in pathsProp.EnumerateArray())
                        {
                            var s = el.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) pathsList.Add(Path.GetFullPath(s));
                        }
                    }
                    if (pathsList.Count == 0)
                    {
                        return Results.BadRequest(new { error = "No source paths provided" });
                    }

                    var firstPath = pathsList[0];
                    var parentDir = Path.GetDirectoryName(firstPath) ?? AppContext.BaseDirectory;
                    var baseStem = pathsList.Count == 1
                        ? (Directory.Exists(firstPath) ? Path.GetFileName(firstPath) : Path.GetFileNameWithoutExtension(firstPath))
                        : "Archive";
                    if (string.IsNullOrWhiteSpace(baseStem)) baseStem = "Archive";

                    var zipPath = Path.Combine(parentDir, $"{baseStem}.zip");
                    int counter = 2;
                    while (File.Exists(zipPath) || Directory.Exists(zipPath))
                    {
                        zipPath = Path.Combine(parentDir, $"{baseStem} ({counter}).zip");
                        counter++;
                    }

                    using (var fs = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write))
                    using (var archive = new ZipArchive(fs, ZipArchiveMode.Create))
                    {
                        foreach (var src in pathsList)
                        {
                            if (File.Exists(src))
                            {
                                archive.CreateEntryFromFile(src, Path.GetFileName(src), CompressionLevel.Fastest);
                            }
                            else if (Directory.Exists(src))
                            {
                                var rootFolderName = Path.GetFileName(src.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                                foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
                                {
                                    var relPath = Path.GetRelativePath(src, file).Replace('\\', '/');
                                    archive.CreateEntryFromFile(file, $"{rootFolderName}/{relPath}", CompressionLevel.Fastest);
                                }
                            }
                        }
                    }

                    return Results.Json(new { ok = true, path = zipPath });
                }

                if (action == "zipExtract")
                {
                    var zipPath = Path.GetFullPath(root.GetProperty("path").GetString()!);
                    var parentDir = Path.GetDirectoryName(zipPath) ?? AppContext.BaseDirectory;
                    var stem = Path.GetFileNameWithoutExtension(zipPath);
                    if (string.IsNullOrWhiteSpace(stem)) stem = "Extracted";

                    var destDir = Path.Combine(parentDir, stem);
                    int counter = 2;
                    while (Directory.Exists(destDir) || File.Exists(destDir))
                    {
                        destDir = Path.Combine(parentDir, $"{stem} ({counter})");
                        counter++;
                    }

                    Directory.CreateDirectory(destDir);
                    ZipFile.ExtractToDirectory(zipPath, destDir, true);
                    return Results.Json(new { ok = true, path = destDir });
                }

                if (action == "openFile")
                {
                    var targetPath = Path.GetFullPath(root.GetProperty("path").GetString()!);
                    var workingDir = Directory.Exists(targetPath)
                        ? targetPath
                        : Path.GetDirectoryName(targetPath) ?? AppContext.BaseDirectory;
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = targetPath,
                        WorkingDirectory = workingDir,
                        UseShellExecute = true
                    });
                    return Results.Json(new { ok = true });
                }

                if (action == "revealInExplorer")
                {
                    var targetPath = Path.GetFullPath(root.GetProperty("path").GetString()!);
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = $"/select,\"{targetPath}\"",
                        UseShellExecute = true
                    });
                    return Results.Json(new { ok = true });
                }

                if (action == "openPowershell")
                {
                    var targetDir = root.TryGetProperty("path", out var pProp) && pProp.ValueKind == JsonValueKind.String
                        ? Path.GetFullPath(pProp.GetString()!)
                        : AppContext.BaseDirectory;
                    var escaped = targetDir.Replace("'", "''");
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = $"-NoExit -Command \"Set-Location -LiteralPath '{escaped}'\"",
                        WorkingDirectory = targetDir,
                        UseShellExecute = true
                    });
                    return Results.Json(new { ok = true });
                }

                if (action == "openWith")
                {
                    var app = root.TryGetProperty("app", out var aProp) ? aProp.GetString() : "sublime";
                    var paths = new List<string>();
                    if (root.TryGetProperty("paths", out var pathsArr) && pathsArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in pathsArr.EnumerateArray())
                        {
                            var p = el.GetString();
                            if (!string.IsNullOrEmpty(p)) paths.Add(Path.GetFullPath(p));
                        }
                    }
                    else if (root.TryGetProperty("path", out var pathSingle) && pathSingle.ValueKind == JsonValueKind.String)
                    {
                        var p = pathSingle.GetString();
                        if (!string.IsNullOrEmpty(p)) paths.Add(Path.GetFullPath(p));
                    }

                    if (paths.Count == 0)
                    {
                        return Results.Json(new { ok = false, error = "No path specified" });
                    }

                    string exePath;
                    string arguments;
                    string workingDir = Directory.Exists(paths[0])
                        ? paths[0]
                        : Path.GetDirectoryName(paths[0]) ?? AppContext.BaseDirectory;

                    if (app == "sublime")
                    {
                        exePath = FindSublimePath();
                        arguments = string.Join(" ", paths.Select(p => $"\"{p}\""));
                    }
                    else if (app == "notepad++" || app == "notepadpp")
                    {
                        exePath = FindNotepadPlusPlusPath();
                        if (paths.Count == 1 && Directory.Exists(paths[0]))
                        {
                            arguments = $"-openFoldersAsWorkspace \"{paths[0]}\"";
                        }
                        else
                        {
                            arguments = string.Join(" ", paths.Select(p => $"\"{p}\""));
                        }
                    }
                    else
                    {
                        return Results.Json(new { ok = false, error = $"Unknown editor: {app}" });
                    }

                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            Arguments = arguments,
                            WorkingDirectory = workingDir,
                            UseShellExecute = true
                        });
                        return Results.Json(new { ok = true });
                    }
                    catch (Exception ex)
                    {
                        return Results.Json(new { ok = false, error = ex.Message });
                    }
                }

                // ---- SSH connection management (see SshManager.cs) ----
                if (action == "sshList")
                {
                    return Results.Json(new { connections = SshManager.List().Select(SshManager.ToDto).ToList() });
                }

                if (action == "sshAdd")
                {
                    string? Str(string name) => root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                    try
                    {
                        var conn = SshManager.Add(Str("target") ?? "", Str("label"), Str("keyPath"));
                        RookLog.Info("ssh", $"Added SSH connection {conn.User}@{conn.Host}:{conn.Port}");
                        return Results.Json(new { connection = SshManager.ToDto(conn) });
                    }
                    catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or FileNotFoundException)
                    {
                        return Results.Json(new { error = ex.Message }, statusCode: 400);
                    }
                }

                if (action == "sshRemove" || action == "sshConnect" || action == "sshDisconnect" || action == "sshResetHostKey" || action == "sshDrives")
                {
                    var id = root.TryGetProperty("id", out var idProp) && idProp.ValueKind == JsonValueKind.String ? idProp.GetString() : null;
                    if (string.IsNullOrWhiteSpace(id)) return Results.Json(new { error = "Missing SSH connection id." }, statusCode: 400);

                    if (action == "sshRemove")
                    {
                        return Results.Json(new { ok = SshManager.Remove(id) });
                    }
                    if (action == "sshDisconnect")
                    {
                        SshManager.Disconnect(id);
                        return Results.Json(new { ok = true });
                    }
                    if (action == "sshResetHostKey")
                    {
                        try { SshManager.ResetHostKey(id); }
                        catch (KeyNotFoundException ex) { return Results.Json(new { error = ex.Message }, statusCode: 404); }
                        return Results.Json(new { ok = true });
                    }

                    if (action == "sshDrives")
                    {
                        // Disks mounted on the remote host, so each one can be browsed like a local drive.
                        try
                        {
                            var client = await SshManager.GetClientAsync(id, ctx.RequestAborted);
                            var drives = await Task.Run(() => ListRemoteDrives(client, id), ctx.RequestAborted);
                            return Results.Json(new { drives });
                        }
                        catch (KeyNotFoundException ex)
                        {
                            return Results.Json(new { error = ex.Message }, statusCode: 404);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            RookLog.Warn("ssh", $"SSH drive listing failed for {id}", ex.Message);
                            return Results.Json(new { error = ex.Message }, statusCode: 502);
                        }
                    }

                    // sshConnect: open (or reuse) the SFTP session and report the remote home directory.
                    try
                    {
                        var client = await SshManager.GetClientAsync(id, ctx.RequestAborted);
                        var home = SshManager.NormalizeRemotePath(client.WorkingDirectory ?? "/");
                        var conn = SshManager.Get(id)!;
                        return Results.Json(new
                        {
                            connection = SshManager.ToDto(conn),
                            homePath = SshManager.BuildPath(id, home),
                        });
                    }
                    catch (KeyNotFoundException ex)
                    {
                        return Results.Json(new { error = ex.Message }, statusCode: 404);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        RookLog.Warn("ssh", $"SSH connect failed for {id}", ex.Message);
                        return Results.Json(new { error = ex.Message }, statusCode: 502);
                    }
                }

                if (action == "gitStatus")
                {
                    return Results.Json(new { branch = (string?)null, statuses = new Dictionary<string, string>() });
                }

                if (action == "runCommand")
                {
                    var command = root.TryGetProperty("command", out var cProp) && cProp.ValueKind == JsonValueKind.String
                        ? cProp.GetString() ?? ""
                        : "";
                    var cwd = root.TryGetProperty("cwd", out var cwdProp) && cwdProp.ValueKind == JsonValueKind.String
                        ? cwdProp.GetString() ?? ""
                        : "";
                    if (string.IsNullOrWhiteSpace(cwd) || !Directory.Exists(cwd))
                    {
                        cwd = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    }
                    cwd = Path.GetFullPath(cwd);
                    var result = await RunShellCommandAsync(command, cwd, ctx.RequestAborted);
                    return Results.Json(result);
                }

                if (action == "cancelCommand")
                {
                    KillActiveShellCommand();
                    return Results.Json(new { ok = true });
                }

                if (action == "saveUiState")
                {
                    var dir = Path.GetDirectoryName(UiStatePath);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    if (root.TryGetProperty("storage", out var sProp) && sProp.ValueKind == JsonValueKind.Object)
                    {
                        File.WriteAllText(UiStatePath, sProp.GetRawText());
                    }
                    return Results.Json(new { ok = true });
                }

                if (action == "log")
                {
                    int written = 0;
                    if (root.TryGetProperty("entries", out var entriesProp) && entriesProp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var entry in entriesProp.EnumerateArray().Take(500))
                        {
                            if (entry.ValueKind != JsonValueKind.Object) continue;
                            string Str(string name) =>
                                entry.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() ?? "" : "";
                            var level = Str("level");
                            if (string.IsNullOrEmpty(level)) level = "info";
                            if (!RookLog.ShouldWrite(level)) continue;
                            string? data = null;
                            if (entry.TryGetProperty("data", out var dataProp) && dataProp.ValueKind != JsonValueKind.Null && dataProp.ValueKind != JsonValueKind.Undefined)
                            {
                                data = dataProp.ValueKind == JsonValueKind.String ? dataProp.GetString() : dataProp.GetRawText();
                            }
                            DateTimeOffset? ts = null;
                            if (entry.TryGetProperty("ts", out var tsProp) && tsProp.TryGetInt64(out long tsMs))
                            {
                                ts = DateTimeOffset.FromUnixTimeMilliseconds(tsMs).ToLocalTime();
                            }
                            var category = Str("category");
                            RookLog.Write(level, string.IsNullOrEmpty(category) ? "app" : category, Str("message"), "ui", data, ts);
                            written++;
                        }
                    }
                    return Results.Json(new { ok = true, written });
                }

                if (action == "logSettings")
                {
                    if (root.TryGetProperty("enabled", out var enProp) &&
                        (enProp.ValueKind == JsonValueKind.True || enProp.ValueKind == JsonValueKind.False))
                    {
                        bool next = enProp.ValueKind == JsonValueKind.True;
                        if (next != RookLog.Enabled)
                        {
                            if (!next) RookLog.Info("settings", "Verbose logging disabled by user");
                            RookLog.Enabled = next;
                            if (next) RookLog.Info("settings", "Verbose logging enabled by user");
                            SaveSettings();
                        }
                    }
                    return Results.Json(new { enabled = RookLog.Enabled, logDir = RookLog.LogDir, logFile = RookLog.LogFile });
                }

                if (action == "openFileActionLog")
                {
                    FileActionLog.Open();
                    return Results.Json(new { ok = true, path = FileActionLog.LogFile });
                }

                if (action == "openLogFolder")
                {
                    RookLog.OpenLogFolder();
                    return Results.Json(new { ok = true });
                }

                return Results.NotFound(new { error = "Unknown action" });
            }
        }

        string BuildHydratedIndexHtml(string rawHtml)
        {
            string savedJson = "{}";
            try
            {
                if (File.Exists(UiStatePath))
                {
                    var txt = File.ReadAllText(UiStatePath).Trim();
                    if (txt.StartsWith("{") && txt.EndsWith("}")) savedJson = txt;
                }
            }
            catch { }

            var bootstrapScript = $@"<script>
window.__ROOK_LOGGING_ENABLED__ = {(RookLog.Enabled ? "true" : "false")};
(function() {{
  try {{
    var diskState = {savedJson};
    for (var k in diskState) {{
      if (Object.prototype.hasOwnProperty.call(diskState, k) && typeof diskState[k] === 'string') {{
        localStorage.setItem(k, diskState[k]);
      }}
    }}
    var origSetItem = Storage.prototype.setItem;
    var syncTimer = null;
    function syncToDisk() {{
      try {{
        var dump = {{}};
        for (var i = 0; i < localStorage.length; i++) {{
          var key = localStorage.key(i);
          if (key && key.indexOf('rook_') === 0) {{
            dump[key] = localStorage.getItem(key);
          }}
        }}
        fetch('/api/fs/saveUiState', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ storage: dump }})
        }}).catch(function(){{}});
      }} catch (e) {{}}
    }}
    Storage.prototype.setItem = function(key, val) {{
      origSetItem.call(this, key, val);
      if (typeof key === 'string' && key.indexOf('rook_') === 0) {{
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncToDisk, 80);
      }}
    }};
  }} catch (e) {{}}
}})();
</script>";
            return rawHtml.Contains("</head>")
                ? rawHtml.Replace("</head>", bootstrapScript + "</head>")
                : bootstrapScript + rawHtml;
        }

        app.MapGet("/{**path}", async (string? path, HttpContext ctx) =>
        {
            var reqPath = string.IsNullOrWhiteSpace(path) ? "index.html" : path;
            bool isIndex = string.Equals(reqPath, "index.html", StringComparison.OrdinalIgnoreCase);
            var diskDist = Path.Combine(AppContext.BaseDirectory, "dist", reqPath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(diskDist))
            {
                ctx.Response.ContentType = GetContentType(reqPath);
                if (isIndex)
                {
                    var html = await File.ReadAllTextAsync(diskDist);
                    await ctx.Response.WriteAsync(BuildHydratedIndexHtml(html));
                }
                else
                {
                    await ctx.Response.SendFileAsync(diskDist);
                }
                return;
            }

            using var stream = GetEmbeddedFile(reqPath) ?? GetEmbeddedFile("index.html");
            if (stream != null)
            {
                bool fallbackIndex = isIndex || GetEmbeddedFile(reqPath) == null;
                ctx.Response.ContentType = fallbackIndex ? "text/html; charset=utf-8" : GetContentType(reqPath);
                if (fallbackIndex)
                {
                    using var reader = new StreamReader(stream);
                    var html = await reader.ReadToEndAsync();
                    await ctx.Response.WriteAsync(BuildHydratedIndexHtml(html));
                }
                else
                {
                    await stream.CopyToAsync(ctx.Response.Body);
                }
                return;
            }

            ctx.Response.StatusCode = 404;
        });

        _ = Task.Run(CleanupSshTemp);
        app.StartAsync().GetAwaiter().GetResult();
        var url = app.Urls.First();

        MainWindow = new RookWindow(url);
        RookLog.Info("lifecycle", $"Host listening on {url}");
        Application.Run(MainWindow);

        RookLog.Info("lifecycle", "Host shutting down");
        SshManager.DisconnectAll();
        app.StopAsync().GetAwaiter().GetResult();
    }
}
