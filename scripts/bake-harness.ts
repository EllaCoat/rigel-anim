// Runs inside the development Blockbench: bake-stats.ts bundles this file and injects it.
import { bakeAnimation, describeBones } from '../src/bake/bake'
import type { ValueCount } from '../src/bake/decompose'
import { compose, normalizeQuat, slerp, type Vec3 } from '../src/bake/matrix'
import { dequantize, reconstruct, STRIDE } from '../src/bake/quantize'
import { collectBones, readBoneMatrices, sampleAnimation, tickCount, TICKS_PER_SECOND } from '../src/bake/sample'
import { writeStats } from '../src/bake/stats'

// translation in blocks; linear (the 3x3 part) relative to the bone's scale, at least 1, since the
// stored rotations limit the precision to about 1e-4 of it.
interface Difference {
	translation: number
	linear: number
}

async function open(model: unknown, name: string) {
	for (const project of [...ModelProject.all]) {
		project.saved = true
		await project.close(true)
	}
	Codecs.project.load(model, { name, path: name, no_file: true } as any)
	Modes.options.animate.select()
	return { format: Format.id, bones: Group.all.length, animations: Animation.all.length }
}

function analyse() {
	const groups = collectBones()
	const bones = describeBones(groups)
	const renderable = bones.map((b) => b.renderable)
	const animations = Animation.all.map((animation) => {
		try {
			const ticks = tickCount(animation)
			const sampled = sampleAnimation(animation, groups)
			const preview = previewMatrices(animation, groups, ticks)
			const baked = bakeAnimation(animation, groups, sampled)
			const counts = { 7: 0, 10: 0, 14: 0 }
			baked.counts.forEach((c, b) => renderable[b] && counts[c]++)
			return {
				name: animation.name,
				loop: animation.loop,
				ticks,
				counts,
				previewError: compare(sampled, preview, groups.length * (ticks + 1)),
				quantizationError: quantizationError(sampled, baked.values, groups.length * (ticks + 1)),
				midpointDeviation: midpointDeviation(sampled, baked.values, baked.counts, ticks, groups.length),
				writes: writeStats(baked.values, ticks, groups.length, renderable),
			}
		} catch (error) {
			return { name: animation.name, error: String((error as Error)?.stack ?? error) }
		}
	})
	return { bones: bones.length, renderable: renderable.filter(Boolean).length, animations }
}

// The matrices the preview shows when the playhead is moved to each tick, as when scrubbing the timeline.
function previewMatrices(animation: BBAnimation, groups: Group[], ticks: number): Float64Array {
	const out = new Float64Array((ticks + 1) * groups.length * 16)
	animation.select()
	for (let i = 0; i <= ticks; i++) {
		Timeline.setTime(Math.min(i / TICKS_PER_SECOND, animation.length))
		Animator.preview()
		readBoneMatrices(groups, out, i * groups.length * 16)
	}
	return out
}

function compare(a: Float64Array, b: Float64Array, count: number): Difference {
	const d = { translation: 0, linear: 0 }
	for (let i = 0; i < count; i++) accumulate(d, a, i * 16, b, i * 16)
	return d
}

function quantizationError(sampled: Float64Array, values: Int32Array, count: number): Difference {
	const d = { translation: 0, linear: 0 }
	for (let i = 0; i < count; i++) accumulate(d, sampled, i * 16, reconstruct(values, i * STRIDE), 0)
	return d
}

// Halfway between two ticks, the pose Minecraft interpolates from the stored components against the
// average of the two sampled matrices, per value count. Only small steps (3x3 part changing by at most
// SMALL_STEP relative to the scale) are compared, where the average is close to the real in-between
// pose; equivalent decompositions that jump between ticks would still show a large deviation there.
// Steps from or to a nearly vanished bone (largest axis below VISIBLE) are left out: its rotation is
// free, and a bone hidden for a single tick turns while it is that small.
const SMALL_STEP = 0.05
const VISIBLE = 0.1
function midpointDeviation(sampled: Float64Array, values: Int32Array, counts: ValueCount[], ticks: number, bones: number) {
	const out: Record<ValueCount, Difference> = { 7: { translation: 0, linear: 0 }, 10: { translation: 0, linear: 0 }, 14: { translation: 0, linear: 0 } }
	const mid = new Float64Array(16)
	for (let b = 0; b < bones; b++) {
		for (let f = 0; f < ticks; f++) {
			const i = f * bones + b
			const j = i + bones
			const step = { translation: 0, linear: 0 }
			accumulate(step, sampled, i * 16, sampled, j * 16)
			if (step.linear > SMALL_STEP || Math.min(largestAxis(sampled, i * 16), largestAxis(sampled, j * 16)) < VISIBLE) continue
			const p = dequantize(values, i * STRIDE)
			const q = dequantize(values, j * STRIDE)
			const half = (x: Vec3, y: Vec3) => x.map((v, k) => (v + y[k]!) / 2) as Vec3
			const interpolated = compose(half(p.translation, q.translation), slerp(normalizeQuat(p.left), normalizeQuat(q.left), 0.5), half(p.scale, q.scale), slerp(normalizeQuat(p.right), normalizeQuat(q.right), 0.5))
			for (let k = 0; k < 16; k++) mid[k] = (sampled[i * 16 + k]! + sampled[j * 16 + k]!) / 2
			accumulate(out[counts[b]!], mid, 0, interpolated, 0)
		}
	}
	return out
}

function largestAxis(m: ArrayLike<number>, at: number): number {
	return Math.max(...[0, 4, 8].map((c) => Math.hypot(m[at + c]!, m[at + c + 1]!, m[at + c + 2]!)))
}

function accumulate(d: Difference, a: ArrayLike<number>, at: number, b: ArrayLike<number>, bt: number): void {
	for (const k of [12, 13, 14]) d.translation = Math.max(d.translation, Math.abs(a[at + k]! - b[bt + k]!))
	const scale = Math.max(1, largestAxis(a, at))
	for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) d.linear = Math.max(d.linear, Math.abs(a[at + k]! - b[bt + k]!) / scale)
}

;(globalThis as any).__rigelBake = { open, analyse }
