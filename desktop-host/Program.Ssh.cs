using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Renci.SshNet;
using Renci.SshNet.Common;
using Renci.SshNet.Sftp;

namespace CrushExplorer;

/// <summary>
/// Routes file-system actions whose paths use the <c>ssh://{connectionId}/remote/path</c> scheme
/// through SFTP (see <see cref="SshManager"/>). Local paths never reach this code.
/// </summary>
public partial class Program
{
    private static readonly string SshTempDir = Path.Combine(Path.GetTempPath(), "Rook", "ssh");

    // ---- Location abstraction so copy/move works local<->ssh and ssh<->ssh ----

    private abstract record FsLoc(string Path)
    {
        public abstract string Name { get; }
    }

    private sealed record LocalLoc(string Path) : FsLoc(Path)
    {
        public override string Name => System.IO.Path.GetFileName(Path.TrimEnd('\\', '/'));
    }

    private sealed record SshLoc(SftpClient FallbackClient, string Id, string Remote) : FsLoc(SshManager.BuildPath(Id, Remote))
    {
        public SftpClient Client
        {
            get
            {
                SshManager.Touch(Id);
                return SshManager.TryGetConnectedClient(Id) ?? FallbackClient;
            }
        }
        public override string Name => RemoteName(Remote);
    }

    private const int MaxSshRetries = 3;

    private static bool IsTransientSshError(Exception ex)
    {
        if (ex is OperationCanceledException or SftpPathNotFoundException or SftpPermissionDeniedException)
            return false;
        if (ex is SshOperationTimeoutException or SshConnectionException or System.Net.Sockets.SocketException or TimeoutException or ObjectDisposedException)
            return true;
        if (ex is SshException)
            return true;
        if (ex.InnerException != null && IsTransientSshError(ex.InnerException))
            return true;
        return false;
    }

    private static void WaitBeforeSshRetry(int attempt, CancellationToken ct)
    {
        int delayMs = Math.Min(5000, 1000 * attempt);
        if (ct.CanBeCanceled)
        {
            ct.WaitHandle.WaitOne(delayMs);
            ct.ThrowIfCancellationRequested();
        }
        else
        {
            Thread.Sleep(delayMs);
        }
    }

    private static T RunSshWithRetry<T>(SshLoc loc, Func<SftpClient, T> op, CancellationToken ct = default, string? operationName = null)
    {
        for (int attempt = 1; ; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            var client = loc.Client;
            try
            {
                return op(client);
            }
            catch (Exception ex) when (attempt <= MaxSshRetries && !ct.IsCancellationRequested && IsTransientSshError(ex))
            {
                RookLog.Warn("ssh",
                    $"Transient SSH error in {operationName ?? "SFTP op"} on {loc.Id} (attempt {attempt}/{MaxSshRetries}): {ex.Message}; reconnecting...");
                WaitBeforeSshRetry(attempt, ct);
                SshManager.ReconnectAsync(loc.Id, client, ct).GetAwaiter().GetResult();
            }
        }
    }

    private static void RunSshWithRetry(SshLoc loc, Action<SftpClient> op, CancellationToken ct = default, string? operationName = null) =>
        RunSshWithRetry(loc, c => { op(c); return true; }, ct, operationName);

    /// <summary>Acquires active-use leases for every distinct SSH host referenced by the given paths.</summary>
    private static IDisposable BeginSshUseForPaths(IEnumerable<string?> paths)
    {
        var scopes = new List<IDisposable>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in paths)
        {
            if (p != null && SshManager.IsSshPath(p))
            {
                var (id, _) = SshManager.ParsePath(p);
                if (seen.Add(id)) scopes.Add(SshManager.BeginUse(id));
            }
        }
        return new CompositeDisposable(scopes);
    }

    private sealed class CompositeDisposable(List<IDisposable> items) : IDisposable
    {
        public void Dispose()
        {
            foreach (var d in items) { try { d.Dispose(); } catch { } }
        }
    }

    private static string RemoteName(string remote)
    {
        var trimmed = remote.TrimEnd('/');
        var idx = trimmed.LastIndexOf('/');
        return idx < 0 ? trimmed : trimmed[(idx + 1)..];
    }

    private static string RemoteParent(string remote)
    {
        var trimmed = SshManager.NormalizeRemotePath(remote);
        if (trimmed == "/") return "/";
        var idx = trimmed.LastIndexOf('/');
        return idx <= 0 ? "/" : trimmed[..idx];
    }

    private static string RemoteCombine(string dir, string name) =>
        SshManager.NormalizeRemotePath(dir.TrimEnd('/') + "/" + name);

    private static void ValidateRemoteName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Contains('/') || name is "." or "..")
            throw new ArgumentException($"Invalid name: {name}");
    }

    private static async Task<FsLoc> ResolveLocAsync(string path, CancellationToken ct)
    {
        if (!SshManager.IsSshPath(path)) return new LocalLoc(System.IO.Path.GetFullPath(path));
        var (id, remote) = SshManager.ParsePath(path);
        var client = await SshManager.GetClientAsync(id, ct);
        return new SshLoc(client, id, remote);
    }

    private static FsLoc Child(FsLoc dir, string name) => dir switch
    {
        LocalLoc l => new LocalLoc(System.IO.Path.Combine(l.Path, name)),
        SshLoc s => new SshLoc(s.Client, s.Id, RemoteCombine(s.Remote, name)),
        _ => throw new NotSupportedException(),
    };

    /// <summary>Stat that follows symlinks; null when the path does not exist.</summary>
    private static SftpFileAttributes? RemoteStat(SftpClient c, string remote)
    {
        try { return c.GetAttributes(remote); }
        catch (SftpPathNotFoundException) { return null; }
    }

    private static bool LocExists(FsLoc loc) => loc switch
    {
        LocalLoc l => File.Exists(l.Path) || Directory.Exists(l.Path),
        SshLoc s => RunSshWithRetry(s, c => RemoteStat(c, s.Remote) != null, operationName: "stat"),
        _ => false,
    };

    private static bool LocIsDir(FsLoc loc) => loc switch
    {
        LocalLoc l => Directory.Exists(l.Path),
        SshLoc s => RunSshWithRetry(s, c => RemoteStat(c, s.Remote)?.IsDirectory == true, operationName: "stat"),
        _ => false,
    };

    /// <summary>Directory children. Symlinked directories are reported but flagged, so recursion can skip them.</summary>
    private static IEnumerable<(string Name, bool IsDir, bool IsLink)> LocChildren(FsLoc loc)
    {
        if (loc is LocalLoc l)
        {
            foreach (var e in new DirectoryInfo(l.Path).EnumerateFileSystemInfos())
            {
                bool isDir = (e.Attributes & FileAttributes.Directory) != 0;
                bool isLink = (e.Attributes & FileAttributes.ReparsePoint) != 0;
                yield return (e.Name, isDir, isLink);
            }
        }
        else if (loc is SshLoc s)
        {
            var entries = RunSshWithRetry(s, c => c.ListDirectory(s.Remote).ToList(), operationName: "list");
            foreach (var f in entries)
            {
                if (f.Name is "." or "..") continue;
                bool isDir = f.IsDirectory;
                if (f.IsSymbolicLink) isDir = RunSshWithRetry(s, c => RemoteStat(c, f.FullName)?.IsDirectory == true, operationName: "stat");
                yield return (f.Name, isDir, f.IsSymbolicLink);
            }
        }
    }

    private static void LocMkdir(FsLoc loc)
    {
        if (loc is LocalLoc l) Directory.CreateDirectory(l.Path);
        else if (loc is SshLoc s)
        {
            RunSshWithRetry(s, c =>
            {
                if (RemoteStat(c, s.Remote) == null) c.CreateDirectory(s.Remote);
            }, operationName: "mkdir");
        }
    }

    private static Stream LocOpenRead(FsLoc loc) => loc switch
    {
        LocalLoc l => new FileStream(l.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16),
        SshLoc s => s.Client.OpenRead(s.Remote),
        _ => throw new NotSupportedException(),
    };

    private static Stream LocOpenWrite(FsLoc loc) => loc switch
    {
        LocalLoc l => new FileStream(l.Path, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16),
        SshLoc s => s.Client.Create(s.Remote),
        _ => throw new NotSupportedException(),
    };

    private static void RemoteDeleteTree(SftpClient c, string remote)
    {
        if (SshManager.NormalizeRemotePath(remote) == "/") throw new InvalidOperationException("Refusing to delete the remote root.");
        SftpFileAttributes attrs;
        try { attrs = c.GetAttributes(remote); }
        catch (SftpPathNotFoundException) { return; }

        // GetAttributes follows links; check the entry itself so a symlink is unlinked, not recursed into.
        var self = c.ListDirectory(RemoteParent(remote)).FirstOrDefault(f => f.Name == RemoteName(remote));
        if (self is { IsSymbolicLink: true } || !attrs.IsDirectory)
        {
            c.DeleteFile(remote);
            return;
        }
        foreach (var f in c.ListDirectory(remote).ToList())
        {
            if (f.Name is "." or "..") continue;
            if (f.IsDirectory && !f.IsSymbolicLink) RemoteDeleteTree(c, f.FullName);
            else c.DeleteFile(f.FullName);
        }
        c.DeleteDirectory(remote);
    }

    private static FsLoc UniqueCopyDestination(FsLoc src, FsLoc destDir)
    {
        var candidate = Child(destDir, src.Name);
        if (!string.Equals(candidate.Path, src.Path, StringComparison.OrdinalIgnoreCase)) return candidate;
        var baseName = System.IO.Path.GetFileNameWithoutExtension(src.Name);
        var ext = System.IO.Path.GetExtension(src.Name);
        candidate = Child(destDir, $"{baseName} - Copy{ext}");
        for (int n = 2; LocExists(candidate); n++) candidate = Child(destDir, $"{baseName} - Copy ({n}){ext}");
        return candidate;
    }

    // ---- DTO helpers ----

    private static long ToUnixMs(DateTime utc) =>
        utc == DateTime.MinValue ? 0 : new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    private static string ExtOf(string name)
    {
        var ext = System.IO.Path.GetExtension(name);
        return string.IsNullOrEmpty(ext) ? "" : ext.TrimStart('.').ToLowerInvariant();
    }

    private static object RemoteEntryDto(SshLoc dir, ISftpFile f)
    {
        bool isDir = f.IsDirectory;
        long size = f.Length;
        DateTime mtime = f.LastWriteTimeUtc;
        if (f.IsSymbolicLink)
        {
            var target = RemoteStat(dir.Client, f.FullName);
            if (target != null)
            {
                isDir = target.IsDirectory;
                size = target.Size;
                mtime = target.LastWriteTimeUtc;
            }
        }
        return new
        {
            name = f.Name,
            path = SshManager.BuildPath(dir.Id, f.FullName),
            isDirectory = isDir,
            // Remote folder sizes are not scanned (that would walk the whole tree over the network).
            sizeBytes = isDir ? 0L : size,
            modifiedMs = ToUnixMs(mtime),
            extension = isDir ? "folder" : ExtOf(f.Name),
        };
    }

    private static string SshMediaUrl(string endpoint, string sshPath, SftpFileAttributes attrs, string extra = "") =>
        $"/api/fs/{endpoint}?path={Uri.EscapeDataString(sshPath)}{extra}&m={attrs.LastWriteTimeUtc.Ticks}";

    private static string? Str(JsonElement root, string name) =>
        root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    private static void BumpDirVersion() => Interlocked.Increment(ref DirChangeSequence);

    // ---- POST /api/fs/{action} routing ----

    /// <summary>
    /// Handles the action when any of its path arguments is an SSH path. Returns null when the
    /// request is purely local, so the regular local handler runs.
    /// </summary>
    private static async Task<IResult?> TryHandleSshActionAsync(string action, JsonElement root, CancellationToken ct)
    {
        bool involvesSsh = action switch
        {
            "list" or "search" or "preview" or "mediaInfo" or "delete" or "zipExtract" or "openFile"
                or "revealInExplorer" or "openPowershell" => SshManager.IsSshPath(Str(root, "path")),
            "mkdir" or "createFile" => SshManager.IsSshPath(Str(root, "dir")),
            "rename" => SshManager.IsSshPath(Str(root, "oldPath")),
            "copy" or "move" => SshManager.IsSshPath(Str(root, "sourcePath")) || SshManager.IsSshPath(Str(root, "destDir")),
            "zipCompress" or "openWith" => PathsArg(root).Any(SshManager.IsSshPath),
            _ => false,
        };
        if (!involvesSsh) return null;

        try
        {
            var sshPaths = PathsArg(root);
            sshPaths.Add(Str(root, "dir") ?? "");
            sshPaths.Add(Str(root, "oldPath") ?? "");
            sshPaths.Add(Str(root, "sourcePath") ?? "");
            sshPaths.Add(Str(root, "destDir") ?? "");
            using var _ = BeginSshUseForPaths(sshPaths);
            // SSH.NET's SFTP API is synchronous; keep it off the request thread.
            return await Task.Run(() => HandleSshActionAsync(action, root, ct), ct);
        }
        catch (SftpPathNotFoundException ex)
        {
            return Results.Json(new { error = $"Not found: {ex.Message}" }, statusCode: 404);
        }
        catch (SftpPermissionDeniedException ex)
        {
            return Results.Json(new { error = $"Permission denied: {ex.Message}" }, statusCode: 403);
        }
        catch (KeyNotFoundException ex)
        {
            return Results.Json(new { error = ex.Message }, statusCode: 404);
        }
        catch (IOException ex)
        {
            return Results.Json(new { error = ex.Message }, statusCode: 409);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException)
        {
            return Results.Json(new { error = ex.Message }, statusCode: 400);
        }
        catch (Exception ex) when (ex is SshException or InvalidOperationException)
        {
            RookLog.Warn("ssh", $"SSH action '{action}' failed", ex.Message);
            return Results.Json(new { error = ex.Message }, statusCode: 502);
        }
    }

    private static List<string> PathsArg(JsonElement root)
    {
        var list = new List<string>();
        if (root.TryGetProperty("paths", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in arr.EnumerateArray())
                if (el.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(el.GetString())) list.Add(el.GetString()!);
        }
        else if (Str(root, "path") is { Length: > 0 } single)
        {
            list.Add(single);
        }
        return list;
    }

    private static async Task<IResult> HandleSshActionAsync(string action, JsonElement root, CancellationToken ct)
    {
        switch (action)
        {
            case "list":
            {
                var dir = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                var items = RunSshWithRetry(dir, c =>
                    c.ListDirectory(dir.Remote)
                        .Where(f => f.Name is not ("." or ".."))
                        .Take(500)
                        .Select(f => RemoteEntryDto(dir, f))
                        .ToList(), ct, "list");
                string? parentPath = dir.Remote == "/" ? null : SshManager.BuildPath(dir.Id, RemoteParent(dir.Remote));
                return Results.Json(new
                {
                    path = dir.Path,
                    parentPath,
                    items,
                    version = Interlocked.Read(ref DirChangeSequence),
                });
            }

            case "search":
            {
                var dir = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                var query = Str(root, "query")?.Trim() ?? "";
                var items = new List<object>();
                if (query.Length > 0)
                {
                    var deadline = DateTime.UtcNow.AddSeconds(20);
                    var queue = new Queue<(string Remote, int Depth)>();
                    queue.Enqueue((dir.Remote, 0));
                    while (queue.Count > 0 && items.Count < 200 && DateTime.UtcNow < deadline)
                    {
                        ct.ThrowIfCancellationRequested();
                        var (remote, depth) = queue.Dequeue();
                        IEnumerable<ISftpFile> entries;
                        try { entries = RunSshWithRetry(dir, c => c.ListDirectory(remote).ToList(), ct, "search"); }
                        catch (Exception ex) when (ex is SftpPermissionDeniedException or SftpPathNotFoundException) { continue; }
                        foreach (var f in entries)
                        {
                            if (f.Name is "." or "..") continue;
                            if (f.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
                            {
                                items.Add(RemoteEntryDto(dir, f));
                                if (items.Count >= 200) break;
                            }
                            if (f.IsDirectory && !f.IsSymbolicLink && depth < 6) queue.Enqueue((f.FullName, depth + 1));
                        }
                    }
                }
                return Results.Json(new { path = dir.Path, items });
            }

            case "preview":
            {
                var loc = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                var attrs = RunSshWithRetry(loc, c => c.GetAttributes(loc.Remote), ct, "preview");
                if (attrs.IsDirectory)
                {
                    var children = RunSshWithRetry(loc, c =>
                        c.ListDirectory(loc.Remote)
                            .Where(f => f.Name is not ("." or ".."))
                            .Take(40)
                            .Select(f => f.Name)
                            .ToList(), ct, "preview");
                    return Results.Json(new { kind = "directory", children });
                }

                var ext = ExtOf(loc.Name);
                if (ImageExts.Contains(ext))
                {
                    var (w, h) = ext is "png" or "jpg" or "jpeg" or "bmp" or "gif" or "ico" && attrs.Size <= 25 * 1024 * 1024
                        ? TryReadRemoteImageSize(loc)
                        : (null, null);
                    return Results.Json(new
                    {
                        kind = "image",
                        url = SshMediaUrl("raw", loc.Path, attrs),
                        thumbUrl = SshMediaUrl("thumb", loc.Path, attrs, "&size=256"),
                        width = w,
                        height = h,
                    });
                }
                if (VideoExts.Contains(ext)) return Results.Json(new { kind = "video", url = SshMediaUrl("raw", loc.Path, attrs) });
                if (AudioExts.Contains(ext)) return Results.Json(new { kind = "audio", url = SshMediaUrl("raw", loc.Path, attrs) });

                if (attrs.Size > 256 * 1024)
                {
                    return Results.Json(new
                    {
                        kind = "binary",
                        message = $"Large file ({attrs.Size / 1024.0:F1} KB) — preview truncated",
                    });
                }
                var bytes = RunSshWithRetry(loc, c => c.ReadAllBytes(loc.Remote), ct, "preview");
                if (bytes.Take(512).Any(b => b == 0))
                    return Results.Json(new { kind = "binary", message = $"Binary file ({bytes.Length} bytes)" });
                var content = Encoding.UTF8.GetString(bytes);
                if (content.Length > 8000) content = content[..8000];
                return Results.Json(new { kind = "text", content });
            }

            case "mediaInfo":
            {
                var loc = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                var attrs = RunSshWithRetry(loc, c => RemoteStat(c, loc.Remote), ct, "mediaInfo");
                if (attrs == null || attrs.IsDirectory) return Results.Json(new { error = "File not found" }, statusCode: 404);
                var ext = ExtOf(loc.Name);
                string kind = ImageExts.Contains(ext) ? "image" : VideoExts.Contains(ext) ? "video" : "other";
                int? width = null, height = null;
                if (kind == "image" && ext is "png" or "jpg" or "jpeg" or "bmp" or "gif" or "ico" && attrs.Size <= 25 * 1024 * 1024)
                {
                    (width, height) = TryReadRemoteImageSize(loc);
                }
                long modifiedMs = ToUnixMs(attrs.LastWriteTimeUtc);
                return Results.Json(new
                {
                    kind,
                    width,
                    height,
                    durationSeconds = (double?)null,
                    bitrate = (long?)null,
                    sizeBytes = attrs.Size,
                    // SFTP v3 has no creation time; report the modification time instead.
                    createdMs = modifiedMs,
                    modifiedMs,
                });
            }

            case "mkdir":
            {
                var dir = (SshLoc)await ResolveLocAsync(Str(root, "dir")!, ct);
                var name = Str(root, "name") ?? "";
                ValidateRemoteName(name);
                var target = (SshLoc)Child(dir, name);
                LocMkdir(target);
                BumpDirVersion();
                return Results.Json(new { ok = true, path = target.Path });
            }

            case "createFile":
            {
                var dir = (SshLoc)await ResolveLocAsync(Str(root, "dir")!, ct);
                var name = Str(root, "name") ?? "";
                ValidateRemoteName(name);
                var target = (SshLoc)Child(dir, name);
                RunSshWithRetry(target, c => c.WriteAllText(target.Remote, Str(root, "content") ?? ""), ct, "createFile");
                BumpDirVersion();
                return Results.Json(new { ok = true, path = target.Path });
            }

            case "rename":
            {
                var loc = (SshLoc)await ResolveLocAsync(Str(root, "oldPath")!, ct);
                var newName = Str(root, "newName") ?? "";
                ValidateRemoteName(newName);
                var newRemote = RemoteCombine(RemoteParent(loc.Remote), newName);
                if (newRemote != loc.Remote)
                {
                    RunSshWithRetry(loc, c =>
                    {
                        if (RemoteStat(c, newRemote) != null)
                            throw new IOException($"\"{newName}\" already exists.");
                        c.RenameFile(loc.Remote, newRemote);
                    }, ct, "rename");
                    BumpDirVersion();
                }
                return Results.Json(new { ok = true, path = SshManager.BuildPath(loc.Id, newRemote) });
            }

            case "delete":
            {
                // There is no Recycle Bin on a remote host: SSH deletes are always permanent.
                var loc = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                RemoteDeleteTree(loc.Client, loc.Remote);
                BumpDirVersion();
                return Results.Json(new { ok = true, permanent = true });
            }

            case "copy":
            case "move":
                return await HandleCopyMoveAsync(action, root, ct);

            case "zipCompress":
            {
                var paths = PathsArg(root);
                if (paths.Count == 0) return Results.BadRequest(new { error = "No source paths provided" });
                var sources = new List<FsLoc>();
                foreach (var p in paths) sources.Add(await ResolveLocAsync(p, ct));
                if (sources[0] is not SshLoc first || sources.Any(x => x is not SshLoc sl || sl.Id != first.Id))
                    throw new NotSupportedException("Compress items from one SSH host at a time.");

                var parent = RemoteParent(first.Remote);
                var baseStem = sources.Count == 1
                    ? (LocIsDir(first) ? first.Name : System.IO.Path.GetFileNameWithoutExtension(first.Name))
                    : "Archive";
                if (string.IsNullOrWhiteSpace(baseStem)) baseStem = "Archive";
                var zipRemote = RemoteCombine(parent, $"{baseStem}.zip");
                for (int n = 2; RemoteStat(first.Client, zipRemote) != null; n++)
                    zipRemote = RemoteCombine(parent, $"{baseStem} ({n}).zip");

                using (var output = first.Client.Create(zipRemote))
                using (var archive = new ZipArchive(output, ZipArchiveMode.Create))
                {
                    foreach (SshLoc src in sources) AddRemoteToZip(archive, src, src.Name, ct);
                }
                BumpDirVersion();
                return Results.Json(new { ok = true, path = SshManager.BuildPath(first.Id, zipRemote) });
            }

            case "zipExtract":
            {
                var zip = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                var parent = RemoteParent(zip.Remote);
                var stem = System.IO.Path.GetFileNameWithoutExtension(zip.Name);
                if (string.IsNullOrWhiteSpace(stem)) stem = "Extracted";
                var destRemote = RemoteCombine(parent, stem);
                for (int n = 2; RemoteStat(zip.Client, destRemote) != null; n++)
                    destRemote = RemoteCombine(parent, $"{stem} ({n})");

                zip.Client.CreateDirectory(destRemote);
                using (var input = zip.Client.OpenRead(zip.Remote))
                using (var archive = new ZipArchive(input, ZipArchiveMode.Read))
                {
                    foreach (var entry in archive.Entries)
                    {
                        ct.ThrowIfCancellationRequested();
                        // Normalizing first and checking the prefix blocks "../" entries (zip slip).
                        var target = SshManager.NormalizeRemotePath(destRemote + "/" + entry.FullName);
                        if (!target.StartsWith(destRemote + "/", StringComparison.Ordinal)) continue;
                        if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
                        {
                            EnsureRemoteDirs(zip.Client, target);
                            continue;
                        }
                        EnsureRemoteDirs(zip.Client, RemoteParent(target));
                        using var es = entry.Open();
                        using var os = zip.Client.Create(target);
                        es.CopyTo(os, 1 << 16);
                    }
                }
                BumpDirVersion();
                return Results.Json(new { ok = true, path = SshManager.BuildPath(zip.Id, destRemote) });
            }

            case "openFile":
            {
                // Opens a temporary local copy with the default app. Edits are not synced back.
                var loc = (SshLoc)await ResolveLocAsync(Str(root, "path")!, ct);
                if (LocIsDir(loc)) throw new NotSupportedException("Remote folders can't be opened in Windows. Browse them in Rook instead.");
                var local = DownloadToTemp(loc);
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = local,
                    WorkingDirectory = System.IO.Path.GetDirectoryName(local)!,
                    UseShellExecute = true,
                });
                return Results.Json(new { ok = true, tempCopy = local });
            }

            case "openWith":
                return Results.Json(new { ok = false, error = "Opening remote files in an editor isn't supported yet." });

            case "revealInExplorer":
            case "openPowershell":
                return Results.Json(new { error = "This action isn't available for SSH locations." }, statusCode: 400);
        }
        return Results.NotFound(new { error = "Unknown action" });
    }

    // ---- Remote drives (mounted filesystems) ----

    private static readonly HashSet<string> RemoteNetworkFsTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "nfs", "nfs4", "cifs", "smb3", "smbfs", "zfs", "ceph", "glusterfs", "9p", "virtiofs",
        "fuse.sshfs", "fuse.rclone", "fuse.mergerfs", "fuse.glusterfs", "mergerfs",
    };

    private static readonly string[] RemoteSystemMountPrefixes =
    {
        "/boot", "/efi", "/snap", "/proc", "/sys", "/dev", "/run", "/tmp", "/var/lib/docker",
        "/var/lib/containers", "/var/lib/kubelet", "/var/lib/lxcfs", "/var/snap", "/nix/store",
    };

    /// <summary>/proc/mounts escapes spaces, tabs, newlines and backslashes as 3-digit octal (\040).</summary>
    private static string UnescapeMountField(string s) =>
        s.Contains('\\')
            ? System.Text.RegularExpressions.Regex.Replace(s, @"\\([0-7]{3})",
                m => ((char)Convert.ToInt32(m.Groups[1].Value, 8)).ToString())
            : s;

    private static string? ReadRemoteMountTable(SftpClient client)
    {
        // procfs files report a size of 0, so read to EOF instead of trusting the length.
        foreach (var candidate in new[] { "/proc/self/mounts", "/proc/mounts", "/etc/mtab" })
        {
            try
            {
                using var stream = client.OpenRead(candidate);
                using var ms = new MemoryStream();
                var buffer = new byte[1 << 15];
                int read;
                while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    ms.Write(buffer, 0, read);
                    if (ms.Length > 4 * 1024 * 1024) break;
                }
                if (ms.Length > 0) return Encoding.UTF8.GetString(ms.ToArray());
            }
            catch (Exception ex) when (ex is SshException or IOException)
            {
                // Try the next location (non-Linux hosts have none of them).
            }
        }
        return null;
    }

    /// <summary>
    /// Lists the disks mounted on the remote host (Linux: parsed from /proc/mounts over SFTP), with
    /// capacity from the statvfs@openssh.com extension when the server supports it. Pseudo, loop
    /// and system mounts (/boot, /snap, container storage...) are left out. Hosts without a
    /// readable mount table yield an empty list.
    /// </summary>
    private static List<object> ListRemoteDrives(SftpClient client, string id)
    {
        var drives = new List<object>();
        var table = ReadRemoteMountTable(client);
        if (table == null) return drives;

        // Later entries shadow earlier ones mounted at the same place.
        var byMountPoint = new Dictionary<string, (string Device, string FsType)>(StringComparer.Ordinal);
        foreach (var line in table.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var fields = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length < 3) continue;
            var device = UnescapeMountField(fields[0]);
            var mountPoint = UnescapeMountField(fields[1]);
            var fsType = fields[2];
            if (!mountPoint.StartsWith('/')) continue;
            mountPoint = SshManager.NormalizeRemotePath(mountPoint);

            bool isDisk = device.StartsWith("/dev/", StringComparison.Ordinal)
                && !device.StartsWith("/dev/loop", StringComparison.Ordinal)
                && fsType is not ("squashfs" or "swap" or "devtmpfs");
            bool isNetwork = RemoteNetworkFsTypes.Contains(fsType);
            if (!isDisk && !isNetwork) continue;
            if (RemoteSystemMountPrefixes.Any(p => mountPoint == p || mountPoint.StartsWith(p + "/", StringComparison.Ordinal))) continue;

            byMountPoint[mountPoint] = (device, fsType);
        }

        var seenDevices = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (mountPoint, (device, fsType)) in byMountPoint.OrderBy(kv => kv.Key == "/" ? 0 : 1).ThenBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase))
        {
            if (drives.Count >= 64) break;
            try
            {
                // Skips file bind mounts (containers) and mounts this user can't enter.
                if (!client.GetAttributes(mountPoint).IsDirectory) continue;
            }
            catch (Exception ex) when (ex is SshException or IOException)
            {
                continue;
            }

            // One entry per disk: a device mounted in several places (btrfs subvolumes such as
            // / and /home, bind mounts) is the same storage pool. The ordering above keeps "/"
            // or else the parent-most mount point.
            if (!seenDevices.Add(device)) continue;

            long totalBytes = 0, freeBytes = 0;
            try
            {
                var st = client.GetStatus(mountPoint);
                totalBytes = (long)Math.Min(st.TotalBlocks * st.BlockSize, long.MaxValue);
                freeBytes = (long)Math.Min(st.AvailableBlocks * st.BlockSize, long.MaxValue);
            }
            catch (Exception ex) when (ex is SshException or IOException or NotSupportedException)
            {
                // Server without statvfs support: show the drive without a usage bar.
            }

            drives.Add(new
            {
                name = mountPoint == "/" ? "/" : RemoteName(mountPoint),
                path = SshManager.BuildPath(id, mountPoint),
                mountPoint,
                device,
                fsType,
                totalBytes,
                freeBytes,
            });
        }
        return drives;
    }

    private static bool IsSameOrInside(FsLoc candidate, FsLoc folder)
    {
        if (candidate.GetType() != folder.GetType()) return false;
        if (candidate is SshLoc c && folder is SshLoc f && c.Id != f.Id) return false;
        var sep = candidate is SshLoc ? "/" : "\\";
        var a = candidate.Path.TrimEnd('/', '\\');
        var b = folder.Path.TrimEnd('/', '\\');
        var cmp = candidate is SshLoc ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        return string.Equals(a, b, cmp) || a.StartsWith(b + sep, cmp);
    }

    private static void EnsureRemoteDirs(SftpClient c, string remote)
    {
        var path = "";
        foreach (var seg in SshManager.NormalizeRemotePath(remote).Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            path += "/" + seg;
            var st = RemoteStat(c, path);
            if (st == null) c.CreateDirectory(path);
            else if (!st.IsDirectory) throw new IOException($"{path} exists and is not a folder.");
        }
    }

    private static void AddRemoteToZip(ZipArchive archive, SshLoc src, string entryName, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (LocIsDir(src))
        {
            foreach (var (name, isDir, isLink) in LocChildren(src).ToList())
            {
                if (isDir && isLink) continue;
                AddRemoteToZip(archive, (SshLoc)Child(src, name), $"{entryName}/{name}", ct);
            }
            return;
        }
        var entry = archive.CreateEntry(entryName, CompressionLevel.Fastest);
        using var es = entry.Open();
        using var input = src.Client.OpenRead(src.Remote);
        input.CopyTo(es, 1 << 16);
    }

    private static (int? Width, int? Height) TryReadRemoteImageSize(SshLoc loc)
    {
        try
        {
            using var ms = new MemoryStream();
            loc.Client.DownloadFile(loc.Remote, ms);
            ms.Position = 0;
            using var img = System.Drawing.Image.FromStream(ms, false, false);
            return (img.Width, img.Height);
        }
        catch
        {
            return (null, null);
        }
    }

    private static string DownloadToTemp(SshLoc loc)
    {
        var dir = System.IO.Path.Combine(SshTempDir, loc.Id, Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        var local = System.IO.Path.Combine(dir, loc.Name);
        using (var fs = File.Create(local)) loc.Client.DownloadFile(loc.Remote, fs);
        return local;
    }

    /// <summary>Removes temp copies of remote files (openFile, thumbnails) older than a day.</summary>
    private static void CleanupSshTemp()
    {
        try
        {
            if (!Directory.Exists(SshTempDir)) return;
            var cutoff = DateTime.UtcNow.AddDays(-1);
            foreach (var f in Directory.EnumerateFiles(SshTempDir, "*", SearchOption.AllDirectories))
            {
                try { if (File.GetLastWriteTimeUtc(f) < cutoff) File.Delete(f); } catch { }
            }
            foreach (var d in Directory.EnumerateDirectories(SshTempDir, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length))
            {
                try { if (!Directory.EnumerateFileSystemEntries(d).Any()) Directory.Delete(d); } catch { }
            }
        }
        catch { }
    }

    // ---- GET /api/fs/raw and /api/fs/thumb for SSH paths ----

    /// <summary>Runs a media response for an SSH path, mapping connection/SFTP failures to status codes.</summary>
    private static async Task ServeSshMediaSafelyAsync(HttpContext ctx, Func<Task> serve)
    {
        try
        {
            await serve();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            if (ctx.Response.HasStarted) return;
            ctx.Response.StatusCode = ex switch
            {
                SftpPathNotFoundException or KeyNotFoundException => 404,
                SftpPermissionDeniedException => 403,
                ArgumentException => 400,
                _ => 502,
            };
            if (ctx.Response.StatusCode == 502) RookLog.Warn("ssh", "SSH media request failed", ex.Message);
        }
    }

    /// <summary>Streams a remote file, honouring a single HTTP byte range so video/audio can seek.</summary>
    private static async Task ServeSshRawAsync(HttpContext ctx, string sshPath, Func<string, string> contentType)
    {
        var (id, remote) = SshManager.ParsePath(sshPath);
        using var _ = SshManager.BeginUse(id);
        var client = await SshManager.GetClientAsync(id, ctx.RequestAborted);
        var attrs = RemoteStat(client, remote);
        if (attrs == null || attrs.IsDirectory)
        {
            ctx.Response.StatusCode = 404;
            return;
        }

        long length = attrs.Size;
        long start = 0, end = length - 1;
        var range = ctx.Request.Headers.Range.ToString();
        bool partial = false;
        if (range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase) && !range.Contains(','))
        {
            var spec = range[6..].Split('-', 2);
            if (spec.Length == 2)
            {
                if (spec[0].Length == 0 && long.TryParse(spec[1], out var suffix))
                {
                    start = Math.Max(0, length - suffix);
                    partial = true;
                }
                else if (long.TryParse(spec[0], out var s))
                {
                    start = s;
                    if (spec[1].Length > 0 && long.TryParse(spec[1], out var e)) end = Math.Min(e, length - 1);
                    partial = true;
                }
            }
            if (partial && (start >= length || start > end))
            {
                ctx.Response.StatusCode = 416;
                ctx.Response.Headers.ContentRange = $"bytes */{length}";
                return;
            }
        }

        ctx.Response.ContentType = contentType(remote);
        ctx.Response.Headers.AcceptRanges = "bytes";
        long count = length == 0 ? 0 : end - start + 1;
        if (partial)
        {
            ctx.Response.StatusCode = 206;
            ctx.Response.Headers.ContentRange = $"bytes {start}-{end}/{length}";
        }
        ctx.Response.ContentLength = count;
        if (count == 0) return;

        await using var input = client.OpenRead(remote);
        if (start > 0) input.Seek(start, SeekOrigin.Begin);
        var buffer = new byte[1 << 16];
        long remaining = count;
        while (remaining > 0)
        {
            SshManager.Touch(id);
            int read = await input.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), ctx.RequestAborted);
            if (read <= 0) break;
            await ctx.Response.Body.WriteAsync(buffer.AsMemory(0, read), ctx.RequestAborted);
            remaining -= read;
        }
    }

    /// <summary>
    /// Image thumbnails for remote files: the image is downloaded once to a temp file, run through the
    /// normal thumbnail pipeline, and cached by remote path + mtime + size like local thumbnails.
    /// Videos and other files get no remote thumbnail (404) to avoid downloading large files.
    /// </summary>
    private static async Task ServeSshThumbAsync(HttpContext ctx, string sshPath, int size, Func<string, string> contentType)
    {
        var (id, remote) = SshManager.ParsePath(sshPath);
        using var _ = SshManager.BeginUse(id);
        var ext = ExtOf(RemoteName(remote));
        if (!ImageExts.Contains(ext))
        {
            ctx.Response.StatusCode = 404;
            return;
        }
        if (ext == "svg")
        {
            await ServeSshRawAsync(ctx, sshPath, contentType);
            return;
        }

        var client = await SshManager.GetClientAsync(id, ctx.RequestAborted);
        var attrs = RemoteStat(client, remote);
        if (attrs == null || attrs.IsDirectory || attrs.Size > 50L * 1024 * 1024)
        {
            ctx.Response.StatusCode = 404;
            return;
        }

        var key = ComputeThumbKey(SshManager.BuildPath(id, remote), attrs.LastWriteTimeUtc.Ticks, attrs.Size, size);
        var cachedPng = System.IO.Path.Combine(ThumbCacheDir, $"{key}.png");
        if (!File.Exists(cachedPng))
        {
            Directory.CreateDirectory(ThumbCacheDir);
            var tmpDir = System.IO.Path.Combine(SshTempDir, "thumbs");
            Directory.CreateDirectory(tmpDir);
            var tmp = System.IO.Path.Combine(tmpDir, $"{key}.{ext}");
            try
            {
                await Task.Run(() =>
                {
                    using var fs = File.Create(tmp);
                    client.DownloadFile(remote, fs);
                }, ctx.RequestAborted);
                await GetOrGenerateThumbAsync(tmp, size, cachedPng);
            }
            finally
            {
                try { File.Delete(tmp); } catch { }
            }
        }

        if (!File.Exists(cachedPng))
        {
            ctx.Response.StatusCode = 404;
            return;
        }
        ctx.Response.ContentType = "image/png";
        ctx.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        await ctx.Response.SendFileAsync(cachedPng);
    }
}
