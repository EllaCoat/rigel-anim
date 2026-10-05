// Where the server thread spends its time: JFR execution samples taken with jcmd, with the obfuscated
// class and method names turned back into Mojang's names using the published server mappings.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { javaPath, MC_VERSION, SERVER_DIR } from './mc'
import { TARGET } from './target'

const MAPPINGS = join(SERVER_DIR, 'server-mappings.txt')

async function ensureMappings(): Promise<void> {
	if (!TARGET.obfuscated || existsSync(MAPPINGS)) return
	const manifest = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json()
	const version = await (await fetch(manifest.versions.find((v: { id: string }) => v.id === MC_VERSION).url)).json()
	const { url, sha1 } = version.downloads.server_mappings
	const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
	if (createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('server mappings: sha1 mismatch')
	writeFileSync(MAPPINGS, bytes)
}

// obfuscated "class.method" → Mojang "Class.method" (overloads that share an obfuscated name are joined).
function readMappings(): Map<string, string> {
	const methods = new Map<string, string>()
	if (!TARGET.obfuscated) return methods
	const classes = new Map<string, string>()
	let current: [string, string] | undefined
	for (const line of readFileSync(MAPPINGS, 'utf8').split('\n')) {
		if (line.startsWith('#') || !line.trim()) continue
		if (!line.startsWith(' ')) {
			const m = line.match(/^(\S+) -> (\S+):$/)
			if (m) {
				current = [m[1]!.replace(/^net\.minecraft\./, ''), m[2]!]
				classes.set(m[2]!, current[0])
			}
			continue
		}
		const m = current && line.match(/^\s+(?:\d+:\d+:)?\S+ ([\w$<>]+)\(.*\) -> ([\w$<>]+)$/)
		if (!m || !current) continue
		const key = `${current[1]}.${m[2]}`
		const name = `${current[0]}.${m[1]}`
		const prev = methods.get(key)
		methods.set(key, prev && !prev.split('|').includes(name) ? `${prev}|${m[1]}` : name)
	}
	for (const [obf, named] of classes) if (!methods.has(`${obf}.<init>`)) methods.set(`${obf}.<init>`, `${named}.<init>`)
	return methods
}

const jdkTool = (tool: string) => join(dirname(javaPath()), `${tool}.exe`)

export async function startRecording(pid: number, file: string): Promise<void> {
	await ensureMappings()
	const r = spawnSync(jdkTool('jcmd'), [String(pid), 'JFR.start', 'name=rbench', 'settings=profile', `filename=${file}`], { encoding: 'utf8' })
	if (r.status !== 0) throw new Error(`JFR.start failed: ${r.stdout}${r.stderr}`)
}

export function stopRecording(pid: number): void {
	const r = spawnSync(jdkTool('jcmd'), [String(pid), 'JFR.stop', 'name=rbench'], { encoding: 'utf8' })
	if (r.status !== 0) throw new Error(`JFR.stop failed: ${r.stdout}${r.stderr}`)
}

// Share of server-thread samples in which each method is on the stack (inclusive) and on top (self).
export function summarize(file: string, top = 25): string {
	const names = readMappings()
	const printed = spawnSync(jdkTool('jfr'), ['print', '--events', 'jdk.ExecutionSample', '--stack-depth', '96', file], { encoding: 'utf8', maxBuffer: 1 << 30 })
	if (printed.status !== 0) throw new Error(`jfr print failed: ${printed.stderr}`)
	const inclusive = new Map<string, number>()
	const self = new Map<string, number>()
	let samples = 0
	for (const event of printed.stdout.split('jdk.ExecutionSample {').slice(1)) {
		if (!event.includes('sampledThread = "Server thread"')) continue
		samples++
		const frames = [...event.matchAll(/^\s+([\w.$]+)\.([\w$<>]+)\(/gm)].map(([, cls, method]) => names.get(`${cls}.${method}`) ?? `${cls}.${method}`.replace(/^net\.minecraft\./, ''))
		if (frames[0]) self.set(frames[0], (self.get(frames[0]) ?? 0) + 1)
		for (const f of new Set(frames)) inclusive.set(f, (inclusive.get(f) ?? 0) + 1)
	}
	const rank = (m: Map<string, number>) =>
		[...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, n]) => `| ${name} | ${((n / samples) * 100).toFixed(1)}% |`).join('\n')
	return [
		`${samples} server-thread samples.`,
		'',
		'| inclusive | share |', '|---|---|', rank(inclusive),
		'',
		'| self | share |', '|---|---|', rank(self),
	].join('\n')
}
