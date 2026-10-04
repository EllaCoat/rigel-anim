// Bakes every animation of the given rigs in the development Blockbench and reports the display-entity
// writes playback would need (every tick, only bones that changed, thinned at each tolerance), and how
// far the baked values are from Blockbench's preview. Needs `bun scripts/dev-bb.ts launch` and `install`.
//
//   bun scripts/bake-stats.ts [--out report.json] [--synthetic] [file.ajblueprint | directory]...
//
// The full report (per rig and animation) goes to --out, by default a file in the OS temp directory,
// so data derived from private rigs stays out of the repository.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { TOLERANCES } from '../src/bake/stats'
import { evaluate } from './devtools'
import { syntheticRig } from './synthetic-rig'

function blueprints(path: string): string[] {
	if (!statSync(path).isDirectory()) return [path]
	return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? blueprints(join(path, e.name)) : e.name.endsWith('.ajblueprint') ? [join(path, e.name)] : [],
	)
}

// Animated Java writes its own version into meta.format_version, which Blockbench would read as a
// bbmodel version and convert like a pre-3.2 file. The blueprints are taken to be saved by Blockbench
// 4.x (Animated Java 1.x), so 4.10 applies only the 5.0 conversion of animation axes. Textures and
// animation controllers are not needed, and a selected controller would replace the animation in the preview.
function prepare(text: string) {
	const model = JSON.parse(text)
	model.meta = { ...model.meta, model_format: 'rigel', format_version: '4.10' }
	model.textures = []
	delete model.animation_controllers
	return model
}

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)
function quantile(xs: number[], q: number): number {
	if (xs.length === 0) return 0
	const sorted = [...xs].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}
const percent = (x: number) => `${(x * 100).toFixed(1)}%`

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const outAt = args.indexOf('--out')
	const out = outAt >= 0 ? args.splice(outAt, 2)[1]! : join(tmpdir(), `rigel-bake-stats-${Date.now()}.json`)
	const synthetic = args.includes('--synthetic')
	const files = args.filter((a) => a !== '--synthetic').flatMap(blueprints)
	if (!synthetic && files.length === 0) {
		console.error('usage: bun scripts/bake-stats.ts [--out report.json] [--synthetic] [file.ajblueprint | directory]...')
		process.exitCode = 64
		return
	}
	if (!(await evaluate('return !!Formats.rigel'))) throw new Error('the rigel plugin is not loaded; run `bun scripts/dev-bb.ts install`')
	const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'bake-harness.ts')], target: 'browser', format: 'iife' })
	if (!build.success) throw new AggregateError(build.logs, 'harness build failed')
	await evaluate(`${await build.outputs[0]!.text()}\nreturn true`)

	const inputs = [
		...(synthetic ? [{ name: 'synthetic', model: syntheticRig() }] : []),
		...files.map((f) => ({ name: basename(f), model: prepare(readFileSync(f, 'utf8')) })),
	]
	const rigs: any[] = []
	for (const { name, model } of inputs) {
		const opened = await evaluate(`return await __rigelBake.open(${JSON.stringify(model)}, ${JSON.stringify(name)})`)
		const result = await evaluate('return __rigelBake.analyse()')
		rigs.push({ name, ...opened, ...result })
		console.error(`${name}: ${result.animations.length} animations`)
	}

	const animations = rigs.flatMap((r) => r.animations.map((a: any) => ({ rig: r.name, ...a })))
	const failed = animations.filter((a) => a.error)
	const baked = animations.filter((a) => !a.error)
	const dense = (a: any) => a.writes.bones * a.writes.ticks
	const totalDense = sum(baked.map(dense))
	const methods = [
		{ label: 'every tick', writes: dense, peak: (a: any) => (a.writes.ticks > 0 ? a.writes.bones : 0) },
		{ label: 'changed only', writes: (a: any) => a.writes.changed, peak: (a: any) => a.writes.changedPeak },
		...TOLERANCES.map((t, i) => ({
			label: `thinned ${t.position} block, ${((t.rotation * 180) / Math.PI).toFixed(2)}°`,
			writes: (a: any) => a.writes.thinned[i],
			peak: (a: any) => a.writes.thinnedPeak[i],
		})),
	]
	const withTicks = baked.filter((a) => dense(a) > 0)
	const rows = methods.map((m) => {
		const ratios = withTicks.map((a) => m.writes(a) / dense(a))
		return {
			method: m.label,
			writes: sum(baked.map(m.writes)),
			perBoneTick: sum(baked.map(m.writes)) / totalDense,
			median: quantile(ratios, 0.5),
			p90: quantile(ratios, 0.9),
			peakShare: Math.max(0, ...withTicks.map((a) => m.peak(a) / a.writes.bones)),
		}
	})
	const max = (pick: (a: any) => number) => Math.max(0, ...baked.map(pick))
	const summary = {
		rigs: rigs.length,
		animations: animations.length,
		failed: failed.map((a) => ({ rig: a.rig, name: a.name, error: a.error })),
		renderableBoneTicks: totalDense,
		writes: rows,
		valueCounts: { 7: sum(baked.map((a) => a.counts[7])), 10: sum(baked.map((a) => a.counts[10])), 14: sum(baked.map((a) => a.counts[14])) },
		previewError: { translation: max((a) => a.previewError.translation), linear: max((a) => a.previewError.linear) },
		quantizationError: { translation: max((a) => a.quantizationError.translation), linear: max((a) => a.quantizationError.linear) },
		// Per value count: the largest and the 99th percentile of the per-animation maxima, and the worst animations.
		midpointDeviation: Object.fromEntries(
			(['7', '10', '14'] as const).map((c) => {
				const per = baked.map((a) => ({ rig: a.rig, name: a.name, linear: a.midpointDeviation[c].linear, translation: a.midpointDeviation[c].translation }))
				const spread = (xs: number[]) => ({ max: Math.max(0, ...xs), p99: quantile(xs, 0.99) })
				return [c, { linear: spread(per.map((p) => p.linear)), translation: spread(per.map((p) => p.translation)), worst: per.sort((x, y) => y.linear - x.linear).slice(0, 5) }]
			}),
		),
	}
	writeFileSync(out, JSON.stringify({ tolerances: TOLERANCES, summary, rigs }, null, 1))

	console.log(`rigs ${summary.rigs}, animations ${summary.animations} (failed ${failed.length}), renderable bone-ticks ${totalDense}`)
	console.log('method | writes | per bone-tick | median | p90 | peak share')
	for (const r of rows) console.log(`${r.method} | ${r.writes} | ${percent(r.perBoneTick)} | ${percent(r.median)} | ${percent(r.p90)} | ${percent(r.peakShare)}`)
	console.log(`bone tracks by value count: 7=${summary.valueCounts[7]} 10=${summary.valueCounts[10]} 14=${summary.valueCounts[14]}`)
	console.log(`max preview mismatch: translation ${summary.previewError.translation.toExponential(2)} block, linear ${summary.previewError.linear.toExponential(2)}`)
	console.log(`max quantization error: translation ${summary.quantizationError.translation.toExponential(2)} block, linear ${summary.quantizationError.linear.toExponential(2)}`)
	for (const [c, d] of Object.entries(summary.midpointDeviation) as [string, any][]) {
		console.log(`midpoint deviation (${c} values): linear max ${d.linear.max.toExponential(2)} p99 ${d.linear.p99.toExponential(2)}, translation max ${d.translation.max.toExponential(2)} block p99 ${d.translation.p99.toExponential(2)}`)
	}
	for (const f of summary.failed) console.log(`FAILED ${f.rig} / ${f.name}: ${String(f.error).split('\n')[0]}`)
	console.log(`report: ${out}`)
	if (failed.length) process.exitCode = 1
}

try {
	await main()
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
