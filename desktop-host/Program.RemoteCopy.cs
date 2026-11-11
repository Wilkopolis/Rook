using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Renci.SshNet;

namespace CrushExplorer;

/// <summary>
/// "Direct" copy/move from a network share to an SSH host: when the host has the same SMB share
/// mounted that the source lives on here (e.g. Z: = \\OfficeNAS\Torrents, mounted on the host at
/// /mnt/Torrents), the host runs rsync itself and the bytes go NAS -> host without passing through
/// this PC. Requested per item with <c>viaRemote</c> on the copy/move actions.
/// </summary>
public partial class Program
{
    /// <summary>An SMB share mounted on an SSH host: <c>//Host/SharePath</c> at <c>MountPoint</c>.</summary>
    private sealed record RemoteShareMount(string Host, string[] SharePath, string MountPoint);

    private static readonly ConcurrentDictionary<string, (long Ticks, List<RemoteShareMount> Mounts)> RemoteShareCache =
        new(StringComparer.OrdinalIgnoreCase);

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetGetConnectionW(string localName, StringBuilder remoteName, ref int length);

    /// <summary>\\server\share\rest for a UNC path or a path on a mapped network drive; null for anything else.</summary>
    private static string? ToUncPath(string localPath)
    {
        if (string.IsNullOrWhiteSpace(localPath) || SshManager.IsSshPath(localPath)) return null;
        var full = System.IO.Path.GetFullPath(localPath);
        if (full.StartsWith(@"\\", StringComparison.Ordinal)) return full.StartsWith(@"\\?\", StringComparison.Ordinal) ? null : full;
        if (full.Length < 2 || full[1] != ':') return null;

        var sb = new StringBuilder(1024);
        int len = sb.Capacity;
        if (WNetGetConnectionW(full[..2], sb, ref len) != 0) return null;
        return sb.ToString().TrimEnd('\\') + full[2..];
    }

    private static HashSet<string> ResolveIPv4(string host)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            if (IPAddress.TryParse(host, out var ip)) { set.Add(ip.ToString()); return set; }
            foreach (var a in Dns.GetHostAddresses(host))
                if (a.AddressFamily == AddressFamily.InterNetwork) set.Add(a.ToString());
        }
        catch (Exception)
        {
            // Unresolvable from here: the caller falls back to matching the share name alone.
        }
        return set;
    }

    private static bool SameServer(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) return true;
        var ia = ResolveIPv4(a);
        var ib = ResolveIPv4(b);
        // Only a definite mismatch rules the mount out (names such as "OfficeNAS" don't always resolve to IPv4).
        return ia.Count == 0 || ib.Count == 0 || ia.Overlaps(ib);
    }

    /// <summary>SMB mounts on the host, from /etc/fstab (covers idle automounts) and the live mount table.</summary>
    private static List<RemoteShareMount> GetRemoteShareMounts(SftpClient client, string id)
    {
        if (RemoteShareCache.TryGetValue(id, out var cached) && DateTime.UtcNow.Ticks - cached.Ticks < TimeSpan.FromMinutes(5).Ticks)
            return cached.Mounts;

        var tables = new List<string>();
        try { tables.Add(client.ReadAllText("/etc/fstab")); }
        catch (Exception ex) when (ex is Renci.SshNet.Common.SshException or IOException) { }
        if (ReadRemoteMountTable(client) is { } live) tables.Add(live);

        var mounts = new List<RemoteShareMount>();
        foreach (var line in tables.SelectMany(t => t.Split('\n')))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed[0] == '#') continue;
            var fields = trimmed.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length < 3 || fields[2] is not ("cifs" or "smb3" or "smbfs")) continue;
            var source = UnescapeMountField(fields[0]).Replace('\\', '/');
            if (!source.StartsWith("//", StringComparison.Ordinal)) continue;
            var parts = source.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;
            var mountPoint = SshManager.NormalizeRemotePath(UnescapeMountField(fields[1]));
            if (mounts.Any(m => m.MountPoint == mountPoint)) continue;
            mounts.Add(new RemoteShareMount(parts[0], parts[1..], mountPoint));
        }
        RemoteShareCache[id] = (DateTime.UtcNow.Ticks, mounts);
        return mounts;
    }

    /// <summary>Where the host sees <paramref name="localPath"/> through one of its own SMB mounts; null when it doesn't.</summary>
    private static string? MapLocalToRemote(string localPath, SftpClient client, string id)
    {
        var unc = ToUncPath(localPath);
        if (unc == null) return null;
        var parts = unc.Split('\\', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3) return null; // The share root itself is not an item to copy.
        var server = parts[0];
        var path = parts[1..];
        if (path.Any(p => p is "." or "..")) return null;

        foreach (var m in GetRemoteShareMounts(client, id))
        {
            if (path.Length <= m.SharePath.Length) continue;
            // SMB share and folder names are case-insensitive on the server.
            if (!m.SharePath.SequenceEqual(path[..m.SharePath.Length], StringComparer.OrdinalIgnoreCase)) continue;
            if (!SameServer(server, m.Host)) continue;
            return SshManager.NormalizeRemotePath(m.MountPoint + "/" + string.Join('/', path[m.SharePath.Length..]));
        }
        return null;
    }

    /// <summary><c>remoteCopyCheck</c>: whether the destination host can read every source itself.</summary>
    private static async Task<IResult> HandleRemoteCopyCheckAsync(JsonElement root, CancellationToken ct)
    {
        try
        {
            var destDir = Str(root, "destDir");
            var paths = PathsArg(root);
            if (!SshManager.IsSshPath(destDir) || paths.Count == 0 || paths.Any(SshManager.IsSshPath) || paths.Any(p => ToUncPath(p) == null))
                return Results.Json(new { available = false });

            var (id, _) = SshManager.ParsePath(destDir!);
            using var use = SshManager.BeginUse(id);
            var client = await SshManager.GetClientAsync(id, ct);
            bool available = paths.All(p => MapLocalToRemote(p, client, id) != null);
            var conn = SshManager.Get(id);
            return Results.Json(new { available, hostLabel = conn?.Label ?? conn?.Host });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Json(new { available = false });
        }
    }

    private static string ShellQuote(string s) => "'" + s.Replace("'", "'\\''") + "'";

    // rsync --no-h --info=progress2: "  1234567B  12% 10500000B/s    0:00:10 (xfr#3, to-chk=5/10)"
    // (older versions print "1,234,567" without the unit).
    private static readonly Regex RsyncProgressLine = new(@"^\s*([\d,]+)B?\s+\d+%(?:.*?xfr#(\d+))?", RegexOptions.Compiled);

    /// <summary>
    /// The copy/move actions with <c>viaRemote</c>: runs rsync on the destination host, reading the
    /// source from the host's own mount of the share. A move removes each source file once it has
    /// been transferred, then prunes the folders that ended up empty.
    /// </summary>
    private static async Task<IResult> HandleRemoteTransferAsync(bool isMove, JsonElement root, CancellationToken ct)
    {
        var sourcePath = Str(root, "sourcePath")!;
        if (await ResolveLocAsync(Str(root, "destDir")!, ct) is not SshLoc destDir)
            throw new NotSupportedException("A direct copy needs an SSH destination.");
        var sftp = destDir.Client;
        var conn = SshManager.Get(destDir.Id);
        var hostName = conn?.Label ?? conn?.Host ?? "the SSH host";

        var remoteSrc = MapLocalToRemote(sourcePath, sftp, destDir.Id)
            ?? throw new NotSupportedException($"{hostName} has no mount of the share that holds \"{sourcePath}\".");
        // Also wakes an idle automount before rsync starts.
        if (RunSshWithRetry(destDir, c => RemoteStat(c, remoteSrc), ct, "stat") == null)
            throw new IOException($"{hostName} can't see {remoteSrc}. Is the share mounted there?");
        if (IsSameOrInside(destDir, new SshLoc(sftp, destDir.Id, remoteSrc)))
            throw new IOException("Cannot copy a folder into itself.");

        var dest = (SshLoc)Child(destDir, RemoteName(remoteSrc));
        bool merged = LocExists(dest);

        var cmdText = new StringBuilder("LC_ALL=C rsync -rlt --no-h --info=progress2 --no-inc-recursive");
        // Anything but an explicit "replace" leaves existing destination files alone.
        if (Str(root, "onConflict") != "replace") cmdText.Append(" --ignore-existing");
        if (isMove) cmdText.Append(" --remove-source-files");
        cmdText.Append(" -- ").Append(ShellQuote(remoteSrc)).Append(' ').Append(ShellQuote(destDir.Remote.TrimEnd('/') + "/"));
        if (isMove)
        {
            cmdText.Append("; rc=$?; if [ $rc -eq 0 ] && [ -d ").Append(ShellQuote(remoteSrc))
                .Append(" ]; then find ").Append(ShellQuote(remoteSrc)).Append(" -depth -type d -empty -delete; fi; exit $rc");
        }

        var job = FindTransfer(root);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, job?.Cts.Token ?? CancellationToken.None);
        long baseBytes = job == null ? 0 : Interlocked.Read(ref job.DoneBytes);
        long baseFiles = job == null ? 0 : Interlocked.Read(ref job.DoneFiles);
        if (job != null) job.CurrentName = $"{RemoteName(remoteSrc)} (direct on {hostName})";

        RookLog.Info("ssh", $"Direct {(isMove ? "move" : "copy")} on {destDir.Id}: {remoteSrc} -> {destDir.Remote}");
        using var ssh = await SshManager.ConnectExecClientAsync(destDir.Id, linked.Token);
        using var cmd = ssh.CreateCommand(cmdText.ToString());
        try
        {
            var exec = cmd.ExecuteAsync(linked.Token);
            var reader = Task.Run(() =>
            {
                // Progress lines are redrawn with \r, so split on either line ending.
                var line = new StringBuilder();
                var buffer = new byte[4096];
                int read;
                while ((read = cmd.OutputStream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    for (int i = 0; i < read; i++)
                    {
                        char ch = (char)buffer[i];
                        if (ch != '\r' && ch != '\n') { if (line.Length < 512) line.Append(ch); continue; }
                        var m = RsyncProgressLine.Match(line.ToString());
                        line.Clear();
                        if (!m.Success || job == null) continue;
                        if (long.TryParse(m.Groups[1].Value.Replace(",", ""), out var bytes))
                            Interlocked.Exchange(ref job.DoneBytes, baseBytes + bytes);
                        if (m.Groups[2].Success && long.TryParse(m.Groups[2].Value, out var files))
                            Interlocked.Exchange(ref job.DoneFiles, baseFiles + files);
                        SshManager.Touch(destDir.Id);
                    }
                }
            });
            await exec;
            try { await reader.WaitAsync(TimeSpan.FromSeconds(5)); } catch (Exception) { }
        }
        catch (OperationCanceledException)
        {
            // SIGTERM lets rsync remove its temporary file; closing the session below ends anything left.
            try { cmd.CancelAsync(forceKill: false, millisecondsTimeout: 3000); } catch (Exception) { }
            throw;
        }
        finally
        {
            BumpDirVersion();
        }

        if (cmd.ExitStatus is not 0)
        {
            var err = (cmd.Error ?? "").Trim();
            if (err.Length > 600) err = "..." + err[^600..];
            RookLog.Warn("ssh", $"Direct transfer on {destDir.Id} failed with exit code {cmd.ExitStatus}", err);
            throw new IOException($"rsync on {hostName} failed (exit {cmd.ExitStatus}): {(err.Length > 0 ? err : "no error output")}");
        }
        return Results.Json(new { ok = true, path = dest.Path, skipped = 0, merged });
    }
}
