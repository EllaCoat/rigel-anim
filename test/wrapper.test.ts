// Checks what scripts/test.ts reports for each kind of run. The fixtures are not named *.test.ts,
// so they only run when passed explicitly.
import { expect, test } from 'bun:test'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const TIMEOUT_MS = 30_000

async function runWrapper(fixture: string) {
	const proc = Bun.spawn([process.execPath, join(root, 'scripts', 'test.ts'), `./test/fixtures/${fixture}`], {
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	return { exitCode: await proc.exited, stdout, stderr }
}

test(
	'a passing run prints one summary line and exits 0',
	async () => {
		const result = await runWrapper('pass.ts')
		expect(result.exitCode).toBe(0)
		expect(result.stdout.trim()).toBe('Ran 1 test across 1 file: 1 pass, 0 fail')
		expect(result.stderr).toBe('')
	},
	TIMEOUT_MS,
)

test(
	'a failing run passes on the exit code and shows only the failing test, its values and location',
	async () => {
		const result = await runWrapper('mixed.ts')
		expect(result.exitCode).toBe(1)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('(fail) fails on purpose')
		expect(result.stderr).toContain('Expected: 3')
		expect(result.stderr).toContain('Received: 2')
		expect(result.stderr).toMatch(/mixed\.ts:9:\d+/)
		expect(result.stderr).not.toContain('(pass)')
		expect(result.stderr).not.toContain('output-from-a-test')
		expect(result.stderr).toContain('FAILED (bun test exit 1): Ran 2 tests across 1 file: 1 pass, 1 fail.')
	},
	TIMEOUT_MS,
)

test(
	'a file that throws while loading is a failure that shows the error',
	async () => {
		const result = await runWrapper('broken.ts')
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('fixture failed to load')
		expect(result.stderr).toContain('1 error(s)')
	},
	TIMEOUT_MS,
)

test(
	'a run without tests is a failure, not a success',
	async () => {
		const result = await runWrapper('empty.ts')
		expect(result.exitCode).toBe(1)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('NO TESTS EXECUTED')
	},
	TIMEOUT_MS,
)
