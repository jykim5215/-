using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AudioBridge.Win;

public sealed record UpdateInfo(
    long VersionCode,
    string VersionName,
    Uri WindowsUrl,
    string WindowsSha256);

/// <summary>Checks and installs the rolling GitHub prerelease update for the portable EXE.</summary>
public static class UpdateService
{
    private const string LatestUrl =
        "https://github.com/jykim5215/-/releases/download/v1.0.0-build/latest.json";
    private const long MaxExecutableBytes = 250L * 1024 * 1024;
    private static readonly HttpClient Client = CreateClient();

    public static string CurrentVersionName =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";

    public static long CurrentVersionCode =>
        Math.Max(0, Assembly.GetExecutingAssembly().GetName().Version?.Build ?? 0);

    public static async Task<UpdateInfo?> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var requestUrl = new Uri($"{LatestUrl}?t={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}");
            using var response = await Client.GetAsync(requestUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            byte[] bytes = await ReadLimitedAsync(stream, 16 * 1024, cancellationToken);
            using var json = JsonDocument.Parse(bytes);
            var root = json.RootElement;
            long code = root.TryGetProperty("versionCode", out var codeValue) ? codeValue.GetInt64() : -1;
            string name = root.TryGetProperty("versionName", out var nameValue) ? nameValue.GetString() ?? "" : "";
            string urlText = root.TryGetProperty("windowsUrl", out var urlValue) ? urlValue.GetString() ?? "" : "";
            string hash = root.TryGetProperty("windowsSha256", out var hashValue) ? hashValue.GetString() ?? "" : "";

            if (code <= CurrentVersionCode || !TryValidateReleaseUri(urlText, out var url)) return null;
            if (!IsSha256(hash)) return null;
            return new UpdateInfo(code, string.IsNullOrWhiteSpace(name) ? code.ToString() : name, url!, hash.ToLowerInvariant());
        }
        catch
        {
            return null;
        }
    }

    public static async Task StageAndRestartAsync(
        UpdateInfo update,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        string currentExe = Environment.ProcessPath ??
            throw new InvalidOperationException("현재 실행 파일 경로를 확인하지 못했습니다.");
        EnsureInstallDirectoryWritable(currentExe);

        string stagedExe = Path.Combine(Path.GetTempPath(), $"AudioBridge-{update.VersionCode}.exe");
        using var response = await Client.GetAsync(update.WindowsUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        long total = response.Content.Headers.ContentLength ?? -1;
        if (total > MaxExecutableBytes)
            throw new InvalidOperationException("업데이트 파일이 허용 크기를 초과했습니다.");

        await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
        await using (var output = new FileStream(stagedExe, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024, true))
        using (var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
        {
            var buffer = new byte[64 * 1024];
            long done = 0;
            while (true)
            {
                int read = await input.ReadAsync(buffer, cancellationToken);
                if (read == 0) break;
                done += read;
                if (done > MaxExecutableBytes)
                    throw new InvalidOperationException("업데이트 파일이 허용 크기를 초과했습니다.");
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                sha.AppendData(buffer, 0, read);
                if (total > 0) progress?.Report((double)done / total);
            }
            await output.FlushAsync(cancellationToken);
            string actualHash = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant();
            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(actualHash),
                    Encoding.ASCII.GetBytes(update.WindowsSha256)))
            {
                File.Delete(stagedExe);
                throw new InvalidOperationException("업데이트 무결성 확인에 실패했습니다.");
            }
        }

        string script = Path.Combine(Path.GetTempPath(), $"AudioBridge-update-{Guid.NewGuid():N}.ps1");
        await File.WriteAllTextAsync(script, """
            param(
              [int]$TargetProcessId,
              [string]$Source,
              [string]$Destination
            )
            $ErrorActionPreference = 'Stop'
            Wait-Process -Id $TargetProcessId -Timeout 30 -ErrorAction SilentlyContinue
            $copied = $false
            for ($i = 0; $i -lt 20 -and -not $copied; $i++) {
              try {
                Copy-Item -LiteralPath $Source -Destination $Destination -Force
                $copied = $true
              } catch {
                Start-Sleep -Milliseconds 500
              }
            }
            if ($copied) {
              Start-Process -FilePath $Destination
              Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue
            }
            Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
            """, new UTF8Encoding(false), cancellationToken);

        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        start.ArgumentList.Add("-NoProfile");
        start.ArgumentList.Add("-NonInteractive");
        start.ArgumentList.Add("-ExecutionPolicy");
        start.ArgumentList.Add("Bypass");
        start.ArgumentList.Add("-File");
        start.ArgumentList.Add(script);
        start.ArgumentList.Add("-TargetProcessId");
        start.ArgumentList.Add(Environment.ProcessId.ToString());
        start.ArgumentList.Add("-Source");
        start.ArgumentList.Add(stagedExe);
        start.ArgumentList.Add("-Destination");
        start.ArgumentList.Add(currentExe);
        var process = Process.Start(start);
        if (process == null)
            throw new InvalidOperationException("업데이트 교체 프로세스를 시작하지 못했습니다.");
    }

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("AudioBridge-Windows-Updater/1.0");
        client.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue
        {
            NoCache = true,
            NoStore = true,
        };
        return client;
    }

    private static bool TryValidateReleaseUri(string value, out Uri? uri)
    {
        uri = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed)) return false;
        if (parsed.Scheme != Uri.UriSchemeHttps || !parsed.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase))
            return false;
        if (!parsed.AbsolutePath.StartsWith("/jykim5215/-/releases/download/", StringComparison.Ordinal))
            return false;
        uri = parsed;
        return true;
    }

    private static bool IsSha256(string value) =>
        value.Length == 64 && value.All(c => Uri.IsHexDigit(c));

    private static void EnsureInstallDirectoryWritable(string executable)
    {
        string directory = Path.GetDirectoryName(executable) ?? throw new InvalidOperationException("설치 폴더를 확인하지 못했습니다.");
        string probe = Path.Combine(directory, $".audiobridge-write-{Guid.NewGuid():N}");
        try
        {
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
        }
        catch
        {
            throw new InvalidOperationException("현재 폴더에 쓰기 권한이 없어 자동 업데이트할 수 없습니다. 사용자 폴더로 앱을 옮겨 다시 시도하세요.");
        }
    }

    private static async Task<byte[]> ReadLimitedAsync(Stream stream, int limit, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[4096];
        while (true)
        {
            int read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (output.Length + read > limit) throw new InvalidDataException("응답이 너무 큽니다.");
            output.Write(buffer, 0, read);
        }
        return output.ToArray();
    }
}
