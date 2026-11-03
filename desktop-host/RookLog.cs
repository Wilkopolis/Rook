using System.Diagnostics;
using System.Text;

namespace CrushExplorer;

/// <summary>
/// Size-capped, rotating plain-text log under %LOCALAPPDATA%\Rook\logs.
/// Crashes and errors are always written (so a crash is never lost even when verbose logging is off);
/// user actions, performance and info entries are only written when <see cref="Enabled"/> is true.
/// </summary>
public static class RookLog
{
    public static readonly string LogDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "logs"
    );

    public static string LogFile => Path.Combine(LogDir, "rook.log");

    private const long MaxFileBytes = 5L * 1024 * 1024;
    private const int MaxArchives = 4;
    private const int MaxMessageChars = 4000;
    private const int MaxDataChars = 16000;

    private static readonly object Gate = new();
    private static readonly string SessionId = Guid.NewGuid().ToString("N")[..8];
    private static bool _headerWritten;

    public static volatile bool Enabled;

    public static bool ShouldWrite(string level) => Enabled || IsAlwaysLevel(level);

    private static bool IsAlwaysLevel(string level) =>
        string.Equals(level, "error", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(level, "fatal", StringComparison.OrdinalIgnoreCase);

    public static void Info(string category, string message, string? data = null) =>
        Write("info", category, message, "host", data);

    public static void Warn(string category, string message, string? data = null) =>
        Write("warn", category, message, "host", data);

    public static void Perf(string category, string message, string? data = null) =>
        Write("perf", category, message, "host", data);

    public static void Error(string category, string message, Exception? ex = null) =>
        Write("error", category, message, "host", ex?.ToString());

    public static void Fatal(string category, string message, Exception? ex = null) =>
        Write("fatal", category, message, "host", ex?.ToString());

    public static void Write(string level, string category, string message, string source = "host", string? data = null, DateTimeOffset? timestamp = null)
    {
        if (!ShouldWrite(level)) return;
        try
        {
            var sb = new StringBuilder(256);
            sb.Append((timestamp ?? DateTimeOffset.Now).ToString("yyyy-MM-ddTHH:mm:ss.fffzzz"));
            sb.Append(' ').Append(level.ToUpperInvariant().PadRight(5));
            sb.Append(" [").Append(source).Append('/').Append(category).Append("] ");
            sb.Append(Truncate(OneLine(message), MaxMessageChars));
            if (!string.IsNullOrEmpty(data))
            {
                var d = Truncate(data, MaxDataChars).Replace("\r\n", "\n");
                foreach (var line in d.Split('\n'))
                {
                    sb.Append(Environment.NewLine).Append("    ").Append(line);
                }
            }
            sb.Append(Environment.NewLine);

            lock (Gate)
            {
                Directory.CreateDirectory(LogDir);
                RotateIfNeeded();
                if (!_headerWritten)
                {
                    _headerWritten = true;
                    File.AppendAllText(LogFile, BuildHeader());
                }
                File.AppendAllText(LogFile, sb.ToString());
            }
        }
        catch
        {
            // Logging must never take the app down.
        }
    }

    private static string BuildHeader()
    {
        string version = typeof(RookLog).Assembly.GetName().Version?.ToString() ?? "?";
        string webView = "?";
        try { webView = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch { }
        return $"{Environment.NewLine}==== Rook session {SessionId} | {DateTimeOffset.Now:yyyy-MM-ddTHH:mm:ss.fffzzz} | " +
               $"v{version} | {Environment.OSVersion.VersionString} | .NET {Environment.Version} | WebView2 {webView} | " +
               $"pid {Environment.ProcessId} | verbose logging {(Enabled ? "on" : "off")} ===={Environment.NewLine}";
    }

    private static void RotateIfNeeded()
    {
        try
        {
            var fi = new FileInfo(LogFile);
            if (!fi.Exists || fi.Length < MaxFileBytes) return;
            var oldest = Path.Combine(LogDir, $"rook.{MaxArchives}.log");
            if (File.Exists(oldest)) File.Delete(oldest);
            for (int i = MaxArchives - 1; i >= 1; i--)
            {
                var src = Path.Combine(LogDir, $"rook.{i}.log");
                if (File.Exists(src)) File.Move(src, Path.Combine(LogDir, $"rook.{i + 1}.log"));
            }
            File.Move(LogFile, Path.Combine(LogDir, "rook.1.log"));
            _headerWritten = false;
        }
        catch { }
    }

    public static void OpenLogFolder()
    {
        Directory.CreateDirectory(LogDir);
        var args = File.Exists(LogFile) ? $"/select,\"{LogFile}\"" : $"\"{LogDir}\"";
        Process.Start(new ProcessStartInfo("explorer.exe", args) { UseShellExecute = true });
    }

    private static string OneLine(string s) => (s ?? "").Replace("\r", " ").Replace("\n", " ");

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s.Substring(0, max) + $"… [truncated {s.Length - max} chars]";
}
