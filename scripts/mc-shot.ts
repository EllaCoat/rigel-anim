// Screenshots of Minecraft from exact cameras, and the same cameras in the development Blockbench:
//
//   bun scripts/mc-shot.ts setup          download the client (Java and the server come from `bun bench/run.ts setup`)
//   bun scripts/mc-shot.ts <spec.json>    take the spec's views (fields in shot-spec.ts; example: scripts/shots/cube.json)
//
// The server loads a world of its own, made anew for every run, so nothing placed for a screenshot reaches
// the benchmark world. Results go to .shots/<spec>-<time>/: <view>-mc.png per view and, when the spec names
// a model, <view>-bb.png (Blockbench) and <view>-compare.png (Minecraft | Blockbench | both overlaid).
// The client window opens on the desktop while it runs; nothing needs the mouse or the keyboard.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { SERVER_DIR, Server } from '../bench/mc'
import { TARGET } from '../bench/target'
import { blockbenchRunning, devBlockbench, evaluate } from './devtools'
import { Client, GAME_DIR, KEY_F1, PLAYER, setupClient } from './mc-client'
import { parseSpec, poseCommands, type Spec, teleportArgs } from './shot-spec'

const WORLD_NAME = 'shot'
// Windows clamps the window to the screen, and a session with no monitor attached has a 1024×768 one.
// Blockbench draws at the size the screenshot came out anyway, so this only has to fit.
const WIDTH = 960
const HEIGHT = 540
// After joining, the client shows "Loading terrain" and then builds the chunks around the player.
const JOIN_SETTLE_MS = 5000
const RESULTS = join(import.meta.dir, '..', '.shots')
const COMMAND_ERROR = /Unknown or incomplete command|Incorrect argument for command|<--\[HERE\]|Unknown function/

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function copyPacks(sources: string[], specDir: string, into: string): string[] {
	rmSync(into, { recursive: true, force: true })
	return sources.map((source) => {
		const name = basename(source)
		cpSync(resolve(specDir, source), join(into, name), { recursive: true })
		return name
	})
}

// `poses[i]` are the console commands that set up the rig's pose for view i.
async function shoot(spec: Spec, specDir: string, out: string, poses: string[][]): Promise<string[]> {
	const world = join(SERVER_DIR, WORLD_NAME)
	rmSync(world, { recursive: true, force: true })
	copyPacks(spec.datapacks, specDir, join(world, 'datapacks'))
	const resourcePacks = copyPacks(spec.resourcePacks, specDir, join(GAME_DIR, 'resourcepacks'))

	const server = await Server.start(WORLD_NAME)
	let client: Client | undefined
	try {
		for (const rule of TARGET.quietRules) server.send(`gamerule ${rule}`)
		server.send('time set noon')
		server.send('weather clear')

		const joined = server.waitFor(new RegExp(`\\b${PLAYER} joined the game`), 180_000).then(() => true, () => false)
		client = Client.launch({ server: '127.0.0.1:25565', width: WIDTH, height: HEIGHT, resourcePacks })
		const inGame = await Promise.race([joined, client.output.exited.then(() => false)])
		if (!inGame) throw new Error(`the client did not join the server; see ${join(out, 'client.log')}`)

		server.send(`gamemode spectator ${PLAYER}`)
		const from = server.log.length
		for (const command of spec.setup) server.send(command)
		await server.sync()
		const errors = server.log.slice(from).filter((line) => COMMAND_ERROR.test(line))
		if (errors.length > 0) throw new Error(`setup commands failed:\n${errors.join('\n')}`)

		await sleep(JOIN_SETTLE_MS)
		await client.press(KEY_F1)
		const files: string[] = []
		for (const [i, view] of spec.views.entries()) {
			const from = server.log.length
			for (const command of poses[i]!) server.send(command)
			await server.sync()
			const errors = server.log.slice(from).filter((line) => COMMAND_ERROR.test(line))
			if (errors.length > 0) throw new Error(`pose commands of ${view.name} failed:\n${errors.join('\n')}`)
			server.send(`tp ${PLAYER} ${teleportArgs(spec, view)}`)
			await server.sync()
			await sleep(spec.settleMs)
			const file = join(out, `${view.name}-mc.png`)
			copyFileSync(await client.screenshot(), file)
			files.push(file)
		}
		return files
	} finally {
		if (client) {
			await client.stop()
			writeFileSync(join(out, 'client.log'), client.output.lines.join('\n'))
		}
		writeFileSync(join(out, 'server.log'), server.log.join('\n'))
		await server.stop()
	}
}

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) })
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`
const writeDataUrl = (file: string, url: string) => writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))

async function drawInBlockbench(spec: Spec & { model: string }, specDir: string, shots: string[], out: string): Promise<string[]> {
	const launched = !(await blockbenchRunning())
	try {
		if (launched) devBlockbench('launch')
		const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'shot-harness.ts')], target: 'browser', format: 'iife' })
		if (!build.success) throw new AggregateError(build.logs, 'harness build failed')
		await evaluate(`${await build.outputs[0]!.text()}\nreturn true`)
		const modelPath = resolve(specDir, spec.model)
		const model = JSON.parse(readFileSync(modelPath, 'utf8'))
		await evaluate(`return await __rigelShot.open(${JSON.stringify(model)}, ${JSON.stringify(basename(modelPath))})`)

		const files: string[] = []
		for (const [i, view] of spec.views.entries()) {
			const minecraft = readFileSync(shots[i]!)
			const { width, height } = pngSize(minecraft)
			const blockbench: string = await evaluate(`return __rigelShot.render(${JSON.stringify(view)}, ${width}, ${height})`)
			writeDataUrl(join(out, `${view.name}-bb.png`), blockbench)
			const compare: string = await evaluate(`return await __rigelShot.compose(${JSON.stringify(dataUrl(minecraft))}, ${JSON.stringify(blockbench)})`)
			const file = join(out, `${view.name}-compare.png`)
			writeDataUrl(file, compare)
			files.push(file)
		}
		return files
	} finally {
		// A launch that timed out can leave Blockbench starting up; one that never came up has nothing to stop.
		if (launched && (await blockbenchRunning())) devBlockbench('stop')
	}
}

async function main(): Promise<void> {
	const [command] = process.argv.slice(2)
	if (command === 'setup') return setupClient()
	if (!command || !existsSync(command)) {
		console.error('usage: bun scripts/mc-shot.ts setup | <spec.json>')
		process.exitCode = 64
		return
	}
	const specPath = resolve(command)
	const spec = parseSpec(JSON.parse(readFileSync(specPath, 'utf8')))
	const out = join(RESULTS, `${basename(specPath, '.json')}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
	mkdirSync(out, { recursive: true })
	const animations: { name: string; length: number }[] = spec.model ? (JSON.parse(readFileSync(resolve(dirname(specPath), spec.model), 'utf8')).animations ?? []) : []
	const poses = spec.views.map((view) => poseCommands(spec, animations, view))
	const shots = await shoot(spec, dirname(specPath), out, poses)
	const compared = spec.model ? await drawInBlockbench({ ...spec, model: spec.model }, dirname(specPath), shots, out) : []
	console.log(JSON.stringify({ out, minecraft: shots.map((f) => basename(f)), compare: compared.map((f) => basename(f)) }, null, 1))
}

try {
	await main()
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
