// Exports the synthetic rig (synthetic-rig.ts) from the development Blockbench and checks the data packs on
// a 1.20.4 server: they load without errors, the calls behave as designed, every tick of every animation
// leaves each bone at the pose Blockbench sampled and holds the variant its keyframes have applied by then,
// and two rigs warm one chunk per tick, by priority. A third,
// thinned rig (all animations but `eased`) is checked against its planned writes: each bone holds the end of its
// current run with the run's length, and pause, stop and restart set the values that hold and resume the client's
// interpolation.
//
//   bun scripts/export-check.ts [--shots <dir>]
//
// Needs the plugin built and installed in the development Blockbench (`bun run build`,
// `bun scripts/dev-bb.ts install`; Blockbench is launched and stopped here when it is not running) and the
// benchmark server (`bun bench/run.ts setup`). The server loads a world of its own, made anew each run.
// With --shots, the packs, the model and a spec for `bun scripts/mc-shot.ts <dir>/spec.json` go to <dir>.
import { cpSync, existsSync, mkdirSync, mkdtempSync, promises, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { SERVER_DIR, Server } from '../bench/mc'
import { compose, type Quat, type Vec3 } from '../src/bake/matrix'
import { uuidString } from '../src/export/datapack'
import { displayPoseString, planFrames, poseString, type FrameWrite } from '../src/export/frames'
import { toleranceOf, uniqueName } from '../src/export/build'
import { boneScale } from '../src/export/item-model'
import { animationRunEnds } from '../src/export/thin'
import { variantCalls, variantCuts } from '../src/export/variant-keys'
import type { AnimationSource, RigSettings, RigSource } from '../src/export/types'
import { exportRig, type ExportFs } from '../src/export/write'
import { blockbenchRunning, devBlockbench, evaluate, useFonts } from './devtools'
import { syntheticFontPack, syntheticRig } from './synthetic-rig'

const WORLD_NAME = 'export-check'
// tween calls whose commands are counted: the first frame, and the last of once and of eased, which writes every bone it moves on every frame.
const COST_CASES = [
	['curves', 0],
	['once', 21],
	['eased', 39],
] as const
const TOLERANCE = 2e-3
// Locators are written with 4 decimals, and ^ turns them with Minecraft's sine table (about 1e-4 per block).
const LOCATOR_TOLERANCE = 1e-3
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
		await useFonts()
		await evaluate(`return await __rigelExport.open(${JSON.stringify(model)}, 'synthetic.bbmodel')`)
		const raw = await evaluate('return __rigelExport.collect()')
		return {
			...raw,
			textures: raw.textures.map((t: { png: string }) => ({ ...t, png: Uint8Array.from(Buffer.from(t.png, 'base64')) })),
			rest: Float64Array.from(raw.rest),
			locatorRest: Float64Array.from(raw.locatorRest),
			animations: raw.animations.map((a: { matrices: number[]; locators: number[] }) => ({ ...a, matrices: Float64Array.from(a.matrices), locators: Float64Array.from(a.locators) })),
		}
	} finally {
		if (launched && (await blockbenchRunning())) devBlockbench('stop')
	}
}

// The entities riding the root, in order: bones with cubes and displays, each with its pose string.
function renderables(source: RigSource) {
	return source.bones.flatMap((b, i) => {
		if (b.display) return [{ index: i, display: b.display, pose: (m: ArrayLike<number>, at: number) => displayPoseString(m, at, b.display!.scale) }]
		if (b.cubes.length === 0) return []
		const k = boneScale(b)
		return [{ index: i, display: undefined, pose: (m: ArrayLike<number>, at: number) => poseString(m, at, k) }]
	})
}

// What the server should hold for a rig: renderable bones and their 12 values per animation frame, and the locators.
function expectations(source: RigSource) {
	const renderable = renderables(source)
	const values = (m: Float64Array, frame: number) => renderable.map(({ index, pose }) => pose(m, (frame * source.bones.length + index) * 16).split(',').map((v) => Number.parseFloat(v)))
	const count = source.locators.length
	const at = (p: Float64Array, frame: number) => source.locators.map((_, l) => [0, 1, 2].map((i) => p[(frame * count + l) * 3 + i]!))
	return {
		bones: renderable.length,
		rest: values(source.rest, 0),
		frame: (a: number, f: number) => values(source.animations[a]!.matrices, f),
		locators: (a: number, f: number) => at(source.animations[a]!.locators, f),
	}
}

// The variant each frame function of an animation applies, from its keyframes.
function variantPlan(source: RigSource, a: number): Map<number, string> {
	const animation = source.animations[a]!
	return variantCalls(animation.loop, animation.ticks, animation.variantKeys.flatMap((k) => (k.variant === null ? [] : [{ time: k.time, variant: k.variant }])))
}

// The entities and the CustomModelData a variant function of a rig writes.
function variantWrites(world: string, rig: string, name: string): { uuid: string; cmd: number }[] {
	return readFileSync(join(world, 'datapacks', rig, 'data/rigel/functions', rig, 'variant', `${name}.mcfunction`), 'utf8')
		.split('\n')
		.flatMap((l) => {
			const m = /^data merge entity (\S+) \{item:\{tag:\{CustomModelData:(\d+)\}\}\}$/.exec(l)
			return m ? [{ uuid: m[1]!, cmd: Number(m[2]) }] : []
		})
}

// The frame function the server runs on step s after play, if any: play writes f/0, the first step keeps it, then
// one frame per step, a loop going round from f/n to f/1, a 'once' animation ending with one more.
function frameAt(loop: AnimationSource['loop'], n: number, s: number): number | undefined {
	if (s === 0) return 0
	const t = s - 1
	if (t < 1) return undefined
	if (loop === 'loop') return n === 0 ? undefined : ((t - 1) % n) + 1
	return t <= n + (loop === 'once' ? 1 : 0) ? t : undefined
}

// The planned writes of each animation of a thinned rig, with the values each pose writes. rewritten: the bones
// (by index among the rig's entities) a variant function writes.
function thinnedPlans(source: RigSource, settings: RigSettings, rewritten: (variant: string) => ReadonlySet<number>) {
	const renderable = renderables(source)
	return source.animations.map((a, i) => {
		const poses = Array.from({ length: a.ticks + 1 }, (_, f) => renderable.map(({ index, pose }) => pose(a.matrices, (f * source.bones.length + index) * 16)))
		const tolerance = toleranceOf(a, settings)
		const calls = variantPlan(source, i)
		const ends = tolerance && animationRunEnds(a.loop, poses, tolerance, settings.span, variantCuts(calls, rewritten))
		const frames: FrameWrite[][] = planFrames(a.loop, poses, ends)
		const runs = frames.some((writes) => writes.some((w) => w.duration > 1))
		return { loop: a.loop, ticks: a.ticks, frames, runs, calls, ends, values: poses.map((frame) => frame.map((p) => p.split(',').map((v) => Number.parseFloat(v)))) }
	})
}

// The CustomModelData each model bone should hold after the variants applied so far.
class VariantState {
	private cmds: Record<string, number>
	constructor(
		base: Record<string, number>,
		private readonly writes: (variant: string) => { uuid: string; cmd: number }[],
	) {
		this.cmds = { ...base }
	}

	apply(variant: string | undefined): void {
		if (variant) for (const w of this.writes(variant)) this.cmds[w.uuid] = w.cmd
	}

	get want(): Readonly<Record<string, number>> {
		return this.cmds
	}
}

// What a bone of a thinned rig holds on the server.
interface Held {
	values: number[]
	duration: number
}

// What each bone of a rig holds on the server, kept by replaying the planned writes in the order the frames run.
class Replay {
	readonly held: Held[]
	readonly cooldown: number[]
	constructor(
		private readonly plans: ReturnType<typeof thinnedPlans>,
		rest: number[][],
	) {
		this.held = rest.map((values) => ({ values, duration: 1 }))
		this.cooldown = rest.map(() => 0)
	}

	apply(a: number, f: number): void {
		const plan = this.plans[a]!
		for (const w of plan.frames[f] ?? []) {
			this.held[w.bone] = { values: plan.values[w.pose]![w.bone]!, duration: plan.runs || f === 0 ? w.duration : this.held[w.bone]!.duration }
			if (f === 0) this.cooldown[w.bone] = 0
			else if (w.duration > 1) this.cooldown[w.bone] = f + w.duration - 1
		}
	}
}

class Check {
	readonly failures: string[] = []
	constructor(readonly server: Server) {}

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
		const m = await this.server.run(`data get entity ${uuid}${path ? ` ${path}` : ''}`, /has the following entity data: (.*)$|No entity was found|Found no elements matching/)
		return m[1] ?? null
	}

	// The 12 values of the matrix Minecraft rebuilds from the bone's stored transformation.
	async matrix(uuid: string): Promise<number[] | null> {
		const nbt = await this.entity(uuid, 'transformation')
		return nbt ? rebuilt(nbt) : null
	}

	// The matrix, interpolation length, PortalCooldown and shadow strength a bone holds.
	async display(uuid: string): Promise<{ matrix: number[]; duration: number; cooldown: number; shadow: number } | null> {
		const nbt = await this.entity(uuid, '')
		if (!nbt) return null
		const number = (key: string) => Number(new RegExp(`\\b${key}: (-?[\\d.]+(?:E-?\\d+)?)`).exec(nbt)![1])
		return { matrix: rebuilt(nbt), duration: number('interpolation_duration'), cooldown: number('PortalCooldown'), shadow: number('shadow_strength') }
	}

	// The CustomModelData of each entity, one query at a time: the console answers in order, and concurrent queries
	// would read each other's lines.
	async cmds(uuids: string[]): Promise<Record<string, number>> {
		const out: Record<string, number> = {}
		for (const uuid of uuids) out[uuid] = Number(await this.entity(uuid, 'item.tag.CustomModelData'))
		return out
	}

	async position(entity: string): Promise<number[] | null> {
		const pos = await this.entity(entity, 'Pos')
		return pos ? numbers(pos) : null
	}

	// x, y and z of rigel:<rig> Locators.<name>.
	async locator(rig: string, name: string): Promise<number[] | null> {
		const m = await this.server.run(`data get storage rigel:${rig} Locators.${name}`, /has the following contents: (.*)$|Found no elements matching/)
		if (!m[1]) return null
		return ['x', 'y', 'z'].map((k) => Number(new RegExp(`\\b${k}: (-?[\\d.]+(?:E-?\\d+)?)d`).exec(m[1]!)![1]))
	}
}

const numbers = (s: string) => [...s.matchAll(/-?[\d.]+(?:E-?\d+)?/g)].map((x) => Number(x[0]))
const DEGREE = Math.PI / 180

// Where ^x ^y ^z lands from an anchor facing yaw and pitch (LocalCoordinates.getPosition).
function local(anchor: number[], yaw: number, pitch: number, [x, y, z]: number[]): number[] {
	const ry = yaw * DEGREE
	const rx = pitch * DEGREE
	const left = [Math.cos(ry), 0, Math.sin(ry)]
	const up = [-Math.sin(ry) * Math.sin(rx), Math.cos(rx), Math.cos(ry) * Math.sin(rx)]
	const forward = [-Math.sin(ry) * Math.cos(rx), -Math.sin(rx), Math.cos(ry) * Math.cos(rx)]
	return [0, 1, 2].map((i) => anchor[i]! + x! * left[i]! + y! * up[i]! + z! * forward[i]!)
}

// The functions variant and at_locator are checked with.
function writeCheckPack(datapacks: string): void {
	const dir = join(datapacks, 'check')
	mkdirSync(join(dir, 'data/check/functions'), { recursive: true })
	writeFileSync(join(dir, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 26, description: 'export-check' } }))
	writeFileSync(join(dir, 'data/check/functions/applied.mcfunction'), 'scoreboard players add $Applied Rigel.Temp 1\n')
	writeFileSync(join(dir, 'data/check/functions/mark.mcfunction'), 'summon marker ~ ~ ~ {Tags:["check.mark"]}\n')
	// For screenshots: a small lit cube centred on the locator, and a burst of particles there.
	writeFileSync(
		join(dir, 'data/check/functions/shot_marker.mcfunction'),
		[
			'summon block_display ~ ~ ~ {Tags:["check.shot"],block_state:{Name:"minecraft:redstone_block"},brightness:{block:15,sky:15},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[-0.06f,-0.06f,-0.06f],scale:[0.12f,0.12f,0.12f]}}',
			'particle minecraft:dust 1 0.2 0.2 1.5 ~ ~ ~ 0.03 0.03 0.03 0 12 force',
			'',
		].join('\n'),
	)
}

function rebuilt(nbt: string): number[] {
	const list = (key: string) => [...new RegExp(`${key}: \\[([^\\]]*)\\]`).exec(nbt)![1]!.matchAll(/-?[\d.]+(?:E-?\d+)?/g)].map((x) => Number(x[0]))
	const m = compose(list('translation') as Vec3, list('left_rotation') as Quat, list('scale') as Vec3, list('right_rotation') as Quat)
	return [0, 1, 2].flatMap((r) => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!])
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
	source.animations.find((a) => a.name === 'eased')!.thin = 'off'
	const rigs: RigSettings[] = [
		{ rig: 'synthetic', id: 0x5e17e000, item: 'minecraft:white_dye', chunkLines: 20, span: 20, teleportDuration: 1 },
		{ rig: 'twin', id: 0x7e1a0001, item: 'minecraft:white_dye', chunkLines: 20, span: 20, teleportDuration: 1 },
		{ rig: 'thinned', id: 0x7e1a0002, item: 'minecraft:white_dye', chunkLines: 20, span: 20, teleportDuration: 1, thin: { position: 0.01, rotation: 1 } },
	]

	const world = join(SERVER_DIR, WORLD_NAME)
	rmSync(world, { recursive: true, force: true })
	const resources = mkdtempSync(join(tmpdir(), 'rigel-export-check-'))
	const target = { datapacks: { fs: nodeFs, dir: join(world, 'datapacks') }, resourcePack: { fs: nodeFs, dir: resources } }
	for (const settings of rigs) await exportRig(target, source, settings)
	writeCheckPack(join(world, 'datapacks'))
	// debug function takes no arguments, so each counted tween call gets a function of its own.
	for (const { rig } of [rigs[0]!, rigs[2]!])
		for (const [name, frame] of COST_CASES)
			writeFileSync(join(world, 'datapacks/check/data/check/functions', `cost_${rig}_${name}.mcfunction`), `function rigel:${rig}/tween {ID:${source.animations.findIndex((a) => a.name === name)},ticks:5,frame:${frame}}\n`)

	if (shots) {
		rmSync(shots, { recursive: true, force: true })
		mkdirSync(shots, { recursive: true })
		for (const pack of ['synthetic', 'thinned', 'rigel', 'check']) cpSync(join(world, 'datapacks', pack), join(shots, 'datapacks', pack), { recursive: true })
		cpSync(resources, join(shots, 'resources'), { recursive: true })
		for (const [path, content] of Object.entries(syntheticFontPack())) {
			mkdirSync(dirname(join(shots, 'font', path)), { recursive: true })
			writeFileSync(join(shots, 'font', path), content)
		}
		writeFileSync(join(shots, 'synthetic.bbmodel'), JSON.stringify(model))
		writeFileSync(join(shots, 'spec.json'), JSON.stringify(shotSpec(), null, '\t'))
		writeFileSync(join(shots, 'spec-tween.json'), JSON.stringify(tweenShotSpec(), null, '\t'))
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
	// What synthetic-rig.ts builds, so that a part collect loses fails here instead of leaving its checks nothing to check.
	const displays = source.bones.flatMap((b) => (b.display ? [`${b.name}:${b.display.kind}`] : [])).sort()
	check.expect(displays.join() === 'ice:block,label:text,note:text,sword:item', `collect gave the displays ${displays.join()}`)
	const locators = source.locators.map((l) => `${l.name}${l.entity ? ' with an entity' : ''}`).sort()
	check.expect(locators.join() === 'mark with an entity,tip', `collect gave the locators ${locators.join()}`)
	check.expect(source.variants.map((v) => `${v.name}:${v.textures.length}:${v.excluded.length}`).join() === 'alt:1:1,tip:1:5', 'collect lost a variant, its textures or its excluded bones')
	// The frames each animation applies a variant at: a keyframe on a tick of its own, the later of two on one tick, one on
	// the last tick of a loop (which counts as tick 0, applied again on the last tick), and one on the last tick of the others.
	const wantCalls: Record<string, string> = {
		curves: '0:alt,10:tip,20:default,30:alt',
		squash: '0:default,10:alt,20:default',
		hide: '5:alt,10:default,20:alt',
		eased: '',
		once: '10:tip,21:alt',
	}
	for (const [a, animation] of source.animations.entries()) {
		const got = [...variantPlan(source, a)].sort((x, y) => x[0] - y[0]).map(([frame, variant]) => `${frame}:${variant}`).join()
		check.expect(got === wantCalls[animation.name], `animation ${animation.name} applies variants at ${got}, expected ${wantCalls[animation.name]}`)
	}
	try {
		// Start-up lines (offline mode, the flat world's settings) are about the test server, not the packs;
		// the reload below loads every function again.
		const fromLoad = server.log.length
		server.send('tick freeze')
		await server.sync()
		const root = uuidString(rigs[0]!.id, 0)
		const bone = (b: number) => uuidString(rigs[0]!.id, b + 1)
		const locatorEntity = (l: number) => uuidString(rigs[0]!.id, expected.bones + 1 + l)
		const locatorNames = (() => {
			const taken = new Set<string>()
			for (const b of source.bones) if (b.display) uniqueName(b.name, taken)
			return source.locators.map((l) => uniqueName(l.name, taken))
		})()
		const restLocators = source.locators.map((_, l) => [0, 1, 2].map((i) => source.locatorRest[l * 3 + i]!))
		// The rig faces yaw 0, pitch 0 here, so ^x ^y ^z is x, y and z from the root.
		const spawnedAt = [0, -60, 0]
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
		const models = renderables(source).flatMap((r, i) => (r.display ? [] : [bone(i)]))
		const base = await check.cmds(models)
		const writesOf = (name: string) => variantWrites(world, 'synthetic', name)
		for (const [a, animation] of source.animations.entries()) {
			const n = animation.ticks
			const ticks = animation.loop === 'loop' ? 2 * n + 2 : n + 3
			let worst = 0
			// Variants stay applied after an animation, so each one starts from the original models.
			server.send('function rigel:synthetic/variant/default')
			await server.sync()
			const variants = new VariantState(base, writesOf)
			const calls = variantPlan(source, a)
			server.send(`function rigel:synthetic/play {ID:${a}}`)
			// Expected frame after s steps: play writes f/0 and the first tick (same game time) keeps it.
			for (let s = 0; s <= ticks; s++) {
				if (s > 0) await check.step()
				const called = frameAt(animation.loop, n, s)
				if (called !== undefined) variants.apply(calls.get(called))
				const held = await check.cmds(models)
				for (const uuid of models) if (held[uuid] !== variants.want[uuid]) check.failures.push(`${animation.name} step ${s}: ${uuid} holds model ${held[uuid]}, expected ${variants.want[uuid]}`)
				const t = Math.max(0, s - 1)
				let want: number[][]
				let wantLocators: number[][]
				if (animation.loop === 'loop') [want, wantLocators] = n === 0 ? [expected.frame(a, 0), expected.locators(a, 0)] : [expected.frame(a, t % n), expected.locators(a, t % n)]
				else if (t <= n) [want, wantLocators] = [expected.frame(a, t), expected.locators(a, t)]
				else [want, wantLocators] = animation.loop === 'once' ? [expected.rest, restLocators] : [expected.frame(a, n), expected.locators(a, n)]
				for (let b = 0; b < expected.bones; b++) {
					const got = await check.matrix(bone(b))
					const d = got ? maxDiff(got, want[b]!) : Infinity
					worst = Math.max(worst, d)
					if (d > TOLERANCE) check.failures.push(`${animation.name} step ${s} bone ${b}: off by ${d.toFixed(4)}`)
				}
				for (const [l, locator] of source.locators.entries()) {
					const got = await check.locator('synthetic', locatorNames[l]!)
					const d = got ? maxDiff(got, wantLocators[l]!) : Infinity
					if (d > LOCATOR_TOLERANCE) check.failures.push(`${animation.name} step ${s} locator ${locatorNames[l]}: storage off by ${d.toFixed(4)}`)
					if (!locator.entity) continue
					const pos = await check.position(locatorEntity(l))
					const e = pos ? maxDiff(pos, local(spawnedAt, 0, 0, wantLocators[l]!)) : Infinity
					if (e > LOCATOR_TOLERANCE) check.failures.push(`${animation.name} step ${s} locator ${locatorNames[l]}: entity off by ${e.toFixed(4)}`)
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

		report.variant = await checkVariant(check, source, world, bone)
		report.displays = await checkDisplays(check, source, bone)

		report.thinned = await checkThinned(check, source, rigs[2]!, world)
		report.tween = { thinned: await checkTween(check, source, rigs[2]!, world, '4.0 -60.0 0.0'), full: await checkTween(check, source, rigs[0]!, world, '0.0 -60.0 0.0') }
		check.server.send('function rigel:thinned/kill')

		// tp moves the root (the bones ride along) and turns every bone, pitch included.
		server.send('execute positioned 10.5 -60.0 3.25 rotated 90 30 run function rigel:synthetic/tp')
		await server.sync()
		check.expect((await check.entity(root, 'Pos'))?.replace(/d/g, '') === '[10.5, -60.0, 3.25]', 'tp did not move the root')
		check.expect((await check.entity(bone(2), 'Pos'))?.replace(/d/g, '') === '[10.5, -60.0, 3.25]', 'the bones did not follow the root')
		check.expect((await check.entity(bone(2), 'Rotation'))?.replace(/f/g, '') === '[90.0, 30.0]', 'tp did not turn the bones')

		const durations = async () => Promise.all([root, bone(0), bone(2)].map((e) => check.entity(e, 'teleport_duration')))
		check.expect((await durations()).join() === '1,1,1', `spawn wrote teleport_duration ${(await durations()).join()}, not 1`)
		check.expect((await check.result('function rigel:synthetic/teleport_duration {duration:5}')) !== 0, 'teleport_duration failed')
		check.expect((await durations()).join() === '5,5,5', `teleport_duration {duration:5} left ${(await durations()).join()}`)

		// Locator entities ride nothing: tp places them again, turned with the rig. at_locator runs at the locator.
		const movedTo = [10.5, -60, 3.25]
		const at = (l: number) => async () => local(movedTo, 90, 30, (await check.locator('synthetic', locatorNames[l]!))!)
		const locatorReport: Record<string, number> = {}
		for (const [l, locator] of source.locators.entries()) {
			const want = await at(l)()
			if (locator.entity) {
				const pos = await check.position(locatorEntity(l))
				locatorReport[`${locatorNames[l]} entity after tp`] = pos ? maxDiff(pos, want) : Infinity
			}
			server.send(`function rigel:synthetic/at_locator/${locatorNames[l]} {function:"check:mark"}`)
			await server.sync()
			const marked = await check.position('@e[type=marker,tag=check.mark,limit=1]')
			locatorReport[`${locatorNames[l]} at_locator`] = marked ? maxDiff(marked, want) : Infinity
			server.send('kill @e[type=marker,tag=check.mark]')
		}
		for (const [label, d] of Object.entries(locatorReport)) check.expect(d <= LOCATOR_TOLERANCE, `${label} off by ${d}`)
		report.locators = locatorReport

		// kill removes the rig; spawn works again and faces the caller.
		server.send('function rigel:synthetic/kill')
		await server.sync()
		check.expect((await check.entity(root, 'Pos')) === null && (await check.entity(bone(0), 'Pos')) === null, 'kill left entities')
		for (const [l, locator] of source.locators.entries()) if (locator.entity) check.expect((await check.entity(locatorEntity(l), 'Pos')) === null, `kill left locator ${locatorNames[l]}`)
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

// Applies each variant and default: every bone a variant function writes holds that CustomModelData, the others keep
// theirs, and the variant's function runs.
async function checkVariant(check: Check, source: RigSource, world: string, bone: (b: number) => string) {
	const writes = (name: string) => variantWrites(world, 'synthetic', name)
	const models = renderables(source).flatMap((r, i) => (r.display ? [] : [bone(i)]))
	const cmds = () => check.cmds(models)
	// The animations leave the variant of their last keyframe applied.
	check.server.send('function rigel:synthetic/variant/default')
	await check.server.sync()
	const base = await cmds()
	const report: Record<string, number> = {}
	for (const v of [...source.variants.map((v) => v.name), 'default']) {
		const planned = writes(v)
		const applied = (await check.score('$Applied', 'Rigel.Temp')) ?? 0
		const before = await cmds()
		check.server.send(`function rigel:synthetic/variant/${v}`)
		await check.server.sync()
		const after = await cmds()
		for (const uuid of models) {
			const want = planned.find((w) => w.uuid === uuid)?.cmd ?? before[uuid]
			check.expect(after[uuid] === want, `variant ${v}: ${uuid} holds ${after[uuid]}, expected ${want}`)
		}
		const onApply = source.variants.find((x) => x.name === v)?.onApply
		if (onApply) check.expect(((await check.score('$Applied', 'Rigel.Temp')) ?? 0) === applied + 1, `variant ${v}: ${onApply} did not run`)
		// A variant writes the bones it does not exclude that some variant changes (every bone with a model here), and default all of them.
		const excludedCount = (source.variants.find((x) => x.name === v)?.excluded ?? []).filter((index) => renderables(source).some((r) => r.index === index && !r.display)).length
		check.expect(planned.length === models.length - excludedCount, `variant ${v}: ${planned.length} writes, expected ${models.length - excludedCount}`)
		report[v] = planned.length
	}
	const restored = await cmds()
	check.expect(models.every((uuid) => restored[uuid] === base[uuid]), 'variant default did not restore the models')
	for (const v of source.variants) {
		const excluded = v.excluded.map((index) => renderables(source).findIndex((r) => r.index === index)).filter((r) => r >= 0)
		check.expect(excluded.length > 0 && excluded.every((r) => !writes(v.name).some((w) => w.uuid === bone(r))), `an excluded bone is written by variant ${v.name}`)
	}
	return report
}

// The literal text of each part of a text component, which the server keeps in the JSON it stores.
function textParts(component: unknown): string[] {
	if (typeof component === 'string') return component ? [component] : []
	if (Array.isArray(component)) return component.flatMap(textParts)
	if (typeof component !== 'object' || component === null) return []
	const { text, extra } = component as { text?: unknown; extra?: unknown }
	return [...textParts(typeof text === 'string' ? text : ''), ...textParts(extra ?? [])]
}

// The settings of each display arrive in the entity, with its name as a tag.
async function checkDisplays(check: Check, source: RigSource, bone: (b: number) => string) {
	const found: string[] = []
	for (const [r, entity] of renderables(source).entries()) {
		const d = entity.display
		if (!d) continue
		const nbt = (await check.entity(bone(r), '')) ?? ''
		const name = source.bones[entity.index]!.name
		const want =
			d.kind === 'block'
				? ['Name: "minecraft:oak_stairs"', 'facing: "east"', 'half: "top"']
				: d.kind === 'item'
					? [`id: "${d.item}"`, `item_display: "${d.mode}"`]
					: [...textParts(JSON.parse(d.text)), `shadow: ${d.shadow ? 1 : 0}b`, `line_width: ${d.lineWidth}`]
		for (const w of [...want, `"rigel.synthetic.${name}"`]) check.expect(nbt.includes(w), `display ${name}: ${w} missing from ${nbt.slice(0, 200)}`)
		found.push(`${name}:${d.kind}`)
	}
	return found
}

const HOLD = 1_000_000_000

// Plays every animation of the thinned rig and compares each bone after each step with the planned writes replayed
// in the same order; then pauses inside a run, restarts and stops.
async function checkThinned(check: Check, source: RigSource, settings: RigSettings, world: string) {
	const writesOf = (name: string) => variantWrites(world, settings.rig, name)
	// The entities are numbered from 1 after the root.
	const rewritten = (name: string) => new Set(writesOf(name).map((w) => Number.parseInt(w.uuid.split('-').at(-1)!, 16) - 1))
	const plans = thinnedPlans(source, settings, rewritten)
	const bones = plans[0]!.values[0]!.length
	const bone = (b: number) => uuidString(settings.id, b + 1)
	// Every bone a variant rewrites has a run ending the frame before it is applied, which the next write starts from.
	for (const [a, plan] of plans.entries())
		for (const [f, variant] of plan.calls)
			for (const r of f > 0 && plan.ends ? rewritten(variant) : [])
				check.expect(plan.ends!(r).ends.includes(f - 1), `thinned animation ${a}: bone ${r} has no run ending at ${f - 1}, where ${variant} is applied`)
	const self = `$Rigel.${settings.rig}`
	const rest = expectations(source).rest
	const fn = (name: string) => `function rigel:${settings.rig}/${name}`
	check.expect((await check.result(`execute positioned 4.0 -60.0 0.0 rotated 0 0 run ${fn('spawn')}`)) !== 0, 'thinned: spawn failed')

	const models = renderables(source).flatMap((r, i) => (r.display ? [] : [bone(i)]))
	const base = await check.cmds(models)
	const replay = new Replay(plans, rest)
	const { held, cooldown } = replay
	const apply = (a: number, f: number) => replay.apply(a, f)
	const compare = async (label: string) => {
		for (let b = 0; b < bones; b++) {
			const got = await check.display(bone(b))
			if (!got) {
				check.failures.push(`${label} bone ${b}: missing`)
				continue
			}
			const d = maxDiff(got.matrix, held[b]!.values)
			if (d > TOLERANCE) check.failures.push(`${label} bone ${b}: off by ${d.toFixed(4)}`)
			if (got.duration !== held[b]!.duration) check.failures.push(`${label} bone ${b}: interpolation_duration ${got.duration}, expected ${held[b]!.duration}`)
			if (got.cooldown !== cooldown[b]) check.failures.push(`${label} bone ${b}: PortalCooldown ${got.cooldown}, expected ${cooldown[b]}`)
		}
	}

	let long = 0
	for (const [a, plan] of plans.entries()) {
		long += plan.frames.flat().filter((w) => w.duration > 1).length
		const n = plan.ticks
		const steps = plan.loop === 'loop' ? 2 * n + 2 : n + 3
		check.server.send(fn('variant/default'))
		await check.server.sync()
		const variants = new VariantState(base, writesOf)
		check.server.send(`${fn('play')} {ID:${a}}`)
		apply(a, 0)
		for (let s = 0; s <= steps; s++) {
			if (s > 0) await check.step()
			const called = frameAt(plan.loop, n, s)
			if (called !== undefined) variants.apply(plan.calls.get(called))
			const cmds = await check.cmds(models)
			for (const uuid of models) if (cmds[uuid] !== variants.want[uuid]) check.failures.push(`thinned ${a} step ${s}: ${uuid} holds model ${cmds[uuid]}, expected ${variants.want[uuid]}`)
			// play wrote f/0, the first step keeps it; then one frame per step, a loop going round from f/n to f/1.
			if (s >= 2) {
				const t = s - 1
				if (plan.loop === 'loop') apply(a, n === 0 ? 0 : ((t - 1) % n) + 1)
				else if (t <= n) apply(a, t)
				else if (t === n + 1 && plan.loop === 'once') rest.forEach((values, b) => (held[b] = { values, duration: 1 }))
			}
			await compare(`thinned ${a} step ${s}`)
		}
		check.server.send(fn('stop'))
		for (let b = 0; b < bones; b++) held[b] = { ...held[b]!, duration: HOLD }
	}

	// Pause inside the longest run, hold for two steps, restart to finish the run on time.
	const runs = plans.flatMap((plan, a) => plan.frames.flatMap((writes, f) => writes.filter((w) => w.duration > 2).map((w) => ({ a, f, w }))))
	if (runs.length === 0) {
		check.failures.push('thinned: no run over three ticks to pause in')
		return { longWrites: long }
	}
	const { a, f } = runs.reduce((x, y) => (y.w.duration > x.w.duration ? y : x))
	check.server.send(`${fn('play')} {ID:${a}}`)
	apply(a, 0)
	await check.step()
	for (let t = 1; t <= f + 1; t++) {
		await check.step()
		apply(a, t)
	}
	const frame = (await check.score(self, 'Rigel.Frame'))!
	check.expect(frame === f + 1, `thinned: frame ${frame} before pause, expected ${f + 1}`)
	check.expect((await check.result(fn('pause'))) !== 0, 'thinned: pause failed')
	await check.step(2)
	check.expect((await check.score(self, 'Rigel.Frame')) === frame, 'thinned: pause did not stop the frames')
	for (let b = 0; b < bones; b++) {
		const got = (await check.display(bone(b)))!
		check.expect(got.duration === HOLD && Math.abs(got.shadow - 0.999) < 1e-6, `thinned: pause did not hold bone ${b}`)
	}
	check.expect((await check.result(fn('restart'))) !== 0, 'thinned: restart failed')
	for (let b = 0; b < bones; b++) {
		const got = (await check.display(bone(b)))!
		const left = Math.max(1, cooldown[b]! - frame)
		check.expect(got.duration === left && got.shadow === 1, `thinned: restart gave bone ${b} interpolation_duration ${got.duration} (expected ${left}), shadow ${got.shadow}`)
	}
	await check.step()
	check.expect((await check.score(self, 'Rigel.Frame')) === frame + 1, 'thinned: restart did not continue from the next frame')
	check.expect((await check.result(fn('stop'))) !== 0, 'thinned: stop failed')
	for (let b = 0; b < bones; b++) {
		const got = (await check.display(bone(b)))!
		check.expect(got.duration === HOLD && Math.abs(got.shadow - 0.999) < 1e-6, `thinned: stop did not hold bone ${b}`)
	}
	check.server.send(`${fn('play')} {ID:${a}}`)
	await check.server.sync()
	for (let b = 0; b < bones; b++) {
		const got = (await check.display(bone(b)))!
		check.expect(got.duration === 1 && got.shadow === 1, `thinned: play after stop left bone ${b} at interpolation_duration ${got.duration}, shadow ${got.shadow}`)
	}

	// Rigel.Frame is 0 on the tick of play and after a loop's last frame, with every run ended: restart takes one tick.
	const restartTakesOneTick = async (label: string) => {
		check.expect((await check.result(fn('pause'))) !== 0, `thinned: pause ${label} failed`)
		check.expect((await check.result(fn('restart'))) !== 0, `thinned: restart ${label} failed`)
		for (let b = 0; b < bones; b++) {
			const got = (await check.display(bone(b)))!
			check.expect(got.duration === 1, `thinned: restart ${label} gave bone ${b} interpolation_duration ${got.duration}`)
		}
		check.server.send(fn('stop'))
	}
	await restartTakesOneTick('on the tick of play')
	const loop = plans.findIndex((plan) => plan.loop === 'loop' && plan.ticks > 0 && plan.frames.flat().some((w) => w.duration > 1))
	if (loop >= 0) {
		check.server.send(`${fn('play')} {ID:${loop}}`)
		await check.step(plans[loop]!.ticks + 1)
		check.expect((await check.score(self, 'Rigel.Frame')) === 0, `thinned: loop ${loop} did not go round`)
		await restartTakesOneTick(`after the last frame of loop ${loop}`)
	}
	check.server.send(fn('kill'))
	return { longWrites: long, pausedIn: { animation: a, frame }, wrappedIn: loop }
}

interface TweenCase {
	what: string
	animation: string
	frame: number
	ticks: number
	// Steps after the call; by default until `after` steps past the arrival.
	steps?: number
	after?: number
	// Pauses after this step, holds two steps and restarts.
	pauseAt?: number
	// Calls with storage rigel:<rig> Argument.
	storage?: boolean
}

// tween from rest, playing, paused, stopped and waiting states: every bone holds the frame's pose with the tween's length
// until it arrives, then what playing the animation holds at the same frame, a bone inside a moving run finishing the
// run on time. The variants of frames up to the tween's arrive with it, with the function of only one on it; the
// locators move to the frame at once.
async function checkTween(check: Check, source: RigSource, settings: RigSettings, world: string, spawnAt: string) {
	const writesOf = (name: string) => variantWrites(world, settings.rig, name)
	const rewritten = (name: string) => new Set(writesOf(name).map((w) => Number.parseInt(w.uuid.split('-').at(-1)!, 16) - 1))
	const plans = thinnedPlans(source, settings, rewritten)
	const expected = expectations(source)
	const bones = expected.bones
	const bone = (b: number) => uuidString(settings.id, b + 1)
	const self = `$Rigel.${settings.rig}`
	const fn = (name: string) => `function rigel:${settings.rig}/${name}`
	const fail = (message: string) => check.failures.push(`tween ${settings.rig}: ${message}`)
	const index = (name: string) => source.animations.findIndex((a) => a.name === name)
	const models = renderables(source).flatMap((r, i) => (r.display ? [] : [bone(i)]))
	const onApply = (v: string | undefined) => (v && source.variants.find((x) => x.name === v)?.onApply ? 1 : 0)
	const locatorNames = (() => {
		const taken = new Set<string>()
		for (const b of source.bones) if (b.display) uniqueName(b.name, taken)
		return source.locators.map((l) => uniqueName(l.name, taken))
	})()
	await check.result(`execute positioned ${spawnAt} rotated 0 0 run ${fn('spawn')}`)
	check.server.send(fn('variant/default'))
	await check.server.sync()
	const variants = new VariantState(await check.cmds(models), writesOf)
	let state = new Replay(plans, expected.rest)
	let shadow = 1
	// The shadow_strength of the last tween; each one takes the other of .998 and .997, starting with .998.
	let tweened = 0.997

	const compare = async (label: string) => {
		for (let b = 0; b < bones; b++) {
			const got = await check.display(bone(b))
			if (!got) {
				fail(`${label} bone ${b}: missing`)
				continue
			}
			const d = maxDiff(got.matrix, state.held[b]!.values)
			if (d > TOLERANCE) fail(`${label} bone ${b}: off by ${d.toFixed(4)}`)
			if (got.duration !== state.held[b]!.duration) fail(`${label} bone ${b}: interpolation_duration ${got.duration}, expected ${state.held[b]!.duration}`)
			if (got.cooldown !== state.cooldown[b]) fail(`${label} bone ${b}: PortalCooldown ${got.cooldown}, expected ${state.cooldown[b]}`)
			if (Math.abs(got.shadow - shadow) > 1e-6) fail(`${label} bone ${b}: shadow_strength ${got.shadow}, expected ${shadow}`)
		}
		const cmds = await check.cmds(models)
		for (const uuid of models) if (cmds[uuid] !== variants.want[uuid]) fail(`${label}: ${uuid} holds model ${cmds[uuid]}, expected ${variants.want[uuid]}`)
	}

	// The frame the server runs m ticks after the one a tween arrives at, if any.
	const after = (a: number, t: number, m: number): number | 'rest' | undefined => {
		const { loop, ticks: n } = plans[a]!
		const x = t + m
		if (loop === 'loop' && n > 0) return x <= n ? x : ((x - 1) % n) + 1
		if (x <= n) return x
		return x === n + 1 && loop === 'once' ? 'rest' : undefined
	}

	const run = async (c: TweenCase) => {
		const a = index(c.animation)
		const plan = plans[a]!
		const n = plan.ticks
		const t = plan.loop === 'loop' && n > 0 ? ((c.frame % n) + n) % n : Math.min(Math.max(c.frame, 0), n)
		const normal = new Replay(plans, expected.rest)
		for (let f = 0; f <= t; f++) normal.apply(a, f)
		const moving = (b: number) => normal.cooldown[b]! > t
		let applied = (await check.score('$Applied', 'Rigel.Temp')) ?? 0
		const args = `{ID:${a},ticks:${c.ticks},frame:${c.frame}}`
		if (c.storage) check.server.send(`data modify storage rigel:${settings.rig} Argument set value ${args}`)
		if ((await check.result(c.storage ? `${fn('tween')} with storage rigel:${settings.rig} Argument` : `${fn('tween')} ${args}`)) === 0) fail(`${c.what}: tween failed`)
		state = new Replay(plans, expected.rest)
		for (let b = 0; b < bones; b++) {
			state.held[b] = { values: moving(b) ? plan.values[t]![b]! : normal.held[b]!.values, duration: c.ticks }
			state.cooldown[b] = t
		}
		tweened = tweened === 0.998 ? 0.997 : 0.998
		shadow = tweened
		for (const [l] of source.locators.entries()) {
			const got = await check.locator(settings.rig, locatorNames[l]!)
			const d = got ? maxDiff(got, expected.locators(a, t)[l]!) : Infinity
			if (d > LOCATOR_TOLERANCE) fail(`${c.what}: locator ${locatorNames[l]} off by ${d.toFixed(4)} on the tween's tick`)
		}
		const steps = c.steps ?? c.ticks + 1 + (c.after ?? 2)
		for (let s = 0; s <= steps; s++) {
			if (s > 0) await check.step()
			// The first step keeps the tick of the call; the tick that leaves Rigel.Wait at 1 is the last before arriving.
			const wait = s <= 1 ? c.ticks : Math.max(0, c.ticks - (s - 1))
			if (s === c.ticks + 1) {
				if (!plan.runs) for (let b = 0; b < bones; b++) state.held[b] = { ...state.held[b]!, duration: 1 }
				state.cooldown.fill(0)
				for (let b = 0; b < bones; b++) {
					if (!moving(b)) continue
					const end = normal.cooldown[b]!
					state.held[b] = { values: normal.held[b]!.values, duration: end - t }
					if (end - t > 1) state.cooldown[b] = end
				}
				for (const [k, v] of [...plan.calls].sort(([x], [y]) => x - y)) if (k <= t) variants.apply(v)
				applied += onApply(plan.calls.get(t))
			}
			if (s > c.ticks) {
				const f = after(a, t, s - c.ticks)
				if (f === 'rest') expected.rest.forEach((values, b) => (state.held[b] = { values, duration: 1 }))
				else if (f !== undefined) {
					state.apply(a, f)
					variants.apply(plan.calls.get(f))
					applied += onApply(plan.calls.get(f))
				}
			}
			await compare(`${c.what} step ${s}`)
			if (s <= c.ticks) {
				const frame = await check.score(self, 'Rigel.Frame')
				const waiting = await check.score(self, 'Rigel.Wait')
				if (frame !== t || waiting !== wait) fail(`${c.what} step ${s}: Rigel.Frame ${frame} and Rigel.Wait ${waiting}, expected ${t} and ${wait}`)
			}
			if (s === c.pauseAt) {
				if ((await check.result(fn('pause'))) === 0) fail(`${c.what}: pause failed`)
				for (let b = 0; b < bones; b++) state.held[b] = { ...state.held[b]!, duration: HOLD }
				shadow = 0.999
				await check.step(2)
				await compare(`${c.what} paused`)
				if ((await check.result(fn('restart'))) === 0) fail(`${c.what}: restart failed`)
				// While waiting, every bone reaches the tween's frame as the tween arrives, Rigel.Wait ticks away; the client
				// takes a tick before it gets the length. After arriving, each bone finishes its run, as after a pause in play.
				const now = s > c.ticks ? after(a, t, s - c.ticks) : undefined
				if (s > c.ticks && typeof now !== 'number') fail(`${c.what}: paused after the animation ended`)
				// Rigel.Frame is 0 after a loop's last frame.
				const at = now === 0 || (plan.loop === 'loop' && now === plan.ticks) ? Infinity : (now ?? 0)
				for (let b = 0; b < bones; b++) state.held[b] = { ...state.held[b]!, duration: s > c.ticks ? Math.max(1, state.cooldown[b]! - at) : Math.max(1, wait - 1) }
				shadow = 1
				await compare(`${c.what} restarted`)
			}
		}
		const got = (await check.score('$Applied', 'Rigel.Temp')) ?? 0
		if (got !== applied) fail(`${c.what}: the variant function count is ${got}, expected ${applied}`)
		return t
	}

	// Plays an animation for some steps, following the variants its frames apply.
	const play = async (name: string, steps: number) => {
		const a = index(name)
		check.server.send(`${fn('play')} {ID:${a}}`)
		for (let s = 0; s <= steps; s++) {
			if (s > 0) await check.step()
			const called = frameAt(plans[a]!.loop, plans[a]!.ticks, s)
			if (called !== undefined) variants.apply(plans[a]!.calls.get(called))
		}
	}

	// The frame of once with the most bones inside a moving run, past the first frames whose runs are all one tick.
	const once = index('once')
	const entry = (() => {
		let best = { frame: 10, bones: 0 }
		for (let f = 4; f < plans[once]!.ticks; f++) {
			const r = new Replay(plans, expected.rest)
			for (let g = 0; g <= f; g++) r.apply(once, g)
			const count = r.cooldown.filter((c) => c > f).length
			if (count > best.bones) best = { frame: f, bones: count }
		}
		return best
	})()
	if (settings.thin && entry.bones === 0) fail('no frame of once inside a moving run to enter')

	const report: Record<string, unknown> = { entry }
	await run({ what: 'from rest or stopped', animation: 'squash', frame: 0, ticks: 3 })
	await play('curves', 9)
	await run({ what: 'from playing, into a moving run, paused after arriving', animation: 'once', frame: entry.frame, ticks: 5, after: 4, pauseAt: 7 })
	await run({ what: 'waiting, to the same animation', animation: 'once', frame: 6, ticks: 6, steps: 3 })
	await run({ what: 'after a tween waiting, with storage', animation: 'once', frame: 1, ticks: 4, storage: true })
	await play('squash', 6)
	if ((await check.result(fn('pause'))) === 0) fail('pause before the paused case failed')
	await run({ what: 'from paused, paused while waiting', animation: 'curves', frame: 0, ticks: 6, pauseAt: 3, after: 3 })
	check.server.send(fn('stop'))
	report.pastTheEnd = await run({ what: 'from stopped, past the end of a hold animation', animation: 'hide', frame: 99, ticks: 3, after: 2 })
	if ((await check.score(self, 'Rigel.Playing')) !== 0) fail('a tween to the last frame of a hold animation did not stop it')
	report.wrapped = await run({ what: 'past the end of a loop', animation: 'squash', frame: 25, ticks: 2 })
	// Paused at frame 3 after the loop comes round, before the frame tweened to.
	await run({ what: 'into an animation without runs, paused a loop later', animation: 'eased', frame: 7, ticks: 4, steps: 42, pauseAt: 40 })

	// play while a tween waits drops the wait and writes f/0.
	await run({ what: 'before play', animation: 'curves', frame: 3, ticks: 10, steps: 3 })
	check.server.send(`${fn('play')} {ID:${index('squash')}}`)
	await check.server.sync()
	state = new Replay(plans, expected.rest)
	state.apply(index('squash'), 0)
	shadow = 1
	variants.apply(plans[index('squash')]!.calls.get(0))
	await compare('play while waiting')
	if ((await check.score(self, 'Rigel.Wait')) !== 0) fail('play left Rigel.Wait')

	if ((await check.result(`${fn('tween')} {ID:0,ticks:0,frame:0}`)) !== 0) fail('tween with ticks 0 did not fail')
	if ((await check.result(`${fn('tween')} {ID:99,ticks:1,frame:0}`)) !== 0) fail('tween with an unknown ID did not fail')

	// The commands one tween call runs, from a trace of debug function.
	const cost: Record<string, number> = {}
	for (const [name, frame] of COST_CASES) {
		const m = await check.server.run(`debug function check:cost_${settings.rig}_${name}`, /to output file (debug-trace-[\w.-]+\.txt)/)
		// The trace is logged before the command ends, which closes the file.
		await check.server.sync()
		const trace = join(SERVER_DIR, 'debug', m[1]!)
		const count = readFileSync(trace, 'utf8')
			.split('\n')
			.filter((line) => /^\s*\[C\]/.test(line)).length
		rmSync(trace)
		if (count === 0) fail(`the trace of a tween to ${name} ${frame} holds no commands`)
		cost[`${name} ${frame}`] = count
	}
	report.commands = cost
	check.server.send(fn('stop'))
	await check.server.sync()
	return report
}

// Rest pose and poses of each animation, from the front and from a corner, for mc-shot.
function shotSpec() {
	const views = [
		{ name: 'rest-front', eye: [0, 1.2, 3.5], yaw: 180, pitch: 10 },
		{ name: 'rest-corner', eye: [2.5, 2.5, 2.5], yaw: 135, pitch: 30 },
		{ name: 'curves-12', eye: [0, 1.2, 3.5], yaw: 180, pitch: 10, pose: { animation: 'curves', tick: 12 } },
		{ name: 'squash-10', eye: [2.5, 2.0, 2.5], yaw: 135, pitch: 20, pose: { animation: 'squash', tick: 10 } },
		{ name: 'eased-25', eye: [-2.5, 2.0, 2.5], yaw: 225, pitch: 20, pose: { animation: 'eased', tick: 25 } },
		// Poses after a variant keyframe: alt at tick 5 of hide, tip at tick 10 of curves and of once.
		{ name: 'hide-7', eye: [2.5, 2.0, 2.5], yaw: 135, pitch: 20, pose: { animation: 'hide', tick: 7 } },
		{ name: 'once-15', eye: [3.5, 1.2, 0], yaw: 90, pitch: 10, pose: { animation: 'once', tick: 15 } },
		// The displays from the front, where the text faces, and from behind the ice's corner.
		{ name: 'displays-front', eye: [0, 1.4, 3.0], yaw: 180, pitch: 5 },
		{ name: 'displays-back', eye: [-1.5, 1.6, -2.5], yaw: 330, pitch: 15 },
		// The glyphs, lines and decorations of each text, close up.
		{ name: 'text-label', eye: [0, 1.4, 1.4], yaw: 180, pitch: 0 },
		{ name: 'text-note', eye: [-0.875, 0.4, 1.1], yaw: 180, pitch: 0 },
		// Markers summoned at each locator in the pose, to compare with where Blockbench draws the locators.
		...[3, 12].map((tick) => ({
			name: `locators-curves-${tick}`,
			eye: [0, 1.2, 3.0],
			yaw: 180,
			pitch: 10,
			pose: { animation: 'curves', tick },
			commands: ['kill @e[tag=check.shot]', ...['tip', 'mark'].map((l) => `function rigel:synthetic/at_locator/${l} {function:"check:shot_marker"}`)],
		})),
		// Last, so the other views keep the project's own textures.
		{ name: 'variant-alt', eye: [0, 1.2, 3.5], yaw: 180, pitch: 10, variant: 'alt', commands: ['kill @e[tag=check.shot]'] },
	]
	return {
		origin: [0, -60, 0],
		rig: 'synthetic',
		datapacks: ['datapacks/synthetic', 'datapacks/rigel', 'datapacks/check'],
		resourcePacks: ['resources', 'font'],
		setup: ['execute positioned 0.0 -60.0 0.0 rotated 0 0 run function rigel:synthetic/spawn'],
		views,
		model: 'synthetic.bbmodel',
	}
}

// tween on the thinned rig, whose runs make the client interpolate for long, for mc-shot.
function tweenShotSpec() {
	const front = { eye: [0, 1.2, 3.5], yaw: 180, pitch: 10 }
	const tween = (from: string, at: number, ticks: number, frame: number, after: number, pause?: { at: number; hold: number }) => ({ from, at, ticks, frame, after, ...(pause && { pause }) })
	const into = (after: number, pause?: { at: number; hold: number }) => tween('curves', 8, 10, 10, after, pause)
	const views = [
		// The ice (a block display) has shrunk over a run from tick 4 to tick 10; a tween to tick 10 writes it the same pose.
		// It stays small instead of shrinking over the run again.
		{ name: 'squash-10', eye: [2.5, 2.0, 2.5], yaw: 135, pitch: 20, pose: { animation: 'squash', tick: 10, play: true } },
		{ name: 'tween-same-pose', eye: [2.5, 2.0, 2.5], yaw: 135, pitch: 20, pose: { animation: 'squash', tick: 10, play: true, tween: tween('squash', 10, 10, 10, 1) } },
		// From curves at tick 8 into once at tick 10, inside its body's run, over 10 ticks: before, one tick in, halfway,
		// paused halfway (as halfway), arrived, arrived after a pause (as arrived), and three ticks after arriving.
		{ name: 'curves-8', ...front, pose: { animation: 'curves', tick: 8, play: true } },
		{ name: 'tween-1', ...front, pose: { animation: 'once', tick: 10, play: true, tween: into(1) } },
		{ name: 'tween-halfway', ...front, pose: { animation: 'once', tick: 10, play: true, tween: into(5) } },
		{ name: 'tween-paused', ...front, pose: { animation: 'once', tick: 10, play: true, tween: into(5, { at: 5, hold: 5 }) } },
		{ name: 'tween-arrived', ...front, pose: { animation: 'once', tick: 10, play: true, tween: into(10) } },
		{ name: 'tween-restarted', ...front, pose: { animation: 'once', tick: 10, play: true, tween: into(10, { at: 5, hold: 5 }) } },
		{ name: 'tween-arrived-3', ...front, pose: { animation: 'once', tick: 13, play: true, tween: into(13) } },
		// Back to the start of a loop, two ticks after arriving.
		{ name: 'tween-loop-2', ...front, pose: { animation: 'curves', tick: 2, play: true, tween: tween('once', 6, 6, 0, 8) } },
	]
	return {
		origin: [0, -60, 0],
		rig: 'thinned',
		datapacks: ['datapacks/thinned', 'datapacks/rigel', 'datapacks/check'],
		resourcePacks: ['resources', 'font'],
		setup: ['execute positioned 0.0 -60.0 0.0 rotated 0 0 run function rigel:thinned/spawn'],
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
