// Checks easing in the development Blockbench: eased values, overshoot on catmullrom segments,
// conversion to bézier handles (refused cases, kept neighbours, fitting error), undo and redo, and
// saving and loading. Needs `bun scripts/dev-bb.ts launch` and `install`.
//
//   bun scripts/easing-check.ts
import { join } from 'node:path'
import { evaluate } from './devtools'
import { easingRig } from './easing-rig'

// Blockbench evaluates béziers by searching 200 points along the curve, so rewritten neighbours
// match to about this many degrees.
const KEPT = 1e-3
const EXACT = 1e-9

async function main(): Promise<void> {
	if (!(await evaluate('return !!Formats.rigel'))) throw new Error('the rigel plugin is not loaded; run `bun scripts/dev-bb.ts install`')
	const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'easing-harness.ts')], target: 'browser', format: 'iife' })
	if (!build.success) throw new AggregateError(build.logs, 'harness build failed')
	await evaluate(`${await build.outputs[0]!.text()}\nreturn true`)
	await evaluate(`return await __rigelEasing.open(${JSON.stringify(easingRig())}, 'easing')`)

	const problems: string[] = []
	const linear = await evaluate('return __rigelEasing.checkLinear()')
	console.log(`eased linear segments: worst difference ${linear.worst.toExponential(2)}`)
	if (linear.failureCount) problems.push(`eased linear values differ (${linear.failureCount}): ${linear.failures.join('; ')}`)

	const moved = await evaluate('return __rigelEasing.checkMoved()')
	console.log(`after moving a keyframe: worst difference ${moved.toExponential(2)}`)
	if (!(moved < 1e-6)) problems.push('moving a keyframe changed the eased shape')

	const curves = await evaluate('return __rigelEasing.checkCurves()')
	console.log(`catmullrom and bézier: errors ${curves.errors.length + curves.caught.length}, open start dipped ${curves.openStartDipped}, looping anticipation ${curves.anticipation.toFixed(2)}°`)
	if (curves.errors.length || curves.caught.length) problems.push(`errors while evaluating: ${[...curves.errors, ...curves.caught].join('; ')}`)
	if (curves.nonFinite.length) problems.push(`non-finite values in ${curves.nonFinite.join(', ')}`)
	if (curves.openStartDipped) problems.push('easeInBack dipped below the start of an open catmullrom channel')
	if (!(curves.anticipation > 0.1)) problems.push('easeInBack on a looping catmullrom channel did not overshoot along the wrapped segment')

	const conversion = await evaluate('return __rigelEasing.checkConversion()')
	const { report, blocked, kept } = conversion
	console.log(`conversion: ${report.converted} of ${conversion.eased} segments, ${report.keyframes} keyframes, max error ${(report.maxRelativeError * 100).toFixed(2)}% of the range`)
	const largest = Object.entries(conversion.differences as Record<string, { max: number; at: number }>).sort(([, a], [, b]) => b.max - a.max).slice(0, 8)
	console.log(`largest changes: ${largest.map(([c, d]) => `${c} ${d.max.toFixed(2)} at ${d.at}s`).join(', ')}`)
	console.log(`kept segments: linear after eased ${kept.linearAfterEased.toExponential(2)}°, neighbours ${kept.neighbours.toExponential(2)}°`)
	if (blocked.step.blockedByStep !== 1 || blocked.step.converted !== 0) problems.push(`step case not refused: ${JSON.stringify(blocked.step)}`)
	if (blocked.overshoot.blockedByOvershoot !== 1 || blocked.overshoot.converted !== 0) problems.push(`overshoot case not refused: ${JSON.stringify(blocked.overshoot)}`)
	if (conversion.blockedChanged.length) problems.push(`refused conversions changed ${conversion.blockedChanged.join(', ')}`)
	if (report.converted !== conversion.eased || conversion.remainingEasing) problems.push(`converted ${report.converted} of ${conversion.eased}, ${conversion.remainingEasing} still eased`)
	if (!(kept.linearAfterEased < KEPT && kept.neighbours < KEPT)) problems.push('segments next to converted ones changed')

	const undo = await evaluate('return __rigelEasing.checkUndo()')
	const worst = (d: Record<string, { max: number }>) => Math.max(...Object.values(d).map((v) => v.max))
	console.log(`undo ${worst(undo.undone).toExponential(2)}, redo ${worst(undo.redone).toExponential(2)}`)
	if (!(worst(undo.undone) < EXACT && worst(undo.redone) < EXACT)) problems.push('undo or redo did not restore the values')

	const reload = await evaluate('return await __rigelEasing.checkReload()')
	console.log(`after saving and loading ${worst(reload).toExponential(2)}`)
	if (!(worst(reload) < EXACT)) problems.push(`saving and loading changed: ${JSON.stringify(Object.entries(reload).filter(([, v]: any) => v.max >= EXACT))}`)

	for (const p of problems) console.log(`FAILED ${p}`)
	console.log(problems.length ? `${problems.length} check(s) failed` : 'all easing checks passed')
	if (problems.length) process.exitCode = 1
}

try {
	await main()
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
