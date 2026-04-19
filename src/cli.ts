import { Command } from 'commander';
import { Client } from './client.js';
import { NoStoredCredentials } from './errors.js';

export interface CliOptions {
  configDir?: string;
  browserOpener?: (url: string) => Promise<void>;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[], opts: CliOptions = {}): Promise<CliResult> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  // Honor MCPDCR_CONFIG_DIR / BROWSER env when not explicitly provided
  if (!opts.configDir && process.env.MCPDCR_CONFIG_DIR) {
    opts.configDir = process.env.MCPDCR_CONFIG_DIR;
  }
  if (!opts.browserOpener && process.env.BROWSER) {
    const browser = process.env.BROWSER;
    opts.browserOpener = async (url: string) => {
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        const parts = browser.split(/\s+/);
        const cmd = parts[0]!;
        const args = [...parts.slice(1), url];
        const child = spawn(cmd, args, { stdio: 'inherit' });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`browser exited ${code}`))));
        child.on('error', reject);
      });
    };
  }

  const program = new Command()
    .name('mcp-dcr-client')
    .description('MCP client with Dynamic Client Registration + OAuth 2.1 PKCE')
    .exitOverride();

  program
    .command('login <server>')
    .description('Authenticate with an MCP server (DCR + OAuth)')
    .action(async (server: string) => {
      try {
        await Client.connect(server, {
          configDir: opts.configDir,
          browserOpener: opts.browserOpener,
        });
        stdout += `✓ Logged in to ${server}\n`;
      } catch (e) {
        stderr += formatError(e, server);
        exitCode = 1;
      }
    });

  program
    .command('tools <server>')
    .description('List tools exposed by an authenticated MCP server')
    .action(async (server: string) => {
      try {
        const client = await Client.connect(server, {
          configDir: opts.configDir,
          browserOpener: credRequiredOpener(server),
        });
        const tools = await client.listTools();
        for (const t of tools) {
          stdout += `${t.name}${t.description ? ` — ${t.description}` : ''}\n`;
        }
      } catch (e) {
        stderr += formatError(e, server);
        exitCode = 1;
      }
    });

  program
    .command('call <server> <tool>')
    .description('Invoke a tool. Pass tool args as --key=value flags.')
    .allowUnknownOption(true)
    .action(async (server: string, tool: string, _opts, cmd: Command) => {
      try {
        const args: Record<string, unknown> = {};
        for (const raw of cmd.args.slice(2)) {
          const m = /^--([^=]+)=(.*)$/.exec(raw);
          if (!m) continue;
          const [, key, val] = m;
          args[key!] = parseValue(val!);
        }
        const client = await Client.connect(server, {
          configDir: opts.configDir,
          browserOpener: credRequiredOpener(server),
        });
        const result = await client.callTool(tool, args);
        stdout += `${result}\n`;
      } catch (e) {
        stderr += formatError(e, server);
        exitCode = 1;
      }
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (e && typeof e === 'object' && 'message' in e) {
      stderr += `${(e as Error).message}\n`;
    }
    exitCode = exitCode || 1;
  }

  return { exitCode, stdout, stderr };
}

/** Returns a browserOpener that throws NoStoredCredentials instead of opening a browser.
 * Used by tools/call so they fail fast when no login has been done yet. */
function credRequiredOpener(serverUrl: string): (url: string) => Promise<void> {
  return async (_url: string) => {
    throw new NoStoredCredentials(serverUrl);
  };
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function formatError(e: unknown, serverUrl: string): string {
  /* c8 ignore next 3 -- defensive guard for non-object throws; all app errors are Error instances */
  if (!e || typeof e !== 'object' || !('name' in e)) {
    return `✗ Unexpected error: ${String(e)}\n`;
  }
  const err = e as { name: string; message: string };
  switch (err.name) {
    case 'NoStoredCredentials':
      return (
        `✗ No stored credentials for ${new URL(serverUrl).host}\n` +
        `  Run: mcp-dcr-client login ${serverUrl}\n`
      );
    case 'RegistrationFailed':
      return `✗ ${err.message}\n  This client requires servers that support Dynamic Client Registration.\n`;
    case 'AuthorizationDenied':
      return `✗ ${err.message}\n  Re-run login if this was unintended.\n`;
    case 'RefreshFailed':
      return (
        `✗ ${err.message}\n` +
        `  Stored credentials have been cleared.\n` +
        `  Run: mcp-dcr-client login ${serverUrl}\n`
      );
    default:
      return `✗ ${err.name}: ${err.message}\n`;
  }
}

// Real-process entry point
/* c8 ignore start -- only runs when cli.ts is executed directly, not imported in tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((r) => {
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      process.exit(r.exitCode);
    })
    .catch((e) => {
      process.stderr.write(`Fatal: ${e?.message ?? e}\n`);
      process.exit(2);
    });
}
/* c8 ignore end */
