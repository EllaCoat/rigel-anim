// Single entry point for the test suite. Prints a one-line summary on success and only the
// diagnostics of failing tests on failure; the complete output always goes to .test-logs/.
// Arguments are passed through to `bun test`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TIMEOUT_MS = 120_000
const MAX_PRINT = 12_000
const root = join(import.meta.dir, '..')
const logDir = join(root, '.test-logs')
mkdirSync(logDir, { recursive: true })
const logFile = join(logDir, `test-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)

const proc = Bun.spawn([process.execPath, 'test', ...process.argv.slice(2)], {
	cwd: root,
	stdout: 'pipe',
	stderr: 'pipe',
	env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
})
let timedOut = false
const timer = setTimeout(() => {
	timedOut = true
	proc.kill()
}, TIMEOUT_MS)
const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
const exitCode = await proc.exited
clearTimeout(timer)
writeFileSync(logFile, `${stdout}\n${stderr}`)
// bun test writes its report (results, errors, summary) to stderr and the tests' own console output
// to stdout. Only the report is counted and printed; both are kept in the log.
const report = stderr

function count(label: RegExp): number {
	return Number(new RegExp(`^\\s*(\\d+) ${label.source}$`, 'm').exec(report)?.[1] ?? 0)
}
const passed = count(/pass/)
const failed = count(/fail/)
const errors = count(/errors?/)
const ran = /^Ran \d+ tests? across \d+ files?/m.exec(report)?.[0] ?? 'Ran ? tests'
const summary = `${ran}: ${passed} pass, ${failed} fail${errors ? `, ${errors} error(s)` : ''}`

function diagnostics(): string {
	const text = report
		.split('\n')
		.filter((line) => !/^\s*\(pass\)/.test(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
	return text.length > MAX_PRINT ? `${text.slice(0, MAX_PRINT)}\n... (${text.length - MAX_PRINT} more characters in the log)` : text
}

if (timedOut || proc.signalCode) {
	console.error(`${diagnostics()}\n\nTIMEOUT or SIGNAL (${proc.signalCode ?? 'killed'}) after ${TIMEOUT_MS / 1000}s. Full log: ${logFile}`)
	process.exit(124)
}
// bun test exits 0 when the selected files contain no tests, so an empty run is reported as a failure here.
if (passed + failed === 0) {
	console.error(`${diagnostics()}\n\nNO TESTS EXECUTED (bun test exit ${exitCode}). Full log: ${logFile}`)
	process.exit(exitCode || 1)
}
if (exitCode === 0 && failed === 0) {
	console.log(summary)
	process.exit(0)
}
console.error(`${diagnostics()}\n\nFAILED (bun test exit ${exitCode}): ${summary}. Full log: ${logFile}`)
process.exit(exitCode || 1)
