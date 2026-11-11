using System.Collections.Concurrent;
using System.Text.Json;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace CrushExplorer;

/// <summary>
/// Saved SSH host. Hosts are added manually as "user@host" (optionally ":port") and
/// authenticate with the user's SSH private key (no passwords).
/// </summary>
public sealed class SshConnection
{
    public string Id { get; set; } = "";
    public string User { get; set; } = "";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 22;
    public string? Label { get; set; }
    /// <summary>Explicit private key path; null means try the default keys in ~/.ssh.</summary>
    public string? KeyPath { get; set; }
    /// <summary>SHA256 host key fingerprint pinned on first successful connect (trust on first use).</summary>
    public string? HostKeyFingerprint { get; set; }
    public long AddedAtMs { get; set; }
}

/// <summary>
/// Persists SSH connections under %LOCALAPPDATA%\Rook\ssh-connections.json and keeps a pool of
/// live SFTP clients, connected lazily and dropped after a period of inactivity.
/// Paths on SSH hosts are addressed as <c>ssh://{id}/absolute/remote/path</c>.
/// </summary>
public static class SshManager
{
    public const string PathScheme = "ssh://";

    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Rook",
        "ssh-connections.json"
    );

    private static readonly string[] DefaultKeyNames = { "id_ed25519", "id_ecdsa", "id_rsa" };
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan OperationTimeout = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(15);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private static readonly object StoreLock = new();
    private static List<SshConnection>? _connections;

    private sealed class PooledClient
    {
        public SftpClient? Client;
        public readonly SemaphoreSlim Gate = new(1, 1);
        public long LastUsedTicks = DateTime.UtcNow.Ticks;
        public int ActiveCount;
    }

    private sealed class UseScope : IDisposable
    {
        private PooledClient? _pooled;
        public UseScope(PooledClient pooled) => _pooled = pooled;
        public void Dispose()
        {
            var p = Interlocked.Exchange(ref _pooled, null);
            if (p != null)
            {
                Interlocked.Exchange(ref p.LastUsedTicks, DateTime.UtcNow.Ticks);
                Interlocked.Decrement(ref p.ActiveCount);
            }
        }
    }

    private static readonly ConcurrentDictionary<string, PooledClient> Pool = new(StringComparer.OrdinalIgnoreCase);
    private static System.Threading.Timer? _idleTimer;

    // ---- Persistence ----

    private static List<SshConnection> Load()
    {
        if (_connections != null) return _connections;
        try
        {
            if (File.Exists(StorePath))
            {
                _connections = JsonSerializer.Deserialize<List<SshConnection>>(File.ReadAllText(StorePath), JsonOpts);
            }
        }
        catch (Exception ex)
        {
            RookLog.Error("ssh", "Failed to read ssh-connections.json", ex);
        }
        _connections ??= new List<SshConnection>();
        return _connections;
    }

    private static void Save()
    {
        var dir = Path.GetDirectoryName(StorePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var tmp = StorePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(Load(), JsonOpts));
        File.Move(tmp, StorePath, overwrite: true);
    }

    public static List<SshConnection> List()
    {
        lock (StoreLock) return Load().Select(Clone).ToList();
    }

    public static SshConnection? Get(string id)
    {
        lock (StoreLock)
        {
            var c = Load().FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));
            return c == null ? null : Clone(c);
        }
    }

    private static SshConnection Clone(SshConnection c) => new()
    {
        Id = c.Id, User = c.User, Host = c.Host, Port = c.Port, Label = c.Label,
        KeyPath = c.KeyPath, HostKeyFingerprint = c.HostKeyFingerprint, AddedAtMs = c.AddedAtMs,
    };

    /// <summary>Parses "user@host" or "user@host:port" (also accepts a leading "ssh ").</summary>
    public static (string User, string Host, int Port) ParseTarget(string target)
    {
        var t = (target ?? "").Trim();
        if (t.StartsWith("ssh ", StringComparison.OrdinalIgnoreCase)) t = t[4..].Trim();
        var at = t.LastIndexOf('@');
        if (at <= 0 || at == t.Length - 1)
            throw new ArgumentException("Enter the connection as user@host (for example pi@192.168.1.20).");
        var user = t[..at];
        var hostPart = t[(at + 1)..];
        int port = 22;
        // Allow [ipv6]:port and host:port; a bare IPv6 address has several colons.
        if (hostPart.StartsWith('['))
        {
            var end = hostPart.IndexOf(']');
            if (end < 0) throw new ArgumentException("Invalid IPv6 host.");
            var rest = hostPart[(end + 1)..];
            hostPart = hostPart[1..end];
            if (rest.StartsWith(':') && !int.TryParse(rest[1..], out port))
                throw new ArgumentException("Invalid port.");
        }
        else if (hostPart.Count(ch => ch == ':') == 1)
        {
            var idx = hostPart.IndexOf(':');
            if (!int.TryParse(hostPart[(idx + 1)..], out port)) throw new ArgumentException("Invalid port.");
            hostPart = hostPart[..idx];
        }
        if (port is < 1 or > 65535) throw new ArgumentException("Port must be between 1 and 65535.");
        if (user.Any(char.IsWhiteSpace) || hostPart.Length == 0 || hostPart.Any(char.IsWhiteSpace))
            throw new ArgumentException("Enter the connection as user@host (for example pi@192.168.1.20).");
        return (user, hostPart, port);
    }

    public static SshConnection Add(string target, string? label, string? keyPath)
    {
        var (user, host, port) = ParseTarget(target);
        if (!string.IsNullOrWhiteSpace(keyPath))
        {
            keyPath = Environment.ExpandEnvironmentVariables(keyPath.Trim());
            if (!File.Exists(keyPath)) throw new FileNotFoundException($"Key file not found: {keyPath}");
        }
        else keyPath = null;

        lock (StoreLock)
        {
            var list = Load();
            var existing = list.FirstOrDefault(c =>
                string.Equals(c.User, user, StringComparison.Ordinal) &&
                string.Equals(c.Host, host, StringComparison.OrdinalIgnoreCase) &&
                c.Port == port);
            if (existing != null) throw new InvalidOperationException($"{user}@{host} is already added.");

            var conn = new SshConnection
            {
                Id = Guid.NewGuid().ToString("N")[..12],
                User = user,
                Host = host,
                Port = port,
                Label = string.IsNullOrWhiteSpace(label) ? null : label.Trim(),
                KeyPath = keyPath,
                AddedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            list.Add(conn);
            Save();
            return Clone(conn);
        }
    }

    public static bool Remove(string id)
    {
        Disconnect(id);
        lock (StoreLock)
        {
            var removed = Load().RemoveAll(c => string.Equals(c.Id, id, StringComparison.OrdinalIgnoreCase)) > 0;
            if (removed) Save();
            return removed;
        }
    }

    /// <summary>Forget the pinned host key, e.g. after the remote machine was reinstalled.</summary>
    public static void ResetHostKey(string id)
    {
        Disconnect(id);
        lock (StoreLock)
        {
            var c = Load().FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase))
                ?? throw new KeyNotFoundException("Unknown SSH connection.");
            c.HostKeyFingerprint = null;
            Save();
        }
    }

    private static void PinHostKey(string id, string fingerprint)
    {
        lock (StoreLock)
        {
            var c = Load().FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));
            if (c != null && c.HostKeyFingerprint == null)
            {
                c.HostKeyFingerprint = fingerprint;
                Save();
            }
        }
    }

    // ---- Connections ----

    private static List<IPrivateKeySource> LoadKeys(SshConnection conn)
    {
        var keys = new List<IPrivateKeySource>();
        var errors = new List<string>();
        IEnumerable<string> candidates;
        if (conn.KeyPath != null)
        {
            candidates = new[] { conn.KeyPath };
        }
        else
        {
            var sshDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh");
            candidates = DefaultKeyNames.Select(n => Path.Combine(sshDir, n)).Where(File.Exists);
        }
        foreach (var path in candidates)
        {
            try { keys.Add(new PrivateKeyFile(path)); }
            catch (Exception ex) { errors.Add($"{Path.GetFileName(path)}: {ex.Message}"); }
        }
        if (keys.Count == 0)
        {
            var detail = errors.Count > 0 ? " (" + string.Join("; ", errors) + ")" : "";
            throw new InvalidOperationException(
                "No usable SSH private key found. Add an unencrypted key to ~/.ssh (id_ed25519, id_ecdsa or id_rsa)" +
                " or set a key path for this connection" + detail + ".");
        }
        return keys;
    }

    private sealed class HostKeyCheck
    {
        public string? Seen;
        public bool Mismatch;
    }

    private static Renci.SshNet.ConnectionInfo BuildConnectionInfo(SshConnection conn)
    {
        var auth = new PrivateKeyAuthenticationMethod(conn.User, LoadKeys(conn).ToArray());
        return new Renci.SshNet.ConnectionInfo(conn.Host, conn.Port, conn.User, auth) { Timeout = ConnectTimeout };
    }

    private static void AttachHostKeyCheck(BaseClient client, SshConnection conn, HostKeyCheck check)
    {
        var pinned = conn.HostKeyFingerprint;
        client.HostKeyReceived += (_, e) =>
        {
            var fp = e.FingerPrintSHA256;
            check.Seen = fp;
            if (pinned == null)
            {
                // Trust on first use; the fingerprint is pinned once authentication succeeds.
                e.CanTrust = true;
            }
            else
            {
                e.CanTrust = string.Equals(pinned, fp, StringComparison.Ordinal);
                if (!e.CanTrust)
                {
                    check.Mismatch = true;
                    RookLog.Warn("ssh", $"Host key mismatch for {conn.User}@{conn.Host}:{conn.Port}",
                        $"expected {pinned}, got {fp}");
                }
            }
        };
    }

    private static SftpClient CreateClient(SshConnection conn, HostKeyCheck check)
    {
        var client = new SftpClient(BuildConnectionInfo(conn)) { OperationTimeout = OperationTimeout };
        client.KeepAliveInterval = KeepAliveInterval;
        AttachHostKeyCheck(client, conn, check);
        return client;
    }

    /// <summary>
    /// Opens a separate, unpooled session for running a command on the host (see Program.RemoteCopy.cs).
    /// Only hosts whose key is already pinned by an SFTP connection are accepted. The caller disposes it.
    /// </summary>
    public static async Task<SshClient> ConnectExecClientAsync(string id, CancellationToken ct)
    {
        var conn = Get(id) ?? throw new KeyNotFoundException("Unknown SSH connection.");
        if (conn.HostKeyFingerprint == null)
            throw new InvalidOperationException($"Browse {conn.Host} once before running commands on it.");
        var client = new SshClient(BuildConnectionInfo(conn)) { KeepAliveInterval = KeepAliveInterval };
        AttachHostKeyCheck(client, conn, new HostKeyCheck());
        try
        {
            await client.ConnectAsync(ct);
            return client;
        }
        catch (Exception ex)
        {
            try { client.Dispose(); } catch { }
            if (ex is OperationCanceledException) throw;
            throw new InvalidOperationException($"Could not open a command session on {conn.Host}: {ex.Message}", ex);
        }
    }

    /// <summary>Marks the pooled SSH connection as recently active so the idle timer does not close it.</summary>
    public static void Touch(string id)
    {
        if (Pool.TryGetValue(id, out var pooled))
        {
            Interlocked.Exchange(ref pooled.LastUsedTicks, DateTime.UtcNow.Ticks);
        }
    }

    /// <summary>
    /// Marks the connection as actively in use for the lifetime of the returned scope. While any
    /// scope is active, the idle timer will never disconnect the client.
    /// </summary>
    public static IDisposable BeginUse(string id)
    {
        var pooled = Pool.GetOrAdd(id, _ => new PooledClient());
        Interlocked.Increment(ref pooled.ActiveCount);
        Interlocked.Exchange(ref pooled.LastUsedTicks, DateTime.UtcNow.Ticks);
        return new UseScope(pooled);
    }

    public static SftpClient? TryGetConnectedClient(string id) =>
        Pool.TryGetValue(id, out var p) && p.Client is { IsConnected: true } c ? c : null;

    /// <summary>
    /// Returns a connected SFTP client for the connection, connecting (or reconnecting) if needed.
    /// </summary>
    public static Task<SftpClient> GetClientAsync(string id, CancellationToken ct = default) =>
        GetOrConnectClientAsync(id, failedClient: null, forceReconnect: false, ct);

    /// <summary>
    /// Forces a fresh SFTP connection when <paramref name="failedClient"/> timed out or dropped.
    /// If another caller already replaced <paramref name="failedClient"/> with a live session, reuses that.
    /// </summary>
    public static Task<SftpClient> ReconnectAsync(string id, SftpClient? failedClient, CancellationToken ct = default) =>
        GetOrConnectClientAsync(id, failedClient, forceReconnect: true, ct);

    private static async Task<SftpClient> GetOrConnectClientAsync(string id, SftpClient? failedClient, bool forceReconnect, CancellationToken ct)
    {
        var conn = Get(id) ?? throw new KeyNotFoundException("Unknown SSH connection.");
        var pooled = Pool.GetOrAdd(conn.Id, _ => new PooledClient());
        await pooled.Gate.WaitAsync(ct);
        try
        {
            Interlocked.Exchange(ref pooled.LastUsedTicks, DateTime.UtcNow.Ticks);
            if (pooled.Client is { IsConnected: true } existing &&
                (!forceReconnect || (failedClient != null && !ReferenceEquals(existing, failedClient))))
            {
                return existing;
            }

            DisposeQuietly(pooled.Client);
            pooled.Client = null;

            var check = new HostKeyCheck();
            var client = CreateClient(conn, check);
            try
            {
                await client.ConnectAsync(ct);
            }
            catch (Exception) when (check.Mismatch)
            {
                DisposeQuietly(client);
                throw new InvalidOperationException(
                    $"The host key for {conn.Host} has changed since it was first trusted. " +
                    "If the machine was reinstalled, reset its host key and connect again.");
            }
            catch (SshAuthenticationException)
            {
                DisposeQuietly(client);
                throw new InvalidOperationException(
                    $"{conn.User}@{conn.Host} rejected the SSH key. Make sure your public key is in the remote ~/.ssh/authorized_keys.");
            }
            catch (Exception ex) when (ex is System.Net.Sockets.SocketException or SshOperationTimeoutException or TimeoutException)
            {
                DisposeQuietly(client);
                throw new InvalidOperationException($"Could not reach {conn.Host}:{conn.Port}: {ex.Message}", ex);
            }
            catch
            {
                DisposeQuietly(client);
                throw;
            }

            if (conn.HostKeyFingerprint == null && check.Seen != null) PinHostKey(conn.Id, check.Seen);
            pooled.Client = client;
            Interlocked.Exchange(ref pooled.LastUsedTicks, DateTime.UtcNow.Ticks);
            RookLog.Info("ssh", $"{(forceReconnect ? "Reconnected" : "Connected")} to {conn.User}@{conn.Host}:{conn.Port}");
            EnsureIdleTimer();
            return client;
        }
        finally
        {
            pooled.Gate.Release();
        }
    }

    public static bool IsConnected(string id) =>
        Pool.TryGetValue(id, out var p) && p.Client is { IsConnected: true };

    public static void Disconnect(string id)
    {
        if (Pool.TryRemove(id, out var pooled))
        {
            DisposeQuietly(pooled.Client);
            pooled.Client = null;
        }
    }

    public static void DisconnectAll()
    {
        foreach (var id in Pool.Keys.ToList()) Disconnect(id);
    }

    private static void DisposeQuietly(SftpClient? client)
    {
        if (client == null) return;
        try { if (client.IsConnected) client.Disconnect(); } catch { }
        try { client.Dispose(); } catch { }
    }

    private static void EnsureIdleTimer()
    {
        if (_idleTimer != null) return;
        var timer = new System.Threading.Timer(_ =>
        {
            var cutoff = DateTime.UtcNow.Ticks - IdleTimeout.Ticks;
            foreach (var (id, pooled) in Pool)
            {
                if (Volatile.Read(ref pooled.ActiveCount) > 0) continue;
                if (Interlocked.Read(ref pooled.LastUsedTicks) < cutoff && pooled.Gate.Wait(0))
                {
                    try
                    {
                        if (Volatile.Read(ref pooled.ActiveCount) == 0 &&
                            Interlocked.Read(ref pooled.LastUsedTicks) < cutoff &&
                            pooled.Client != null)
                        {
                            DisposeQuietly(pooled.Client);
                            pooled.Client = null;
                            RookLog.Info("ssh", $"Closed idle SSH connection {id}");
                        }
                    }
                    finally { pooled.Gate.Release(); }
                }
            }
        }, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
        if (Interlocked.CompareExchange(ref _idleTimer, timer, null) != null) timer.Dispose();
    }

    // ---- Paths ----

    public static bool IsSshPath(string? path) =>
        path != null && path.StartsWith(PathScheme, StringComparison.OrdinalIgnoreCase);

    /// <summary>Splits "ssh://{id}/remote/path" into the connection id and an absolute POSIX path.</summary>
    public static (string Id, string RemotePath) ParsePath(string path)
    {
        if (!IsSshPath(path)) throw new ArgumentException("Not an SSH path.");
        var rest = path[PathScheme.Length..].Replace('\\', '/');
        var slash = rest.IndexOf('/');
        var id = slash < 0 ? rest : rest[..slash];
        var remote = slash < 0 ? "/" : rest[slash..];
        if (string.IsNullOrEmpty(id)) throw new ArgumentException("SSH path is missing a connection id.");
        return (id, NormalizeRemotePath(remote));
    }

    public static string BuildPath(string id, string remotePath) =>
        PathScheme + id + NormalizeRemotePath(remotePath);

    public static string NormalizeRemotePath(string remotePath)
    {
        var parts = new List<string>();
        foreach (var seg in remotePath.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (seg == ".") continue;
            if (seg == "..") { if (parts.Count > 0) parts.RemoveAt(parts.Count - 1); continue; }
            parts.Add(seg);
        }
        return "/" + string.Join('/', parts);
    }

    /// <summary>DTO shape returned to the frontend (camelCase via Results.Json).</summary>
    public static object ToDto(SshConnection c) => new
    {
        id = c.Id,
        user = c.User,
        host = c.Host,
        port = c.Port,
        label = c.Label,
        keyPath = c.KeyPath,
        target = c.Port == 22 ? $"{c.User}@{c.Host}" : $"{c.User}@{c.Host}:{c.Port}",
        rootPath = BuildPath(c.Id, "/"),
        hostKeyFingerprint = c.HostKeyFingerprint,
        connected = IsConnected(c.Id),
    };
}
