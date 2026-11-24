/** Close workspace dsh dev servers that may hold the published DevTools assets open. */
import { spawnSync } from 'node:child_process'

/** One observed process row from the Windows process-table dump. */
export interface ProcessRow {
  pid: number
  ppid: number
  name: string
  commandLine: string
}

/**
 * The dsh CLI running a `web` or `desktop` server from a workspace checkout, in
 * source (`tsx`) or built (`lib`) form. TUI and headless CLI sessions do not
 * serve the published assets, so they stay alive.
 */
const devServerPattern = /(?:^|[\s"'\\/])apps[/\\]cli[/\\](?:src|lib)[/\\]bin\.(?:ts|js)["'\s]+(?:web|desktop)\b/

/** Bound a hung CIM provider, matching the run-gates process-table walk. */
const enumerationTimeout = 10_000

/**
 * Parse `pid ppid name commandLine` rows from the PowerShell process-table
 * projection; rows without a command line keep an empty one.
 * @param output - the raw dump text.
 * @returns the parsed rows in line order; blank and malformed lines are dropped.
 */
export function parseProcessRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of output.split('\n')) {
    const match = line.replace(/\r$/, '').match(/^(\d+)\t(\d+)\t([^\t]*)(?:\t(.*))?$/)
    if (match === null) continue
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), name: match[3] ?? '', commandLine: match[4] ?? '' })
  }
  return rows
}

/**
 * Select the dev servers that may hold the published assets: node processes
 * running the dsh CLI `web` or `desktop` server, excluding the current process
 * and its ancestors so a build invoked through a dsh session cannot terminate
 * its own host.
 * @param rows - observed process rows.
 * @param selfPid - pid of the calling process.
 * @returns the selected dev-server rows in table order.
 */
export function selectDevServers(rows: ProcessRow[], selfPid: number): ProcessRow[] {
  const parentOf = new Map(rows.map(row => [row.pid, row.ppid]))
  const excluded = new Set<number>([selfPid])
  for (let pid = selfPid; ; ) {
    const parent = parentOf.get(pid)
    if (parent === undefined || excluded.has(parent)) break
    excluded.add(parent)
    pid = parent
  }
  return rows.filter(row => row.name === 'node.exe' && !excluded.has(row.pid) && devServerPattern.test(row.commandLine))
}

/**
 * Close dsh `web`/`desktop` dev servers launched from a workspace checkout.
 * Windows denies renaming a directory while another process holds it open, and
 * a running server keeps serving the previously published assets from
 * `lib/devtools`. Termination uses `taskkill /T /F` like the run-gates abort
 * path; its nonzero exit for a pid that exited between enumeration and
 * termination is deliberately unchecked.
 * @param platform - the target platform; process enumeration is Windows-only.
 * @returns each closed server's pid and command line; empty when none matched,
 * when the process table is unavailable, and on non-Windows platforms.
 */
export function closeWorkspaceDevServers(platform: NodeJS.Platform = process.platform): ProcessRow[] {
  if (platform !== 'win32') return []
  const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)" }'
  const table = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: enumerationTimeout })
  if (table.error !== undefined) return []
  const servers = selectDevServers(parseProcessRows(table.stdout), process.pid)
  for (const server of servers) {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  }
  return servers
}
