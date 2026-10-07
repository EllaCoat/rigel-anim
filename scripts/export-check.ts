// Exports the synthetic rig (synthetic-rig.ts) from the development Blockbench and checks the data packs on
// a 1.20.4 server: they load without errors, the calls behave as designed, every tick of every animation
// leaves each bone at the pose Blockbench sampled, and two rigs warm one chunk per tick, by priority.
//
//   bun scripts/export-check.ts [--shots <dir>]
//
// Needs the plugin built and installed in the development Blockbench (`bun run build`,
// `bun scripts/dev-bb.ts install`; Blockbench is launched and stopped here when it is not running) and the
// benchmark server (`bun bench/run.ts setup`). The server loads a world of its own, made anew each run.
// With --shots, the packs, the model and a spec for `bun scripts/mc-shot.ts <dir>/spec.json` go to <dir>.
import { cpSync, existsSync, mkdirSync, mkdtempSync, promises, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SERVER_DIR, Server } from '../bench/mc'
import { compose, type Quat, type Vec3 } from '../src/bake/matrix'
import { uuidString } from '../src/export/datapack'
import { poseString } from '../src/export/frames'
import { boneScale } from '../src/export/item-model'
import type { RigSettings, RigSource } from '../src/export/types'
import { exportRig, type ExportFs } from '../src/export/write'
import { blockbenchRunning, devBlockbench, evaluate } from './devtools'
import { syntheticRig } from './synthetic-rig'

const WORLD_NAME = 'export-check'
const TOLERANCE = 2e-3
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const nodeFs: ExportFs = {
	existsSync,
	readdirSync: (p) => readdirSync(p),
	readFileSync: (p, e) => readFileSync(p, e),
	writeFileSync,
	mkdirSync: (p, o) => mkdirSync(p, o),
	promises: { rm: (p, o) => promises.rm(p, o) },
}

async function collectSynthetic(model: object): Promise<RigSource> {
	const launched = !(await blockbenchRunning())
	try {
		if (launched) devBlockbench('launch')
		const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'export-harness.ts')], target: 'browser', format: 'iife' })
		if (!build.success) throw new AggregateError(build.logs, 'harness build failed')
		await evaluate(`${await build.outputs[0]!.text()}\nreturn true`)
		await evaluate(`return await __rigelExport.open(${JSON.stringify(model)}, 'synthetic.bbmodel')`)
		const raw = await evaluate('return __rigelExport.collect()')
		return {
			bones: raw.bones,
			textures: raw.textures.map((t: { png: string }) => ({ ...t, png: Uint8Array.from(Buffer.from(t.png, 'base64')) })),
			rest: Float64Array.from(raw.rest),
			animations: raw.animations.map((a: { matrices: number[] }) => ({ ...a, matrices: Float64Array.from(a.matrices) })),
		}
	} finally {
		if (launched && (await blockbenchRunning())) devBlockbench('stop')
	}
}

// What the server should hold for a rig: renderable bones and their 12 values per animation frame.
function expectations(source: RigSource) {
	const renderable = source.bones.flatMap((b, i) => (b.cubes.length > 0 ? [{ index: i, k: boneScale(b) }] : []))
	const values = (m: Float64Array, frame: number) =>
		renderable.map(({ index, k }) => poseString(m, (frame * source.bones.length + index) * 16, k).split(',').map((v) => Number.parseFloat(v)))
	return { bones: renderable.length, rest: values(source.rest, 0), frame: (a: number, f: number) => values(source.animations[a]!.matrices, f) }
}

class Check {
	readonly failures: string[] = []
	constructor(private server: Server) {}

	expect(ok: boolean, message: string): void {
		if (!ok) this.failures.push(message)
	}

	async gametime(): Promise<number> {
		return Number((await this.server.run('time query gametime', /The time is (\d+)/))[1])
	}

	// Runs n ticks of a frozen server and waits until they have run.
	async step(n = 1): Promise<void> {
		const target = (await this.gametime()) + n
		this.server.send(`tick step ${n}`)
		for (let i = 0; i < 200; i++) {
			await sleep(25)
			if ((await this.gametime()) >= target) return
		}
		throw new Error(`tick step ${n} did not finish`)
	}

	async score(holder: string, objective: string): Promise<number | null> {
		const escaped = holder.replace(/[$.]/g, '\\$&')
		const m = await this.server.run(`scoreboard players get ${holder} ${objective}`, new RegExp(`(?:${escaped} has (-?\\d+) \\[|Can't get value of ${objective.replace('.', '\\.')} for ${escaped})`))
		return m[1] === undefined ? null : Number(m[1])
	}

	// 0 when the function ran `return fail`; 7 when it ended without returning. From the console (not a
	// silent source) 1.20.4 reports a failed function as a success with result 0, so the result is stored.
	async result(command: string): Promise<number> {
		this.server.send('scoreboard players set $Check Rigel.Temp 7')
		this.server.send(`execute store result score $Check Rigel.Temp run ${command}`)
		return (await this.score('$Check', 'Rigel.Temp')) ?? 7
	}

	async entity(uuid: string, path: string): Promise<string | null> {
		const m = await this.server.run(`data get entity ${uuid} ${path}`, /has the following entity data: (.*)$|No entity was found|Found no elements matching/)
		return m[1] ?? null
	}

	// The 12 values of the matrix Minecraft rebuilds from the bone's stored transformation.
	async matrix(uuid: string): Promise<number[] | null> {
		const nbt = await this.entity(uuid, 'transformation')
		if (!nbt) return null
		const list = (key: string) => [...new RegExp(`${key}: \\[([^\\]]*)\\]`).exec(nbt)![1]!.matchAll(/-?[\d.]+(?:E-?\d+)?/g)].map((x) => Number(x[0]))
		const m = compose(list('translation') as Vec3, list('left_rotation') as Quat, list('scale') as Vec3, list('right_rotation') as Quat)
		return [0, 1, 2].flatMap((r) => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!])
	}
}

const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const shotsAt = args.indexOf('--shots')
	const shots = shotsAt >= 0 ? resolve(args[shotsAt + 1] ?? '') : undefined

	const model = syntheticRig()
	const source = await collectSynthetic(model)
	// Priorities that exercise the order: 'once' first, 'squash' last.
	source.animations.forEach((a) => (a.priority = a.name === 'once' ? 'xhigh' : a.name === 'squash' ? 'low' : 'high'))
	const rigs: RigSettings[] = [
		{ rig: 'synthetic', id: 0x5e17e000, item: 'minecraft:white_dye', chunkLines: 20 },
		{ rig: 'twin', id: 0x7e1a0001, item: 'minecraft:white_dye', chunkLines: 20 },
	]

	const world = join(SERVER_DIR, WORLD_NAME)
	rmSync(world, { recursive: true, force: true })
	const resources = mkdtempSync(join(tmpdir(), 'rigel-export-check-'))
	const target = { datapacks: { fs: nodeFs, dir: join(world, 'datapacks') }, resourcePack: { fs: nodeFs, dir: resources } }
	for (const settings of rigs) await exportRig(target, source, settings)

	if (shots) {
		rmSync(shots, { recursive: true, force: true })
		mkdirSync(shots, { recursive: true })
		for (const pack of ['synthetic', 'rigel']) cpSync(join(world, 'datapacks', pack), join(shots, 'datapacks', pack), { recursive: true })
		cpSync(resources, join(shots, 'resources'), { recursive: true })
		writeFileSync(join(shots, 'synthetic.bbmodel'), JSON.stringify(model))
		writeFileSync(join(shots, 'spec.json'), JSON.stringify(shotSpec(), null, '\t'))
	}
	rmSync(resources, { recursive: true, force: true })

	const expected = expectations(source)
	const chunks = (rig: string, tier: string) => {
		const dir = join(world, 'datapacks', rig, 'data/rigel/functions', rig, 'warm', tier)
		return existsSync(dir) ? readdirSync(dir).length : 0
	}

	const server = await Server.start(WORLD_NAME)
	const check = new Check(server)
	const report: Record<string, unknown> = {}
	try {
		// Start-up lines (offline mode, the flat world's settings) are about the test server, not the packs;
		// the reload below loads every function again.
		const fromLoad = server.log.length
		server.send('tick freeze')
		await server.sync()
		const root = uuidString(rigs[0]!.id, 0)
		const bone = (b: number) => uuidString(rigs[0]!.id, b + 1)
		const self = '$Rigel.synthetic'

		// Warm-up: from a reload, one chunk per tick, xhigh before high before low, across both rigs. A
		// rig spawned before the reload keeps its pose while its frames are warmed.
		check.expect((await check.result('execute positioned 0.0 -60.0 0.0 rotated 0 0 run function rigel:synthetic/spawn')) !== 0, 'spawn failed')
		const before = await check.matrix(bone(0))
		server.send('reload')
		await server.sync()
		const remaining = async () => {
			const nbt = (await server.run('data get storage rigel:warm', /has the following contents: (.*)$|Storage rigel:warm has no/))[1] ?? ''
			let units = 0
			let head = ''
			for (const list of ['XHigh', 'High', 'Low']) {
				// Keys print in no fixed order.
				const entries = [...(new RegExp(`\\b${list}: \\[(.*?)\\]`).exec(nbt)?.[1] ?? '').matchAll(/\{[^}]*\}/g)].map(([e]) => ({
					rig: /Rig: "(\w+)"/.exec(e)![1]!,
					tier: /Tier: "(\w+)"/.exec(e)![1]!,
					chunk: Number(/Chunk: (\d+)/.exec(e)![1]),
				}))
				for (const { rig, tier, chunk } of entries) units += chunks(rig, tier) - chunk
				if (!head && entries.length > 0) head = list
			}
			return { units, head }
		}
		const total = rigs.reduce((n, r) => n + ['xhigh', 'high', 'low'].reduce((m, t) => m + chunks(r.rig, t), 0), 0)
		const heads: string[] = []
		let steps = 0
		let last = { units: total, head: 'XHigh' }
		for (; steps < total + 5; steps++) {
			await check.step()
			const now = await remaining()
			heads.push(now.head)
			check.expect(last.units - now.units === 1 || (now.units === 0 && last.units === 0), `warm step ${steps}: ${last.units} → ${now.units} units`)
			last = now
			if (now.units === 0) break
		}
		const order = heads.filter((h, i) => h && h !== heads[i - 1])
		check.expect(JSON.stringify(order) === JSON.stringify(['XHigh', 'High', 'Low'].filter((l) => heads.includes(l))), `warm order ${order.join(' → ')}`)
		check.expect(last.units === 0, `warm-up left ${last.units} chunks`)
		await check.step()
		check.expect((await check.score('$Rigel.Warm', 'Rigel.Warming')) === 0, 'warm flag still set')
		const after = await check.matrix(bone(0))
		check.expect(!!before && !!after && maxDiff(before, after) < 1e-6, 'warming changed a pose')
		report.warm = { chunks: total, steps: steps + 1 }

		server.send('data modify storage rigel:warm High append value {Rig:"missing",Tier:"high",Chunk:0}')
		server.send('scoreboard players set $Rigel.Warm Rigel.Warming 1')
		await check.step()
		check.expect((await remaining()).units === 0 && !(await server.run('data get storage rigel:warm High', /has the following contents: (.*)$/))[1]!.includes('missing'), 'a registration of a missing rig stayed')

		// Calls.
		check.expect((await check.result('function rigel:synthetic/spawn')) === 0, 'a second spawn did not fail')
		check.expect((await check.result('function rigel:synthetic/play {ID:99}')) === 0, 'play with an unknown ID did not fail')
		check.expect((await check.result('function rigel:synthetic/pause')) === 0, 'pause while stopped did not fail')
		check.expect((await check.result('function rigel:synthetic/restart')) === 0, 'restart while not paused did not fail')

		// Every tick of every animation.
		const animations: Record<string, number> = {}
		for (const [a, animation] of source.animations.entries()) {
			const n = animation.ticks
			const ticks = animation.loop === 'loop' ? 2 * n + 2 : n + 3
			let worst = 0
			server.send(`function rigel:synthetic/play {ID:${a}}`)
			// Expected frame after s steps: play writes f/0 and the first tick (same game time) keeps it.
			for (let s = 0; s <= ticks; s++) {
				if (s > 0) await check.step()
				const t = Math.max(0, s - 1)
				let want: number[][]
				if (animation.loop === 'loop') want = n === 0 ? expected.frame(a, 0) : expected.frame(a, t % n)
				else if (t <= n) want = expected.frame(a, t)
				else want = animation.loop === 'once' ? expected.rest : expected.frame(a, n)
				for (let b = 0; b < expected.bones; b++) {
					const got = await check.matrix(bone(b))
					const d = got ? maxDiff(got, want[b]!) : Infinity
					worst = Math.max(worst, d)
					if (d > TOLERANCE) check.failures.push(`${animation.name} step ${s} bone ${b}: off by ${d.toFixed(4)}`)
				}
			}
			const playing = await check.score(self, 'Rigel.Playing')
			check.expect(playing === (animation.loop === 'loop' ? 1 : 0), `${animation.name}: Rigel.Playing is ${playing} at the end`)
			animations[animation.name] = Number(worst.toPrecision(3))
			server.send('function rigel:synthetic/stop')
		}
		report.animations = animations

		// pause / restart / stop keep the pose; restart continues.
		server.send('function rigel:synthetic/play {ID:0}')
		await check.step(3)
		check.expect((await check.result('function rigel:synthetic/pause')) !== 0, 'pause failed')
		const paused = await check.matrix(bone(0))
		const frame = await check.score(self, 'Rigel.Frame')
		await check.step(2)
		check.expect(maxDiff((await check.matrix(bone(0)))!, paused!) < 1e-6 && (await check.score(self, 'Rigel.Frame')) === frame, 'pause did not hold the pose')
		check.expect((await check.result('function rigel:synthetic/restart')) !== 0, 'restart failed')
		await check.step()
		check.expect((await check.score(self, 'Rigel.Frame')) === frame! + 1, 'restart did not continue from the next frame')
		server.send('function rigel:synthetic/stop')
		await check.step()
		check.expect((await check.score(self, 'Rigel.Playing')) === 0, 'stop did not stop')
		check.expect((await check.result('function rigel:synthetic/restart')) === 0, 'restart after stop did not fail')

		// tp moves the root (the bones ride along) and turns every bone, pitch included.
		server.send('execute positioned 10.5 -60.0 3.25 rotated 90 30 run function rigel:synthetic/tp')
		await server.sync()
		check.expect((await check.entity(root, 'Pos'))?.replace(/d/g, '') === '[10.5, -60.0, 3.25]', 'tp did not move the root')
		check.expect((await check.entity(bone(2), 'Pos'))?.replace(/d/g, '') === '[10.5, -60.0, 3.25]', 'the bones did not follow the root')
		check.expect((await check.entity(bone(2), 'Rotation'))?.replace(/f/g, '') === '[90.0, 30.0]', 'tp did not turn the bones')

		// kill removes the rig; spawn works again and faces the caller.
		server.send('function rigel:synthetic/kill')
		await server.sync()
		check.expect((await check.entity(root, 'Pos')) === null && (await check.entity(bone(0), 'Pos')) === null, 'kill left entities')
		check.expect((await check.result('execute positioned 0.0 -60.0 0.0 rotated -45 -10 run function rigel:synthetic/spawn')) !== 0, 'spawn after kill failed')
		check.expect((await check.entity(bone(0), 'Rotation'))?.replace(/f/g, '') === '[-45.0, -10.0]', 'spawn did not face the caller')

		await server.sync()
		const problems = server.log.slice(fromLoad).filter((line) => /\/(ERROR|WARN)\]/.test(line))
		report.logProblems = problems
		check.expect(problems.length === 0, `${problems.length} ERROR/WARN lines in the server log`)
	} finally {
		writeFileSync(join(SERVER_DIR, `${WORLD_NAME}.log`), server.log.join('\n'))
		await server.stop()
	}
	report.failures = check.failures
	console.log(JSON.stringify(report, null, 1))
	if (check.failures.length > 0) process.exitCode = 1
}

// Rest pose and poses of each animation, from the front and from a corner, for mc-shot.
function shotSpec() {
	const views = [
		{ name: 'rest-front', eye: [0, 1.2, 3.5], yaw: 180, pitch: 10 },
		{ name: 'rest-corner', eye: [2.5, 2.5, 2.5], yaw: 135, pitch: 30 },
		{ name: 'curves-12', eye: [0, 1.2, 3.5], yaw: 180, pitch: 10, pose: { animation: 'curves', tick: 12 } },
		{ name: 'squash-10', eye: [2.5, 2.0, 2.5], yaw: 135, pitch: 20, pose: { animation: 'squash', tick: 10 } },
		{ name: 'eased-25', eye: [-2.5, 2.0, 2.5], yaw: 225, pitch: 20, pose: { animation: 'eased', tick: 25 } },
		{ name: 'once-15', eye: [3.5, 1.2, 0], yaw: 90, pitch: 10, pose: { animation: 'once', tick: 15 } },
	]
	return {
		origin: [0, -60, 0],
		rig: 'synthetic',
		datapacks: ['datapacks/synthetic', 'datapacks/rigel'],
		resourcePacks: ['resources'],
		setup: ['execute positioned 0.0 -60.0 0.0 rotated 0 0 run function rigel:synthetic/spawn'],
		views,
		model: 'synthetic.bbmodel',
	}
}

try {
	await main()
} catch (error) {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error)
	process.exitCode = 1
}
