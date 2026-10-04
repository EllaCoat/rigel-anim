// Replaces eased segments with Blockbench's own bézier handles, so their shape can be edited in the
// graph editor. Each eased segment becomes one cubic bézier fitted to its eased curve.
//
// Both ends of a converted segment must become bezier keyframes: Blockbench saves handles only for
// bezier keyframes. That changes how the neighbouring segments interpolate, so every linear or
// catmullrom segment whose interpolation would change is rewritten as a bézier with the same curve
// (both are cubic in the progress, so the handles reproduce them). Its ends become bezier as well,
// which can reach further segments, up to a step, catmullrom or bezier keyframe or the channel's end.
// A held (step) segment cannot be kept that way, and neither can an overshooting easing on a rewritten
// neighbour (Blockbench's bézier stops at its end values), so such channels are left unchanged.
import { ease, type EasingCurve } from './curves'
import { fitBezier, thirdsBezier } from './fit'
import { AXES, baseValue, channelKeyframes, easedValue, getEasing, isLooping, setEasing } from './keyframes'
import { segmentKind, type SegmentKind } from './segments'

const SAMPLES = 200

export interface ConversionReport {
	/** eased segments converted */
	converted: number
	/** keyframes whose interpolation or handles changed */
	keyframes: number
	/** largest fitting error relative to the value range of the segment, over converted segments and axes */
	maxRelativeError: number
	/** eased segments left unchanged because their channel holds a step segment that would change */
	blockedByStep: number
	/** eased segments left unchanged because their channel uses molang expressions */
	blockedByExpression: number
	/** eased segments left unchanged because a neighbouring segment that would change overshoots */
	blockedByOvershoot: number
}

interface Rewrite {
	index: number
	eased: boolean
	/** per axis: the target curve sampled at SAMPLES + 1 points (eased) or at 0, 1/3, 2/3, 1 (others) */
	samples: number[][]
}

interface ChannelPlan {
	sorted: BBKeyframe[]
	bezier: Set<BBKeyframe>
	rewrites: Rewrite[]
}

type Planned = { plan: ChannelPlan } | { blocked: 'step' | 'expression' | 'overshoot'; segments: number } | undefined

function overshoots(curve: EasingCurve): boolean {
	for (let i = 1; i < SAMPLES; i++) {
		const e = ease(curve, i / SAMPLES)
		if (e < -1e-9 || e > 1 + 1e-9) return true
	}
	return false
}

function planChannel(sorted: BBKeyframe[], selected: Set<BBKeyframe>): Planned {
	const loop = isLooping(sorted[0]!)
	const original: (SegmentKind | undefined)[] = sorted.slice(0, -1).map((k, j) => segmentKind(k, sorted[j + 1]!))
	const targets = original.flatMap((kind, j) => (selected.has(sorted[j]!) && getEasing(sorted[j]!) && kind && kind !== 'step' ? [j] : []))
	if (targets.length === 0) return undefined
	if (sorted.some((k) => k.has_expressions)) return { blocked: 'expression', segments: targets.length }

	const bezier = new Set<BBKeyframe>()
	const rewritten = new Set<number>()
	const rewrite = (j: number) => {
		rewritten.add(j)
		bezier.add(sorted[j]!)
		bezier.add(sorted[j + 1]!)
	}
	targets.forEach(rewrite)
	const interpolation = (k: BBKeyframe) => ({ interpolation: bezier.has(k) ? 'bezier' : k.interpolation })
	for (let changed = true; changed; ) {
		changed = false
		for (let j = 0; j < original.length; j++) {
			if (rewritten.has(j)) continue
			if (segmentKind(interpolation(sorted[j]!), interpolation(sorted[j + 1]!)) === original[j]) continue
			if (original[j] !== 'linear' && original[j] !== 'catmullrom') return { blocked: 'step', segments: targets.length }
			// Blockbench's bézier stops at its end values, so an overshoot on top of it would be cut off.
			const easing = getEasing(sorted[j]!)
			if (easing && overshoots(easing.curve)) return { blocked: 'overshoot', segments: targets.length }
			rewrite(j)
			changed = true
		}
	}

	const isTarget = new Set(targets)
	const rewrites = [...rewritten].sort((a, b) => a - b).map((index) => {
		const eased = isTarget.has(index)
		const points = eased ? Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES) : [0, 1 / 3, 2 / 3, 1]
		const samples = AXES.map((axis) =>
			points.map((t) => (eased ? easedValue(sorted, index, axis, t, loop) : baseValue(sorted, index, axis, t, loop))),
		)
		return { index, eased, samples }
	})
	return { plan: { sorted, bezier, rewrites } }
}

function applyPlan({ sorted, bezier, rewrites }: ChannelPlan): number {
	let maxRelativeError = 0
	for (const keyframe of bezier) {
		keyframe.interpolation = 'bezier'
		keyframe.bezier_linked = false
	}
	for (const { index, eased, samples } of rewrites) {
		const before = sorted[index]!
		const after = sorted[index + 1]!
		const gap = after.time - before.time
		AXES.forEach((axis, i) => {
			// The ends as Blockbench's bézier reads them.
			const start = before.calc(axis, 1)
			const end = after.calc(axis, 0)
			const values = samples[i]!
			values[0] = start
			values[values.length - 1] = end
			let x1 = 1 / 3
			let x2 = 2 / 3
			let v1: number
			let v2: number
			if (eased) {
				const fit = fitBezier(values)
				;({ x1, x2, v1, v2 } = fit)
				const range = Math.max(...values) - Math.min(...values)
				if (range > 1e-9) maxRelativeError = Math.max(maxRelativeError, fit.error / range)
			} else {
				;[v1, v2] = thirdsBezier(values[0]!, values[1]!, values[2]!, values[3]!)
			}
			before.bezier_right_time[i] = x1 * gap
			before.bezier_right_value[i] = v1 - start
			after.bezier_left_time[i] = (x2 - 1) * gap
			after.bezier_left_value[i] = v2 - end
		})
		if (eased) setEasing(before, undefined)
	}
	return maxRelativeError
}

/** Converts the eased segments starting at the given keyframes, as one undo step. */
export function convertEasingToBezier(keyframes: BBKeyframe[]): ConversionReport {
	const report: ConversionReport = { converted: 0, keyframes: 0, maxRelativeError: 0, blockedByStep: 0, blockedByExpression: 0, blockedByOvershoot: 0 }
	const selected = new Set(keyframes)
	const channels = new Map<string, BBKeyframe[]>()
	for (const k of keyframes) {
		if (!k.transform || !getEasing(k)) continue
		const key = `${k.animator.uuid}:${k.channel}`
		if (!channels.has(key)) channels.set(key, channelKeyframes(k))
	}
	const plans: ChannelPlan[] = []
	for (const sorted of channels.values()) {
		const planned = planChannel(sorted, selected)
		if (!planned) continue
		if ('plan' in planned) plans.push(planned.plan)
		else if (planned.blocked === 'step') report.blockedByStep += planned.segments
		else if (planned.blocked === 'overshoot') report.blockedByOvershoot += planned.segments
		else report.blockedByExpression += planned.segments
	}
	if (plans.length === 0) return report

	const changed = plans.flatMap((p) => [...p.bezier])
	Undo.initEdit({ keyframes: changed })
	for (const plan of plans) {
		report.maxRelativeError = Math.max(report.maxRelativeError, applyPlan(plan))
		report.converted += plan.rewrites.filter((r) => r.eased).length
	}
	report.keyframes = changed.length
	Undo.finishEdit('Convert easing to bezier handles')
	return report
}
