using System.Text;

namespace CrushExplorer;

/// <summary>
/// Append-only log of file actions (move, delete, rename, copy, paste, create, ...) at
/// %LOCALAPPDATA%\Rook\file-actions.log. One line per action:
/// <c>2026-11-12T07:32:47.123-08:00 move | C:\a\b.txt -> D:\c\b.txt</c>
/// Logging never throws. Rolling: the file never exceeds 1 MB; the oldest whole lines are dropped.
/// </summary>
public static class FileActionLog
{
    public static readonly string LogDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook"
    );

    public static string LogFile => Path.Combine(LogDir, "file-actions.log");

    /// <summary>Hard cap on the log file size.</summary>
    private const long MaxBytes = 1024 * 1024;
    /// <summary>Size kept after a trim (~128 KB of headroom before the next one).</summary>
    private const long TrimToBytes = 896 * 1024;

    private static readonly object Gate = new();

    /// <summary>Record one file action. <paramref name="paths"/> are the affected sources; <paramref name="destination"/> is optional.</summary>
    public static void Log(string action, IEnumerable<string?>? paths = null, string? destination = null, string? detail = null)
    {
        try
        {
            var sb = new StringBuilder(160);
            sb.Append(DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:ss.fffzzz"));
            sb.Append(' ').Append(OneLine(action)).Append(" | ");
            sb.Append(string.Join("; ", (paths ?? []).Where(p => !string.IsNullOrEmpty(p)).Select(p => OneLine(p!))));
            if (!string.IsNullOrEmpty(destination)) sb.Append(" -> ").Append(OneLine(destination));
            if (!string.IsNullOrEmpty(detail)) sb.Append(" (").Append(OneLine(detail)).Append(')');
            sb.Append(Environment.NewLine);

            lock (Gate)
            {
                Directory.CreateDirectory(LogDir);
                File.AppendAllText(LogFile, sb.ToString());
                TrimIfNeeded();
            }
        }
        catch
        {
            // Logging must never break a file operation.
        }
    }

    /// <summary>
    /// Rolling: once the file passes <see cref="MaxBytes"/>, drop the oldest entries so only the newest
    /// whole lines remain. It trims to <see cref="TrimToBytes"/> (a little under the cap) so the file isn't
    /// rewritten on every append. Must be called with <see cref="Gate"/> held.
    /// </summary>
    private static void TrimIfNeeded()
    {
        try
        {
            var fi = new FileInfo(LogFile);
            if (!fi.Exists || fi.Length <= MaxBytes) return;

            byte[] tail;
            using (var fs = new FileStream(LogFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                var keep = (int)Math.Min(TrimToBytes, fs.Length);
                fs.Seek(-keep, SeekOrigin.End);
                tail = new byte[keep];
                fs.ReadExactly(tail);
            }

            // Start at the first full line so we never leave a partial entry (or split a UTF-8 sequence).
            var start = Array.IndexOf(tail, (byte)'\n') + 1;
            var tmp = LogFile + ".tmp";
            using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(tail, start, tail.Length - start);
            }
            File.Move(tmp, LogFile, overwrite: true);
        }
        catch
        {
            // Best effort; the next append will try again.
        }
    }

    /// <summary>Opens the log in the default app for .log files, falling back to Notepad. Creates it empty if missing.</summary>
    public static void Open()
    {
        lock (Gate)
        {
            Directory.CreateDirectory(LogDir);
            if (!File.Exists(LogFile)) File.WriteAllText(LogFile, "");
        }
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(LogFile) { UseShellExecute = true });
        }
        catch
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("notepad.exe", $"\"{LogFile}\"") { UseShellExecute = true });
        }
    }

    public static void Log(string action, string path,string? destination = null, string? detail = null) =>
        Log(action, new[] { path }, destination, detail);

    private static string OneLine(string s) => s.Replace("\r", " ").Replace("\n", " ");
}
