using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace CrushExplorer;

/// <summary>
/// Feeds <see cref="FileActionLog"/> from the <c>/api/fs/{action}</c> endpoint: one entry per
/// file-mutating action (local or SSH), recording the action, the paths from the request and the outcome.
/// </summary>
public partial class Program
{
    private static readonly HashSet<string> FileMutatingActions = new(StringComparer.Ordinal)
    {
        "mkdir", "createFile", "rename", "delete", "copy", "move", "zipCompress", "zipExtract",
    };

    private static bool IsFileMutatingAction(string action) => FileMutatingActions.Contains(action);

    /// <summary>Logs a finished (or failed) mutating action. Never throws.</summary>
    private static void LogFileAction(string action, JsonElement root, IResult? result, Exception? error = null)
    {
        try
        {
            var sources = new List<string>();
            AddPaths(root, "path", sources);
            AddPaths(root, "paths", sources);
            AddPaths(root, "sourcePath", sources);
            AddPaths(root, "oldPath", sources);

            string? dir = Str(root, "dir"), name = Str(root, "name");
            if (!string.IsNullOrEmpty(dir) && !string.IsNullOrEmpty(name)) sources.Add(dir.TrimEnd('\\', '/') + "\\" + name);

            string? destination = Str(root, "destDir");
            var details = new List<string>();

            // The server-chosen result path (unique copy name, zip name, renamed path) is the real destination.
            var resultPath = ResultProperty(result, "path");
            if (action is "copy" or "move" or "rename" or "zipCompress" or "zipExtract" && !string.IsNullOrEmpty(resultPath))
                destination = resultPath;
            else if (action == "rename" && Str(root, "newName") is { Length: > 0 } newName)
                destination = newName;

            if (action == "delete")
                details.Add(BoolArg(root, "permanent") ? "permanent" : "recycle bin");
            if (action is "copy" or "move" && Str(root, "onConflict") is { Length: > 0 } policy)
                details.Add($"onConflict={policy}");

            if (error is OperationCanceledException) details.Add("CANCELLED");
            else if (error != null) details.Add("FAILED: " + error.Message);
            else if (result is IStatusCodeHttpResult { StatusCode: >= 400 } failed)
                details.Add($"FAILED ({failed.StatusCode}): {ResultProperty(result, "error") ?? "error"}");

            FileActionLog.Log(action, sources, destination, details.Count > 0 ? string.Join(", ", details) : null);
        }
        catch
        {
            // Auditing must never affect the response.
        }
    }

    private static void AddPaths(JsonElement root, string prop, List<string> into)
    {
        if (!root.TryGetProperty(prop, out var el)) return;
        if (el.ValueKind == JsonValueKind.String)
        {
            if (!string.IsNullOrWhiteSpace(el.GetString())) into.Add(el.GetString()!);
        }
        else if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in el.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString())) into.Add(item.GetString()!);
        }
    }

    /// <summary>Reads a string property off the anonymous object inside a <c>Results.Json</c> result.</summary>
    private static string? ResultProperty(IResult? result, string name)
    {
        if (result is not IValueHttpResult { Value: { } value }) return null;
        return value.GetType().GetProperty(name)?.GetValue(value) as string;
    }
}
