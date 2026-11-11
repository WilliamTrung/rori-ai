using System.Diagnostics;
using System.Reflection;

namespace Rori.Installer;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var installRoot = Path.GetDirectoryName(Environment.ProcessPath)
            ?? AppContext.BaseDirectory;

        var postInstall = Path.Combine(installRoot, "post-install.ps1");
        if (!File.Exists(postInstall))
            postInstall = Path.Combine(installRoot, "windows", "post-install.ps1");

        if (!File.Exists(postInstall))
        {
            Console.Error.WriteLine("post-install.ps1 not found next to RoriInstall.exe");
            return 2;
        }

        var bridge = GetArg(args, "--bridge-url");
        var apiKey = GetArg(args, "--api-key");
        var silent = args.Contains("--silent", StringComparer.OrdinalIgnoreCase);
        var skipBridge = args.Contains("--skip-bridge", StringComparer.OrdinalIgnoreCase);

        var psArgs = new List<string>
        {
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", postInstall,
            "-InstallRoot", installRoot,
        };
        if (!string.IsNullOrWhiteSpace(bridge))
        {
            psArgs.Add("-BridgeUrl");
            psArgs.Add(bridge);
        }
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            psArgs.Add("-ApiKey");
            psArgs.Add(apiKey);
        }
        if (silent) psArgs.Add("-Silent");
        if (skipBridge) psArgs.Add("-SkipBridge");

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false,
                WorkingDirectory = installRoot,
            };
            foreach (var a in psArgs)
                psi.ArgumentList.Add(a);
            using var process = Process.Start(psi);
            process?.WaitForExit();
            return process?.ExitCode ?? 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            if (!silent)
            {
                Console.WriteLine();
                Console.WriteLine("Press Enter to exit.");
                Console.ReadLine();
            }
            return 1;
        }
    }

    private static string? GetArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }
        return null;
    }
}
