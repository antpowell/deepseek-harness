/** Dev-server closure selects only workspace dsh `web`/`desktop` servers outside the build's own process ancestry. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeWorkspaceDevServers, parseProcessRows, selectDevServers } from '../scripts/close-dev-servers.ts'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))

interface Row { pid: number; ppid: number; name: string; commandLine: string }

function table(rows: Row[]): string {
  return rows.map(row => `${row.pid}\t${row.ppid}\t${row.name}\t${row.commandLine}`).join('\n') + '\n'
}

interface TableResult {
  pid: number
  output: string[]
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error?: Error
}

function tableResult(stdout: string): TableResult {
  return { pid: 4321, output: ['', stdout, '', ''], stdout, stderr: '', status: 0, signal: null }
}

const self: Row = { pid: 100, ppid: 90, name: 'node.exe', commandLine: 'node scripts/build.ts' }

describe('parseProcessRows', () => {
  it('parses tab-separated rows, strips carriage returns, and keeps empty command lines', () => {
    expect(parseProcessRows('500\t400\tnode.exe\tnode apps/cli/src/bin.ts web\r\n501\t400\tpowershell.exe\t\r\n\nmalformed\n'))
      .toEqual([
        { pid: 500, ppid: 400, name: 'node.exe', commandLine: 'node apps/cli/src/bin.ts web' },
        { pid: 501, ppid: 400, name: 'powershell.exe', commandLine: '' },
      ])
  })
})

describe('selectDevServers', () => {
  it('selects node dsh web/desktop servers and excludes everything else', () => {
    const rows: Row[] = [
      self,
      { pid: 90, ppid: 80, name: 'powershell.exe', commandLine: 'powershell -Command pnpm run build' },
      { pid: 500, ppid: 400, name: 'node.exe', commandLine: 'node --import tsx/esm apps/cli/src/bin.ts web --no-open' },
      { pid: 501, ppid: 400, name: 'node.exe', commandLine: 'node "C:\\repo\\apps\\cli\\lib\\bin.js" desktop' },
      { pid: 502, ppid: 400, name: 'node.exe', commandLine: 'node C:\\repo\\node_modules\\.pnpm\\tsdown@0.22.14\\node_modules\\tsdown\\dist\\run.mjs' },
      { pid: 503, ppid: 400, name: 'node.exe', commandLine: 'node --import tsx/esm apps/cli/src/bin.ts headless "task"' },
      { pid: 504, ppid: 400, name: 'node.exe', commandLine: 'node apps/cli/src/bin.ts webserver' },
      { pid: 505, ppid: 400, name: 'dsh.exe', commandLine: 'dsh web' },
    ]
    expect(selectDevServers(rows, self.pid).map(row => row.pid)).toEqual([500, 501])
  })

  it('excludes an ancestor even when it is a matching dev server', () => {
    const rows: Row[] = [
      self,
      { pid: 90, ppid: 80, name: 'powershell.exe', commandLine: 'powershell -Command pnpm dsh web' },
      { pid: 80, ppid: 70, name: 'node.exe', commandLine: 'node --import tsx/esm apps/cli/src/bin.ts web' },
      { pid: 70, ppid: 0, name: 'cmd.exe', commandLine: 'cmd.exe' },
      { pid: 500, ppid: 80, name: 'node.exe', commandLine: 'node --import tsx/esm apps/cli/src/bin.ts web' },
    ]
    expect(selectDevServers(rows, self.pid).map(row => row.pid)).toEqual([500])
  })
})

describe('closeWorkspaceDevServers', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  it('does nothing on non-Windows platforms', () => {
    expect(closeWorkspaceDevServers('linux')).toEqual([])
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  it('enumerates the process table and force-kills each selected server tree', () => {
    spawnSyncMock.mockReturnValue(tableResult(table([
      self,
      { pid: 500, ppid: 400, name: 'node.exe', commandLine: 'node --import tsx/esm apps/cli/src/bin.ts web --no-open' },
      { pid: 501, ppid: 400, name: 'node.exe', commandLine: 'node C:\\repo\\node_modules\\tsdown dist/run.mjs' },
    ])))
    const closed = closeWorkspaceDevServers('win32')
    expect(closed.map(row => row.pid)).toEqual([500])
    const calls = spawnSyncMock.mock.calls
    expect(calls.map(call => call[0])).toEqual(['powershell', 'taskkill'])
    expect(calls[1]?.[1]).toEqual(['/PID', '500', '/T', '/F'])
  })

  it('returns empty without terminating anything when the process table is unavailable', () => {
    spawnSyncMock.mockReturnValue({ ...tableResult(''), error: new Error('ETIMEDOUT') })
    expect(closeWorkspaceDevServers('win32')).toEqual([])
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })
})
