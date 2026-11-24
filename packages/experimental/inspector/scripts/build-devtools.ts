/** Compile the fixed npm DevTools sources locally and publish the complete static frontend. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeWorkspaceDevServers } from './close-dev-servers.ts'
import { buildFrontend } from './devtools/vite.ts'
import { DEVTOOLS_NPM_VERSION, DEVTOOLS_SOURCE_REVISION } from './devtools/source.ts'

let pending: Promise<{ files: number; bytes: number }> | undefined

/**
 * Build lib/devtools without network access, retaining relative Worker and asset URLs.
 * @returns Published file count and bytes, excluding the distribution manifest.
 */
export function buildDevtools(): Promise<{ files: number; bytes: number }> {
  pending ??= compile().finally(() => { pending = undefined })
  return pending
}

async function compile(): Promise<{ files: number; bytes: number }> {
  const lib = fileURLToPath(new URL('../lib/', import.meta.url))
  await mkdir(lib, { recursive: true })
  const temporary = await mkdtemp(join(lib, 'devtools.build-'))
  try {
    await buildFrontend(temporary)
    const files: Array<{ path: string; bytes: number; sha256: string }> = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(join(temporary, directory), { withFileTypes: true })) {
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(path)
        else {
          const bytes = await readFile(join(temporary, path))
          files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        }
      }
    }
    await walk('')
    const bytes = files.reduce((total, file) => total + file.bytes, 0)
    await writeFile(join(temporary, 'resource-manifest.json'), `${JSON.stringify({
      source: 'chrome-devtools-frontend', version: DEVTOOLS_NPM_VERSION, revision: DEVTOOLS_SOURCE_REVISION,
      builder: 'vite',
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
    }, null, 2)}\n`)
    const output = join(lib, 'devtools')
    // Windows denies the rename below while a server serves the previous publish.
    for (const server of closeWorkspaceDevServers()) {
      console.log(`Closed dsh dev server (pid ${server.pid}) holding the previous DevTools publish: ${server.commandLine}`)
    }
    await replaceOutput(temporary, output)
    console.log(`DevTools npm ${DEVTOOLS_NPM_VERSION}: ${files.length} files, ${bytes} bytes`)
    return { files: files.length, bytes }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** Publish retries ride out handle release from the closed servers above and brief antivirus scans. */
const publishAttempts = 3
const publishRetryDelayMs = 500

/** Windows reports a directory held open by another process as EPERM (rename) or EBUSY (rmdir). */
function isPublishLockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EBUSY'
}

/**
 * Replace the published directory with the temporary build. Windows denies the
 * replacement while another process holds the previous publish open, so a
 * lock error retries briefly; any other failure, or the last attempt, reports
 * the directory that could not be replaced and the likely holder.
 * @param temporary - completed temporary build directory; the caller removes it on failure.
 * @param output - published directory to replace.
 */
async function replaceOutput(temporary: string, output: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(output, { recursive: true, force: true })
      await rename(temporary, output)
      return
    } catch (error) {
      if (attempt >= publishAttempts || !isPublishLockError(error)) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        throw new Error(
          `Cannot publish the DevTools build to ${output} (${detail}). A dsh web or desktop dev server may hold the directory open; close it and rerun the build.`,
          { cause: error },
        )
      }
      await new Promise((resolve) => { setTimeout(resolve, publishRetryDelayMs) })
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDevtools()
