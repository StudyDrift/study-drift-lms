import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.env.HUSKY === '0') process.exit(0)

const pkgJson = process.env.npm_package_json
if (!pkgJson) process.exit(0)

const pkgDir = dirname(pkgJson)

function findGitRoot(start) {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const gitRoot = findGitRoot(pkgDir)
if (!gitRoot) process.exit(0)

const huskyBin = join(pkgDir, 'node_modules', 'husky', 'bin.js')
if (!existsSync(huskyBin)) process.exit(0)

const hooksDir = relative(gitRoot, join(pkgDir, '.husky')).replaceAll('\\', '/')
if (hooksDir.includes('..')) {
  console.error('husky: hooks path must stay inside the git repository')
  process.exit(1)
}

const r = spawnSync(process.execPath, [huskyBin, hooksDir || '.husky'], {
  cwd: gitRoot,
  stdio: 'inherit',
})

process.exit(r.status === null ? 1 : r.status)
