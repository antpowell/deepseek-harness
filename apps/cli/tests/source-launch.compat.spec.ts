import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { testProfileResolution } from './profiles/headless/tests/profile-resolution.ts'

/**
 * Keyless source-launch and profile-resolution checks through the production
 * tsx ESM-only entry. The Node compatibility matrix runs this file without a
 * build; source tool execution with native/generated dependencies belongs to
 * the build-backed source-tool suite.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshSourceBin = 'apps/cli/src/bin.ts'

describe('dsh SOURCE launcher (node --expose-internals --import tsx/esm)', () => {
  testProfileResolution('src')

  it('launches the source CLI without building', async () => {
    const rootPackage = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      readonly scripts?: Record<string, string>
    }
    expect(rootPackage.scripts?.dsh).toBe('node --expose-internals --import tsx/esm apps/cli/src/bin.ts')
  })

  it('uses exposed internals without loading the native addon', async () => {
    const resolverUrl = new URL('../../../packages/boot/app-boot/src/profile-resolution/resolver.ts', import.meta.url).href
    const probe = `
      import Module, { createRequire } from 'node:module'
      const require = createRequire(process.cwd() + '/probe.cjs')
      const addonId = require.resolve('node-addon-require-builtin')
      const addon = new Module(addonId)
      addon.filename = addonId
      addon.loaded = true
      addon.exports = { requireBuiltin: () => { throw new Error('native addon must not load') } }
      require.cache[addonId] = addon
      const { installRuntimeInterception } = await import(${JSON.stringify(resolverUrl)})
      const registration = installRuntimeInterception({
        profilesDir: '/profiles', profileDir: '/profiles/test', localPackageNames: [], linkedRoots: [], entries: [],
      })
      registration.dispose()
      console.log('exposed internals resolution passed')
    `
    const result = await execa(process.execPath, [
      '--expose-internals', '--import', 'tsx/esm', '--input-type=module', '--eval', probe,
    ], {
      cwd: repoRoot, timeout: 25_000, killSignal: 'SIGKILL', reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toBe('exposed internals resolution passed')
  }, 30_000)

  it('boots the source entry and requires a profile', async () => {
    const result = await execa(process.execPath, ['--expose-internals', '--import', 'tsx/esm', dshSourceBin], {
      cwd: repoRoot,
      input: '',
      timeout: 25_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    if (result.timedOut) {
      throw new Error(`dsh source launch did not exit within 25s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('--profile <name> is required')
    expect(result.stdout).toBe('')
  }, 30_000)
})
