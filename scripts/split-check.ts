// Checks src/export/thin.ts's copy of Minecraft's matrix split against a 1.20.4 server: writes matrices to an
// item_display and compares the translation, rotations and scale the server stores (the parts clients interpolate).
//
//   bun scripts/split-check.ts [--matrices <file.json>]
//
// The matrices are generated (rotations with plain, uneven, sheared, mirrored, vanished and large scales); a JSON
// file with more (an array of 12-value rows) is checked as well. Needs the benchmark server (`bun bench/run.ts setup`);
// the server loads a world of its own, made anew each run.
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SERVER_DIR, Server } from '../bench/mc'
import { quatToMat3, type Quat } from '../src/bake/matrix'
import { split } from '../src/export/thin'

const WORLD_NAME = 'split-check'
const UUID = '5911c4ec-0-0-0-1'
// Differences left by the order of float operations, far below a visible change.
const TOLERANCE = 1e-4

function random(seed: number): () => number {
	let x = seed
	return () => {
		x = (x * 1103515245 + 12345) % 2147483648
		return x / 2147483648
	}
}

function generated(): number[][] {
	const next = random(17)
	const quat = (): Quat => {
		const q = [next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5]
		const n = Math.hypot(...q)
		return q.map((v) => v / n) as Quat
	}
	// Rows of rotation · (scale with shear) and a translation.
	const matrix = (q: Quat, s: number[], shear: number[] = [0, 0, 0]) => {
		const r = quatToMat3(q)
		const k = [s[0]!, shear[0]!, shear[1]!, 0, s[1]!, shear[2]!, 0, 0, s[2]!]
		const t = [next() * 4 - 2, next() * 4 - 2, next() * 4 - 2]
		return [0, 1, 2].flatMap((row) => [0, 1, 2].map((c) => r[row * 3]! * k[c]! + r[row * 3 + 1]! * k[3 + c]! + r[row * 3 + 2]! * k[6 + c]!).concat(t[row]!))
	}
	const out: number[][] = []
	for (let i = 0; i < 100; i++) out.push(matrix(quat(), [1, 1, 1]))
	for (let i = 0; i < 100; i++) out.push(matrix(quat(), [0.2 + next() * 3, 0.2 + next() * 3, 0.2 + next() * 3]))
	for (let i = 0; i < 100; i++) out.push(matrix(quat(), [0.9 + next() * 0.05, 0.9 + next() * 0.05, 0.9 + next() * 0.05], [(next() - 0.5) * 0.04, (next() - 0.5) * 0.04, (next() - 0.5) * 0.04]))
	for (let i = 0; i < 100; i++) out.push(matrix(quat(), [0.5 + next(), 0.5 + next(), 0.5 + next()], [next() - 0.5, next() - 0.5, next() - 0.5]))
	for (let i = 0; i < 50; i++) out.push(matrix(quat(), [-(0.5 + next()), 0.5 + next(), 0.5 + next()]))
	for (let i = 0; i < 50; i++) out.push(matrix(quat(), [next() < 0.5 ? 0 : 1, 0, next() < 0.5 ? 0 : 1]))
	for (let i = 0; i < 50; i++) out.push(matrix(quat(), [27.46, 27.46, 27.46]))
	for (let i = 0; i < 50; i++) {
		const axis = quat()
		out.push(matrix([axis[0], axis[1], axis[2], 1e-3 * (next() - 0.5)], [1, 1, 1]))
	}
	return out
}

const format = (v: number) => `${v.toFixed(6)}f`

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const fileAt = args.indexOf('--matrices')
	const matrices = generated()
	if (fileAt >= 0) matrices.push(...(JSON.parse(readFileSync(args[fileAt + 1]!, 'utf8')) as number[][]))

	const world = join(SERVER_DIR, WORLD_NAME)
	rmSync(world, { recursive: true, force: true })
	const server = await Server.start(WORLD_NAME)
	let worst = 0
	const failures: string[] = []
	try {
		server.send('tick freeze')
		await server.run(`summon item_display 0.0 -60.0 0.0 {UUID:[I;${0x5911c4ec},0,0,1]}`, /Summoned new/)
		for (const [i, m] of matrices.entries()) {
			const written = m.map(format)
			server.send(`data merge entity ${UUID} {transformation:[${written.join(',')},0f,0f,0f,1f]}`)
			const nbt = (await server.run(`data get entity ${UUID} transformation`, /has the following entity data: (.*)$/))[1]!
			const list = (key: string) => [...new RegExp(`${key}: \\[([^\\]]*)\\]`).exec(nbt)![1]!.matchAll(/-?[\d.]+(?:E-?\d+)?/g)].map((x) => Number(x[0]))
			const server_ = [...list('translation'), ...list('left_rotation'), ...list('scale'), ...list('right_rotation')]
			const s = split(written.map((v) => Number.parseFloat(v)))
			const ours = [...s.translation, ...s.left, ...s.scale, ...s.right]
			const diff = Math.max(...ours.map((v, k) => Math.abs(v - server_[k]!)))
			worst = Math.max(worst, diff)
			if (!(diff <= TOLERANCE)) failures.push(`#${i}: max difference ${diff.toExponential(2)}\n  server ${server_.join(',')}\n  ours   ${ours.join(',')}`)
		}
	} finally {
		await server.stop()
		rmSync(world, { recursive: true, force: true })
	}
	console.log(`split-check: ${matrices.length} matrices, ${failures.length} differ by more than ${TOLERANCE} (largest difference ${worst.toExponential(2)})`)
	for (const f of failures.slice(0, 10)) console.log(f)
	if (failures.length > 10) console.log(`... ${failures.length - 10} more`)
	if (failures.length > 0) process.exitCode = 1
}

await main()
