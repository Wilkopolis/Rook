using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Renci.SshNet;

namespace CrushExplorer;

/// <summary>
/// Progress tracking for copy/move batches. The page opens a job with <c>transferStart</c>, tags
/// each <c>copy</c>/<c>move</c> request of the batch with the job's <c>transferId</c>, polls
/// <c>transferProgress</c> while they run, and closes the job with <c>transferEnd</c>.
/// </summary>
public partial class Program
{
    private sealed class TransferJob
    {
        public readonly CancellationTokenSource Cts = new();
        public long TotalBytes;
        public long TotalFiles;
        public long DoneBytes;
        public long DoneFiles;
        /// <summary>Files already at the destination (identical, or a conflict left alone): counted, not copied.</summary>
        public long SkippedBytes;
        public long SkippedFiles;
        public volatile bool Scanning = true;
        public volatile string CurrentName = "";
        public long LastTouchedTicks = DateTime.UtcNow.Ticks;
    }

    private static readonly ConcurrentDictionary<string, TransferJob> Transfers = new(StringComparer.Ordinal);

    private static TransferJob? FindTransfer(JsonElement root) =>
        Str(root, "transferId") is { Length: > 0 } id && Transfers.TryGetValue(id, out var job) ? job : null;

    /// <summary>Handles the transfer* actions; null for every other action.</summary>
    private static IResult? TryHandleTransferAction(string action, JsonElement root)
    {
        if (action is not ("transferStart" or "transferProgress" or "transferCancel" or "transferEnd")) return null;
        var id = Str(root, "id");
        if (string.IsNullOrWhiteSpace(id)) return Results.BadRequest(new { error = "Missing transfer id" });

        switch (action)
        {
            case "transferStart":
            {
                // Jobs whose page went away (reload mid-transfer) never get a transferEnd.
                var cutoff = DateTime.UtcNow.AddHours(-1).Ticks;
                foreach (var (staleId, stale) in Transfers)
                {
                    if (Interlocked.Read(ref stale.LastTouchedTicks) < cutoff && Transfers.TryRemove(staleId, out _)) stale.Cts.Cancel();
                }

                var job = new TransferJob();
                Transfers[id] = job;
                bool isMove = Str(root, "kind") == "move";
                var paths = PathsArg(root);
                var destDir = Str(root, "destDir") ?? "";
                _ = Task.Run(() => ScanTransferAsync(job, isMove, paths, destDir));
                return Results.Json(new { ok = true });
            }

            case "transferProgress":
            {
                if (!Transfers.TryGetValue(id, out var job)) return Results.Json(new { error = "Unknown transfer" }, statusCode: 404);
                Interlocked.Exchange(ref job.LastTouchedTicks, DateTime.UtcNow.Ticks);
                return Results.Json(new
                {
                    totalBytes = Interlocked.Read(ref job.TotalBytes),
                    totalFiles = Interlocked.Read(ref job.TotalFiles),
                    doneBytes = Interlocked.Read(ref job.DoneBytes),
                    doneFiles = Interlocked.Read(ref job.DoneFiles),
                    skippedBytes = Interlocked.Read(ref job.SkippedBytes),
                    skippedFiles = Interlocked.Read(ref job.SkippedFiles),
                    currentName = job.CurrentName,
                    scanning = job.Scanning,
                });
            }

            case "transferCancel":
            {
                if (Transfers.TryGetValue(id, out var job)) job.Cts.Cancel();
                return Results.Json(new { ok = true });
            }

            default: // transferEnd
            {
                // Cancelling also stops a size scan that is still running.
                if (Transfers.TryRemove(id, out var job)) job.Cts.Cancel();
                return Results.Json(new { ok = true });
            }
        }
    }

    /// <summary>True when moving <paramref name="source"/> into <paramref name="destDir"/> is a rename, so no bytes are transferred.</summary>
    private static bool IsRenameMove(string source, string destDir)
    {
        bool srcSsh = SshManager.IsSshPath(source), dstSsh = SshManager.IsSshPath(destDir);
        if (srcSsh != dstSsh) return false;
        if (!srcSsh) return SameLocalVolume(source, destDir);
        var (srcId, _) = SshManager.ParsePath(source);
        var (dstId, _) = SshManager.ParsePath(destDir);
        return string.Equals(srcId, dstId, StringComparison.OrdinalIgnoreCase);
    }

    private static bool SameLocalVolume(string a, string b) =>
        string.Equals(Path.GetPathRoot(Path.GetFullPath(a)), Path.GetPathRoot(Path.GetFullPath(b)), StringComparison.OrdinalIgnoreCase);

    /// <summary>Totals up what the batch will transfer, in the background, so the bar has a denominator.</summary>
    private static async Task ScanTransferAsync(TransferJob job, bool isMove, List<string> paths, string destDir)
    {
        var ct = job.Cts.Token;
        // Mirrors TransferNode: directory links are only followed for local-to-local copies.
        bool followDirLinks = !isMove && !SshManager.IsSshPath(destDir);
        using var _ = BeginSshUseForPaths(paths.Append(destDir));
        try
        {
            foreach (var path in paths)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    if (isMove && IsRenameMove(path, destDir)) continue;
                    ScanTree(await ResolveLocAsync(path, ct), job, followDirLinks, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Unreadable source: the copy itself reports the error; the total just undercounts.
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            job.Scanning = false;
        }
    }

    private static void AddToTransferTotal(TransferJob job, long bytes)
    {
        Interlocked.Add(ref job.TotalBytes, Math.Max(0, bytes));
        Interlocked.Increment(ref job.TotalFiles);
    }

    private static void ScanTree(FsLoc loc, TransferJob job, bool followDirLinks, CancellationToken ct)
    {
        if (loc is LocalLoc l)
        {
            if (File.Exists(l.Path)) AddToTransferTotal(job, new FileInfo(l.Path).Length);
            else if (Directory.Exists(l.Path)) ScanLocalDir(new DirectoryInfo(l.Path), job, followDirLinks, ct);
        }
        else if (loc is SshLoc s)
        {
            var attrs = RunSshWithRetry(s, c => RemoteStat(c, s.Remote), ct, "scanStat");
            if (attrs == null) return;
            if (attrs.IsDirectory) ScanRemoteDir(s, s.Remote, job, ct);
            else AddToTransferTotal(job, attrs.Size);
        }
    }

    private static void ScanLocalDir(DirectoryInfo dir, TransferJob job, bool followDirLinks, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        List<FileSystemInfo> children;
        try { children = dir.EnumerateFileSystemInfos().ToList(); }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException) { return; }

        foreach (var child in children)
        {
            if (child is FileInfo file)
            {
                AddToTransferTotal(job, file.Length);
            }
            else if (child is DirectoryInfo sub)
            {
                if (!followDirLinks && (sub.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                ScanLocalDir(sub, job, followDirLinks, ct);
            }
        }
    }

    private static void ScanRemoteDir(SshLoc root, string remote, TransferJob job, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var entries = RunSshWithRetry(root, c => c.ListDirectory(remote).ToList(), ct, "scanList");
        foreach (var f in entries)
        {
            if (f.Name is "." or "..") continue;
            if (f.IsSymbolicLink)
            {
                // Linked files are copied through the link; linked directories are skipped.
                var target = RunSshWithRetry(root, c => RemoteStat(c, f.FullName), ct, "scanStat");
                if (target != null && !target.IsDirectory) AddToTransferTotal(job, target.Size);
            }
            else if (f.IsDirectory)
            {
                ScanRemoteDir(root, f.FullName, job, ct);
            }
            else
            {
                AddToTransferTotal(job, f.Length);
            }
        }
    }

    // ---- Copy/move engine: merges into existing folders, file by file ----

    private enum ConflictPolicy
    {
        /// <summary>Stop with an "already exists" error (requests that didn't ask the user).</summary>
        Fail,
        /// <summary>Leave both files as they are.</summary>
        Skip,
        /// <summary>Overwrite the destination file.</summary>
        Replace,
    }

    private sealed class TransferOptions
    {
        public bool IsMove;
        /// <summary>Source and destination share a volume or SSH host, so a move is a rename.</summary>
        public bool CanRename;
        public ConflictPolicy Policy;
        /// <summary>Compare contents when sizes match but dates don't, instead of treating the pair as a conflict.</summary>
        public bool VerifySameSize;
        public TransferJob? Job;
        public CancellationToken Ct;
        /// <summary>Conflicting files left alone under <see cref="ConflictPolicy.Skip"/>.</summary>
        public int Skipped;
    }

    private readonly record struct LocInfo(bool IsDir, bool IsLink, long Size, DateTime MtimeUtc);

    /// <summary>Stat that follows links; null when the path does not exist.</summary>
    private static LocInfo? LocStat(FsLoc loc)
    {
        if (loc is LocalLoc l)
        {
            if (File.Exists(l.Path))
            {
                var f = new FileInfo(l.Path);
                return new LocInfo(false, false, f.Length, f.LastWriteTimeUtc);
            }
            if (Directory.Exists(l.Path))
            {
                var d = new DirectoryInfo(l.Path);
                return new LocInfo(true, (d.Attributes & FileAttributes.ReparsePoint) != 0, 0, d.LastWriteTimeUtc);
            }
            return null;
        }
        if (loc is SshLoc s && RunSshWithRetry(s, c => RemoteStat(c, s.Remote), operationName: "stat") is { } a)
        {
            return new LocInfo(a.IsDirectory, false, a.IsDirectory ? 0 : a.Size, a.LastWriteTimeUtc);
        }
        return null;
    }

    /// <summary>Directory children with the metadata conflict checks need, in one listing per folder.</summary>
    private static List<(string Name, LocInfo Info)> LocList(FsLoc dir)
    {
        var list = new List<(string, LocInfo)>();
        if (dir is LocalLoc l)
        {
            foreach (var e in new DirectoryInfo(l.Path).EnumerateFileSystemInfos())
            {
                bool isDir = (e.Attributes & FileAttributes.Directory) != 0;
                bool isLink = (e.Attributes & FileAttributes.ReparsePoint) != 0;
                list.Add((e.Name, new LocInfo(isDir, isLink, e is FileInfo f ? f.Length : 0, e.LastWriteTimeUtc)));
            }
        }
        else if (dir is SshLoc s)
        {
            var entries = RunSshWithRetry(s, c => c.ListDirectory(s.Remote).ToList(), operationName: "list");
            foreach (var f in entries)
            {
                if (f.Name is "." or "..") continue;
                bool isDir = f.IsDirectory;
                long size = f.Length;
                var mtime = f.LastWriteTimeUtc;
                if (f.IsSymbolicLink && RunSshWithRetry(s, c => RemoteStat(c, f.FullName), operationName: "stat") is { } target)
                {
                    isDir = target.IsDirectory;
                    size = target.Size;
                    mtime = target.LastWriteTimeUtc;
                }
                list.Add((f.Name, new LocInfo(isDir, f.IsSymbolicLink, isDir ? 0 : size, mtime)));
            }
        }
        return list;
    }

    private static StringComparer NameComparer(FsLoc loc) =>
        loc is LocalLoc ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    private static Dictionary<string, LocInfo> LocListByName(FsLoc dir)
    {
        var map = new Dictionary<string, LocInfo>(NameComparer(dir));
        foreach (var (name, info) in LocList(dir)) map[name] = info;
        return map;
    }

    private static bool CanRenameBetween(FsLoc src, FsLoc dst) => (src, dst) switch
    {
        (LocalLoc a, LocalLoc b) => SameLocalVolume(a.Path, b.Path),
        (SshLoc a, SshLoc b) => string.Equals(a.Id, b.Id, StringComparison.OrdinalIgnoreCase),
        _ => false,
    };

    private static void LocRename(FsLoc src, FsLoc dst)
    {
        if (src is LocalLoc a && dst is LocalLoc b)
        {
            if (Directory.Exists(a.Path)) Directory.Move(a.Path, b.Path);
            else File.Move(a.Path, b.Path);
        }
        else if (src is SshLoc s && dst is SshLoc d)
        {
            RunSshWithRetry(s, c => c.RenameFile(s.Remote, d.Remote), operationName: "rename");
        }
        else
        {
            throw new NotSupportedException();
        }
    }

    private static void LocDeleteFile(FsLoc loc)
    {
        if (loc is LocalLoc l)
        {
            var attrs = File.GetAttributes(l.Path);
            if ((attrs & FileAttributes.ReadOnly) != 0) File.SetAttributes(l.Path, attrs & ~FileAttributes.ReadOnly);
            File.Delete(l.Path);
        }
        else if (loc is SshLoc s)
        {
            RunSshWithRetry(s, c =>
            {
                try { c.DeleteFile(s.Remote); }
                catch (Renci.SshNet.Common.SftpPathNotFoundException) { }
            }, operationName: "deleteFile");
        }
    }

    /// <summary>After a move: drops the source folder if everything in it went across. Leftovers keep it.</summary>
    private static void TryRemoveEmptyDir(FsLoc loc)
    {
        try
        {
            if (loc is LocalLoc l) Directory.Delete(l.Path, recursive: false);
            else if (loc is SshLoc s) RunSshWithRetry(s, c => c.DeleteDirectory(s.Remote), operationName: "rmdir");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Renci.SshNet.Common.SshException)
        {
            // Not empty (skipped conflicts, links) or not removable: leave it.
        }
    }

    /// <summary>File timestamps compare equal within this much (FAT stores 2-second steps, SFTP whole seconds).</summary>
    private const double SameMtimeToleranceSeconds = 2;

    private static bool SameMtime(LocInfo a, LocInfo b) =>
        Math.Abs((a.MtimeUtc - b.MtimeUtc).TotalSeconds) <= SameMtimeToleranceSeconds;

    private static bool ContentsEqual(FsLoc a, FsLoc b, CancellationToken ct)
    {
        for (int attempt = 1; ; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            var clientA = (a as SshLoc)?.Client;
            var clientB = (b as SshLoc)?.Client;
            try
            {
                using var sa = LocOpenRead(a);
                using var sb = LocOpenRead(b);
                var ba = new byte[1 << 18];
                var bb = new byte[1 << 18];
                while (true)
                {
                    ct.ThrowIfCancellationRequested();
                    int na = sa.ReadAtLeast(ba, ba.Length, throwOnEndOfStream: false);
                    int nb = sb.ReadAtLeast(bb, bb.Length, throwOnEndOfStream: false);
                    if (a is SshLoc ssa) SshManager.Touch(ssa.Id);
                    if (b is SshLoc ssb) SshManager.Touch(ssb.Id);
                    PreventSystemSleep();
                    if (na != nb) return false;
                    if (na == 0) return true;
                    if (!ba.AsSpan(0, na).SequenceEqual(bb.AsSpan(0, nb))) return false;
                }
            }
            catch (Exception ex) when ((a is SshLoc || b is SshLoc) && attempt <= MaxSshRetries && !ct.IsCancellationRequested && IsTransientSshError(ex))
            {
                RookLog.Warn("ssh",
                    $"Transient SSH error comparing \"{a.Name}\" (attempt {attempt}/{MaxSshRetries}): {ex.Message}; reconnecting...");
                WaitBeforeSshRetry(attempt, ct);
                if (a is SshLoc ssa) SshManager.ReconnectAsync(ssa.Id, clientA, ct).GetAwaiter().GetResult();
                if (b is SshLoc ssb && (a is not SshLoc ssa2 || !string.Equals(ssa2.Id, ssb.Id, StringComparison.OrdinalIgnoreCase)))
                    SshManager.ReconnectAsync(ssb.Id, clientB, ct).GetAwaiter().GetResult();
            }
        }
    }

    /// <summary>
    /// Same file already at the destination? Same size and date counts as identical (the usual
    /// sync quick check). Same size with another date is only identical after a full content
    /// compare, and only when the request asked for one.
    /// </summary>
    private static bool IsIdenticalFile(FsLoc src, LocInfo srcInfo, FsLoc dst, LocInfo dstInfo, TransferOptions opts)
    {
        if (srcInfo.Size != dstInfo.Size) return false;
        if (srcInfo.Size == 0 || SameMtime(srcInfo, dstInfo)) return true;
        if (!opts.VerifySameSize) return false;
        if (opts.Job != null) opts.Job.CurrentName = $"Comparing {src.Name}";
        return ContentsEqual(src, dst, opts.Ct);
    }

    /// <summary>Keeps the source's modified time on copies that go through a stream, so a later retry recognises the file.</summary>
    private static void TryCopyMtime(FsLoc dst, DateTime mtimeUtc)
    {
        if (mtimeUtc.Year < 1980) return;
        try
        {
            if (dst is LocalLoc l)
            {
                File.SetLastWriteTimeUtc(l.Path, mtimeUtc);
            }
            else if (dst is SshLoc s)
            {
                RunSshWithRetry(s, c =>
                {
                    var attrs = c.GetAttributes(s.Remote);
                    attrs.LastWriteTimeUtc = mtimeUtc;
                    c.SetAttributes(s.Remote, attrs);
                }, operationName: "setstat");
            }
        }
        catch (Exception)
        {
            // Cosmetic: the copy itself succeeded.
        }
    }

    private static void CountSkipped(TransferOptions opts, long bytes)
    {
        // Rename-style moves are never sized up by the scan, so there is no total to count against.
        if (opts.Job == null || opts.CanRename) return;
        Interlocked.Add(ref opts.Job.SkippedBytes, Math.Max(0, bytes));
        Interlocked.Increment(ref opts.Job.SkippedFiles);
    }

    /// <summary>
    /// Copies or moves one file or folder. An existing destination folder is merged into: each file
    /// is checked at its own relative path, identical files are skipped (and, for a move, removed
    /// from the source), and differing ones follow <see cref="TransferOptions.Policy"/>. A source
    /// file is only ever deleted after its content is safely at the destination.
    /// </summary>
    private static void TransferNode(FsLoc src, LocInfo srcInfo, FsLoc dst, LocInfo? dstInfo, TransferOptions opts)
    {
        opts.Ct.ThrowIfCancellationRequested();

        if (dstInfo == null && opts.CanRename)
        {
            LocRename(src, dst);
            return;
        }

        if (dstInfo is { } existing && existing.IsDir != srcInfo.IsDir)
        {
            // A file where a folder should go, or the reverse: never resolved by overwriting.
            if (opts.Policy != ConflictPolicy.Skip)
                throw new IOException($"\"{dst.Name}\" already exists as a {(existing.IsDir ? "folder" : "file")}.");
            opts.Skipped++;
            return;
        }

        if (srcInfo.IsDir)
        {
            if (dstInfo == null) LocMkdir(dst);
            var dstChildren = dstInfo == null ? new Dictionary<string, LocInfo>(NameComparer(dst)) : LocListByName(dst);
            // Directory links can loop or escape the tree: only plain local copies follow them.
            // A move never does, so it can't empty a folder that is merely linked from the source.
            bool followDirLinks = !opts.IsMove && src is LocalLoc && dst is LocalLoc;
            foreach (var (name, info) in LocList(src))
            {
                if (info.IsDir && info.IsLink && !followDirLinks) continue;
                LocInfo? childDst = dstChildren.TryGetValue(name, out var found) ? found : null;
                TransferNode(Child(src, name), info, Child(dst, name), childDst, opts);
            }
            if (opts.IsMove) TryRemoveEmptyDir(src);
            return;
        }

        if (dstInfo is { } dstFile)
        {
            if (IsIdenticalFile(src, srcInfo, dst, dstFile, opts))
            {
                CountSkipped(opts, srcInfo.Size);
                if (opts.IsMove) LocDeleteFile(src);
                return;
            }
            switch (opts.Policy)
            {
                case ConflictPolicy.Fail:
                    throw new IOException($"\"{dst.Name}\" already exists.");
                case ConflictPolicy.Skip:
                    opts.Skipped++;
                    CountSkipped(opts, srcInfo.Size);
                    return;
            }
            if (opts.CanRename)
            {
                LocDeleteFile(dst);
                LocRename(src, dst);
                return;
            }
        }

        CopyFileWithProgress(src, dst, opts.Ct, opts.Job);
        if (src is not LocalLoc || dst is not LocalLoc) TryCopyMtime(dst, srcInfo.MtimeUtc);
        if (opts.IsMove) LocDeleteFile(src);
    }

    private static bool BoolArg(JsonElement root, string name) =>
        root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.True;

    private static bool SameLocPath(FsLoc a, FsLoc b) =>
        string.Equals(a.Path, b.Path, a is LocalLoc ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    /// <summary>The <c>copy</c> and <c>move</c> actions, for local and SSH paths alike.</summary>
    private static async Task<IResult> HandleCopyMoveAsync(string action, JsonElement root, CancellationToken ct)
    {
        bool isMove = action == "move";
        if (BoolArg(root, "viaRemote")) return await HandleRemoteTransferAsync(isMove, root, ct);
        var src = await ResolveLocAsync(Str(root, "sourcePath")!, ct);
        var destDir = await ResolveLocAsync(Str(root, "destDir")!, ct);
        if (LocStat(src) is not { } srcInfo) return Results.Json(new { error = "Source not found" }, statusCode: 404);

        FsLoc dest;
        if (isMove)
        {
            dest = Child(destDir, src.Name);
            if (SameLocPath(dest, src)) return Results.Json(new { ok = true, path = dest.Path, skipped = 0, merged = false });
        }
        else
        {
            dest = UniqueCopyDestination(src, destDir);
        }
        if (srcInfo.IsDir && IsSameOrInside(dest, src))
            throw new IOException($"Cannot {action} a folder into itself.");

        var job = FindTransfer(root);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, job?.Cts.Token ?? CancellationToken.None);
        var opts = new TransferOptions
        {
            IsMove = isMove,
            CanRename = isMove && CanRenameBetween(src, dest),
            Policy = Str(root, "onConflict") switch
            {
                "replace" => ConflictPolicy.Replace,
                "skip" => ConflictPolicy.Skip,
                _ => ConflictPolicy.Fail,
            },
            VerifySameSize = BoolArg(root, "verifySameSize"),
            Job = job,
            Ct = linked.Token,
        };
        var dstInfo = LocStat(dest);
        try
        {
            TransferNode(src, srcInfo, dest, dstInfo, opts);
        }
        finally
        {
            if (src is SshLoc || dest is SshLoc) BumpDirVersion();
        }
        // merged: the destination was already there, so this item can't be undone as a unit.
        return Results.Json(new { ok = true, path = dest.Path, skipped = opts.Skipped, merged = dstInfo != null });
    }

    // ---- Conflict preview ----

    private sealed class TransferPlan
    {
        public const int MaxListed = 300;
        public readonly List<object> Conflicts = new();
        public int DifferentCount;
        public int SameSizeCount;
        public int IdenticalCount;
        public CancellationToken Ct;
    }

    private static void PlanNode(FsLoc src, LocInfo srcInfo, FsLoc dst, LocInfo? dstInfo, string relPath, bool followDirLinks, TransferPlan plan)
    {
        plan.Ct.ThrowIfCancellationRequested();
        if (dstInfo is not { } existing) return; // Nothing there yet: no conflict anywhere below.

        bool mismatch = existing.IsDir != srcInfo.IsDir;
        if (srcInfo.IsDir && !mismatch)
        {
            var dstChildren = LocListByName(dst);
            if (dstChildren.Count == 0) return;
            foreach (var (name, info) in LocList(src))
            {
                if (info.IsDir && info.IsLink && !followDirLinks) continue;
                if (!dstChildren.TryGetValue(name, out var childDst)) continue;
                PlanNode(Child(src, name), info, Child(dst, name), childDst, relPath + "/" + name, followDirLinks, plan);
            }
            return;
        }

        bool sameSize = !mismatch && srcInfo.Size == existing.Size;
        if (sameSize && (srcInfo.Size == 0 || SameMtime(srcInfo, existing)))
        {
            plan.IdenticalCount++;
            return;
        }
        if (sameSize) plan.SameSizeCount++;
        else plan.DifferentCount++;
        if (plan.Conflicts.Count < TransferPlan.MaxListed)
        {
            plan.Conflicts.Add(new
            {
                relPath,
                sameSize,
                typeMismatch = mismatch,
                sourceSize = srcInfo.Size,
                destSize = existing.Size,
                sourceModifiedMs = ToUnixMs(srcInfo.MtimeUtc),
                destModifiedMs = ToUnixMs(existing.MtimeUtc),
            });
        }
    }

    /// <summary>
    /// <c>transferPlan</c>: what a copy/move batch would run into at the destination, from metadata
    /// only. Lists files that differ; identical ones (same size and date) are just counted.
    /// </summary>
    private static async Task<IResult> HandleTransferPlanAsync(JsonElement root, CancellationToken ct)
    {
        bool isMove = Str(root, "kind") == "move";
        var destDir = await ResolveLocAsync(Str(root, "destDir") ?? "", ct);
        var plan = new TransferPlan { Ct = ct };
        foreach (var path in PathsArg(root))
        {
            var src = await ResolveLocAsync(path, ct);
            if (LocStat(src) is not { } srcInfo) continue;
            var dest = Child(destDir, src.Name);
            // Onto itself: a move is a no-op and a copy gets a "- Copy" name, so neither conflicts.
            if (SameLocPath(dest, src)) continue;
            bool followDirLinks = !isMove && src is LocalLoc && dest is LocalLoc;
            PlanNode(src, srcInfo, dest, LocStat(dest), src.Name, followDirLinks, plan);
        }
        return Results.Json(new
        {
            conflicts = plan.Conflicts,
            differentCount = plan.DifferentCount,
            sameSizeCount = plan.SameSizeCount,
            identicalCount = plan.IdenticalCount,
        });
    }

    // ---- File copy with progress ----

    private static void CopyFileWithProgress(FsLoc src, FsLoc dst, CancellationToken ct, TransferJob? job)
    {
        if (job != null) job.CurrentName = src.Name;

        if (src is LocalLoc ls && dst is LocalLoc ld)
        {
            CopyLocalFile(ls.Path, ld.Path, ct, job);
        }
        else
        {
            try
            {
                CopyStreamWithResume(src, dst, ct, job);
            }
            catch (OperationCanceledException)
            {
                // Don't leave a truncated file behind looking like a finished copy.
                try
                {
                    if (dst is LocalLoc l) File.Delete(l.Path);
                    else if (dst is SshLoc s) s.Client.DeleteFile(s.Remote);
                }
                catch (Exception)
                {
                    // Best effort.
                }
                throw;
            }
        }

        if (job != null) Interlocked.Increment(ref job.DoneFiles);
    }

    /// <summary>Failed attempts in a row (no new bytes landed in between) before a copy gives up.</summary>
    private const int MaxCopyRetries = 6;

    private static Stream LocOpenReadAt(FsLoc loc, long offset)
    {
        var stream = LocOpenRead(loc);
        try
        {
            if (offset > 0) stream.Seek(offset, SeekOrigin.Begin);
            return stream;
        }
        catch
        {
            stream.Dispose();
            throw;
        }
    }

    /// <summary>Offset 0 creates/truncates the file; anything else reopens the partial file and continues from there.</summary>
    private static Stream LocOpenWriteAt(FsLoc loc, long offset)
    {
        if (offset <= 0) return LocOpenWrite(loc);
        Stream stream = loc switch
        {
            LocalLoc l => new FileStream(l.Path, FileMode.Open, FileAccess.Write, FileShare.None, 1 << 16),
            SshLoc s => s.Client.Open(s.Remote, FileMode.Open, FileAccess.Write),
            _ => throw new NotSupportedException(),
        };
        try
        {
            stream.Seek(offset, SeekOrigin.Begin);
            return stream;
        }
        catch
        {
            stream.Dispose();
            throw;
        }
    }

    private static void TryReconnectSsh(FsLoc loc, SftpClient? failedClient, CancellationToken ct)
    {
        if (loc is not SshLoc s) return;
        try
        {
            SshManager.ReconnectAsync(s.Id, failedClient, ct).GetAwaiter().GetResult();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Host still unreachable: the next attempt fails fast and counts against the retry budget.
            RookLog.Warn("ssh", $"Reconnect to {s.Id} failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Stream copy for transfers with an SSH end. When the connection stalls or drops mid-file
    /// (SSH.NET operation timeout, socket reset, sleep/wake), it reconnects and carries on from the
    /// bytes that already reached the destination instead of failing the whole batch.
    /// </summary>
    private static void CopyStreamWithResume(FsLoc src, FsLoc dst, CancellationToken ct, TransferJob? job)
    {
        var buffer = new byte[1 << 16];
        long offset = 0;       // Bytes handed to the destination stream so far.
        long resumedFrom = 0;  // Where the previous attempt started.
        bool resume = false;
        int failures = 0;

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var srcClient = (src as SshLoc)?.Client;
            var dstClient = (dst as SshLoc)?.Client;
            try
            {
                if (resume)
                {
                    // Writes are buffered, so only what the destination reports is known to be there.
                    long atDest = dst switch
                    {
                        LocalLoc l => File.Exists(l.Path) ? new FileInfo(l.Path).Length : 0,
                        SshLoc s => RemoteStat(s.Client, s.Remote) is { IsDirectory: false } a ? a.Size : 0,
                        _ => 0,
                    };
                    long confirmed = Math.Min(offset, atDest);
                    if (job != null) Interlocked.Add(ref job.DoneBytes, confirmed - offset);
                    offset = confirmed;
                    if (confirmed > resumedFrom) failures = 0; // The last attempt made real progress.
                    resumedFrom = confirmed;
                    resume = false;
                }

                using var input = LocOpenReadAt(src, offset);
                using var output = LocOpenWriteAt(dst, offset);
                int read;
                while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    ct.ThrowIfCancellationRequested();
                    output.Write(buffer, 0, read);
                    offset += read;
                    if (job != null) Interlocked.Add(ref job.DoneBytes, read);
                    PreventSystemSleep();
                }
                output.Flush();
                return;
            }
            catch (Exception ex) when (failures < MaxCopyRetries && !ct.IsCancellationRequested && IsTransientSshError(ex))
            {
                failures++;
                resume = true;
                RookLog.Warn("ssh",
                    $"Transient SSH error copying \"{src.Name}\" at byte {offset} (attempt {failures}/{MaxCopyRetries}): {ex.Message}; reconnecting...");
                WaitBeforeSshRetry(failures, ct);
                TryReconnectSsh(src, srcClient, ct);
                TryReconnectSsh(dst, dstClient, ct);
            }
        }
    }

    [DllImport("kernel32.dll")]
    private static extern uint SetThreadExecutionState(uint esFlags);

    private static long _lastSleepResetTick;

    /// <summary>
    /// Resets Windows' idle-sleep timer (at most every 30 s). Called from transfer loops so the PC
    /// doesn't go to sleep in the middle of a long copy and kill the SSH session.
    /// </summary>
    private static void PreventSystemSleep()
    {
        const uint EsSystemRequired = 0x00000001;
        long now = Environment.TickCount64;
        long last = Interlocked.Read(ref _lastSleepResetTick);
        if (now - last < 30_000 && last != 0) return;
        if (Interlocked.CompareExchange(ref _lastSleepResetTick, now, last) == last) SetThreadExecutionState(EsSystemRequired);
    }

    private delegate uint CopyProgressRoutine(
        long totalFileSize, long totalBytesTransferred, long streamSize, long streamBytesTransferred,
        uint streamNumber, uint callbackReason, IntPtr sourceFile, IntPtr destinationFile, IntPtr data);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CopyFileExW(
        string existingFileName, string newFileName, CopyProgressRoutine? progressRoutine,
        IntPtr data, ref int cancel, uint copyFlags);

    private static string ExtendedLengthPath(string fullPath)
    {
        if (fullPath.Length < 248 || fullPath.StartsWith(@"\\?\", StringComparison.Ordinal)) return fullPath;
        return fullPath.StartsWith(@"\\", StringComparison.Ordinal) ? @"\\?\UNC\" + fullPath[2..] : @"\\?\" + fullPath;
    }

    /// <summary>
    /// Local copy through CopyFileEx: same result as File.Copy (attributes, timestamps, alternate
    /// streams), plus progress callbacks and cancellation. A cancelled copy removes its partial file.
    /// </summary>
    private static void CopyLocalFile(string source, string dest, CancellationToken ct, TransferJob? job)
    {
        if (job == null && !ct.CanBeCanceled)
        {
            File.Copy(source, dest, true);
            return;
        }

        const uint ProgressContinue = 0, ProgressCancel = 1;
        const int ErrorAccessDenied = 5, ErrorRequestAborted = 1235;

        long reported = 0;
        CopyProgressRoutine routine = (_, transferred, _, _, _, _, _, _, _) =>
        {
            if (job != null && transferred > reported)
            {
                Interlocked.Add(ref job.DoneBytes, transferred - reported);
                reported = transferred;
            }
            PreventSystemSleep();
            return ct.IsCancellationRequested ? ProgressCancel : ProgressContinue;
        };

        int cancel = 0;
        bool ok = CopyFileExW(ExtendedLengthPath(source), ExtendedLengthPath(dest), routine, IntPtr.Zero, ref cancel, 0);
        int error = Marshal.GetLastWin32Error();
        GC.KeepAlive(routine);
        if (ok) return;

        if (error == ErrorRequestAborted || ct.IsCancellationRequested) throw new OperationCanceledException(ct);
        var message = $"{new Win32Exception(error).Message} ({Path.GetFileName(source)})";
        if (error == ErrorAccessDenied) throw new UnauthorizedAccessException(message);
        throw new IOException(message);
    }
}
