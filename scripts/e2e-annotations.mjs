#!/usr/bin/env node
// Print each Playwright test's status and annotations (measurements from spikes).
// Usage: pnpm e2e:annotations [playwright args...]   e.g. pnpm e2e:annotations isolation
import { spawnSync } from 'node:child_process'

const run = spawnSync('pnpm', ['exec', 'playwright', 'test', '--reporter=json', ...process.argv.slice(2)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
let report
try { report = JSON.parse(run.stdout) } catch { process.stderr.write(run.stderr || run.stdout); process.exit(1) }

// eslint-disable-next-line no-control-regex -- strips ANSI colour codes from Playwright messages
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const r = t.results.at(-1)
      if (!r) continue
      console.log(`${t.projectName.padEnd(9)}${r.status.padEnd(8)}${spec.file}: ${spec.title}`)
      const notes = r.annotations?.length ? r.annotations : t.annotations
      for (const a of notes ?? []) if (a.description) console.log(`           ${a.type}: ${a.description}`)
      for (const e of r.errors ?? []) console.log(`           error: ${strip(e.message ?? '').split('\n').slice(0, 12).join('\n           ')}`)
    }
  }
  for (const s of suite.suites ?? []) walk(s)
}
for (const s of report.suites) walk(s)
console.log(JSON.stringify(report.stats))
process.exit(report.stats.unexpected > 0 ? 1 : 0)
