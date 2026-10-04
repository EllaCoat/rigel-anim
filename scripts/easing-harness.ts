// Runs inside the development Blockbench: easing-check.ts bundles this file and injects it.
import { convertEasingToBezier, type ConversionReport } from '../src/easing/convert'
import { builtinEasings, ease } from '../src/easing/curves'
import { getEasing } from '../src/easing/keyframes'
import { CUSTOM_BEZIER, LINEAR_DELTA } from './easing-rig'

const STEPS_PER_SECOND = 100

async function open(model: unknown, name: string) {
	for (const project of [...ModelProject.all]) {
		project.saved = true
		await project.close(true)
	}
	Codecs.project.load(model, { name, path: name, no_file: true } as any)
	Modes.options.animate.select()
	return { format: Format.id, animations: Animation.all.length }
}

const animation = (name: string) => Animation.all.find((a) => a.name === name)!

type Animators = Record<string, { name: string; rotation: BBKeyframe[]; position: BBKeyframe[]; interpolate(c: string, e: boolean): number[] | false }>
const animators = (a: BBAnimation) => Object.values((a as unknown as { animators: Animators }).animators)

// Channel values of every bone at every step, as the timeline shows them.
function sampleValues(a: BBAnimation): Record<string, number[][]> {
	a.select()
	const out: Record<string, number[][]> = {}
	const steps = Math.round(a.length * STEPS_PER_SECOND)
	for (const animator of animators(a)) {
		for (const channel of ['rotation', 'position'] as const) {
			if (!animator[channel]?.length) continue
			const rows: number[][] = []
			for (let i = 0; i <= steps; i++) {
				Timeline.time = i / STEPS_PER_SECOND
				const v = animator.interpolate(channel, false)
				rows.push(v ? [...v] : [NaN, NaN, NaN])
			}
			out[`${animator.name}.${channel}`] = rows
		}
	}
	return out
}

function sampleAll() {
	return Object.fromEntries(Animation.all.map((a) => [a.name, sampleValues(a)]))
}

// Per channel, the largest difference of each step between two samplings.
function compare(a: ReturnType<typeof sampleAll>, b: ReturnType<typeof sampleAll>) {
	const out: Record<string, number[]> = {}
	for (const [anim, channels] of Object.entries(a)) {
		for (const [channel, rows] of Object.entries(channels)) {
			out[`${anim}/${channel}`] = rows.map((row, i) => Math.max(...row.map((v, k) => Math.abs(v - b[anim]![channel]![i]![k]!))))
		}
	}
	return out
}

let original: ReturnType<typeof sampleAll>
let converted: ReturnType<typeof sampleAll>

// 1. Eased linear segments follow the curve exactly; the following segment stays linear.
function checkLinear() {
	const values = sampleValues(animation('linear'))
	const failures: string[] = []
	let worst = 0
	for (const easing of [...builtinEasings(), CUSTOM_BEZIER]) {
		const rows = values[`lin_${easing.name}.rotation`]!
		for (let i = 0; i <= 2 * STEPS_PER_SECOND; i++) {
			const t = i / STEPS_PER_SECOND
			const progress = t <= 1 ? ease(easing.curve, t) : 2 - t
			LINEAR_DELTA.forEach((d, k) => {
				const error = Math.abs(rows[i]![k]! - d * progress)
				worst = Math.max(worst, error)
				if (error > 1e-6) failures.push(`${easing.name} t=${t} axis ${k}: ${rows[i]![k]} vs ${d * progress}`)
			})
		}
	}
	const pos = values['pos_bounce.position']!
	const bounce = builtinEasings().find((e) => e.name === 'easeOutBounce')!
	for (let i = 0; i <= STEPS_PER_SECOND; i++) {
		const p = ease(bounce.curve, i / STEPS_PER_SECOND)
		const error = Math.max(Math.abs(pos[i]![1]! - 16 * p), Math.abs(pos[i]![2]! - 8 * p))
		worst = Math.max(worst, error)
		if (error > 1e-6) failures.push(`pos_bounce t=${i / STEPS_PER_SECOND}`)
	}
	return { worst, failures: failures.slice(0, 10), failureCount: failures.length }
}

// 1b. Moving a keyframe keeps the shape: the easing follows the segment's progress, not seconds.
function checkMoved() {
	const a = animation('linear')
	a.select()
	const animator = animators(a).find((an) => an.name === 'lin_easeOutBack')!
	const end = animator.rotation.find((k) => k.time === 1)!
	end.time = 1.5
	const errors: number[] = []
	for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
		Timeline.time = t * 1.5
		const v = animator.interpolate('rotation', false) as number[]
		const progress = ease(builtinEasings().find((e) => e.name === 'easeOutBack')!.curve, t)
		errors.push(...LINEAR_DELTA.map((d, k) => Math.abs(v[k]! - d * progress)))
	}
	end.time = 1
	return Math.max(...errors)
}

// 2. Eased catmullrom and bézier segments evaluate without errors, including overshoot at open ends.
function checkCurves() {
	const errors: string[] = []
	const caught: string[] = []
	const listener = (event: ErrorEvent) => caught.push(event.message)
	window.addEventListener('error', listener)
	let values: ReturnType<typeof sampleAll> = {}
	try {
		values = { curves: sampleValues(animation('curves')), loop: sampleValues(animation('loop')) }
	} catch (error) {
		errors.push(String(error))
	}
	window.removeEventListener('error', listener)
	const nonFinite = Object.entries(values).flatMap(([anim, channels]) =>
		Object.entries(channels).flatMap(([channel, rows]) => (rows.some((r) => r.some((v) => !Number.isFinite(v))) ? [`${anim}/${channel}`] : [])),
	)
	// The open catmullrom's first segment uses easeInBack: no keyframe before it, so it must not dip below the start.
	const firstSegment = values.curves?.['cr_open.rotation']?.slice(0, STEPS_PER_SECOND / 2) ?? []
	const dipped = firstSegment.some((r) => r[0]! < -1e-9)
	// The looping one wraps around, so easeInBack first moves back along the last segment, which
	// comes down from 90° on y: the value rises above the start before the segment's own motion.
	const anticipation = Math.max(...(values.loop?.['cr_loop.rotation']?.slice(1, STEPS_PER_SECOND / 4).map((r) => r[1]!) ?? [0]))
	return { errors, caught, nonFinite, openStartDipped: dipped, anticipation }
}

function easedKeyframes(exclude: string[]): BBKeyframe[] {
	return Animation.all.flatMap((a) =>
		animators(a)
			.filter((an) => !exclude.includes(an.name))
			.flatMap((an) => [...(an.rotation ?? []), ...(an.position ?? [])].filter((k) => getEasing(k))),
	)
}

function firstKeyframe(anim: string, bone: string): BBKeyframe {
	return animators(animation(anim)).find((a) => a.name === bone)!.rotation.find((k) => k.time === 0)!
}

// 3. Conversion: refused cases change nothing; converting the rest keeps every other segment.
function checkConversion() {
	original = sampleAll()
	const blocked: Record<string, ConversionReport> = {
		step: convertEasingToBezier([firstKeyframe('curves', 'step_block')]),
		overshoot: convertEasingToBezier([firstKeyframe('curves', 'overshoot_block')]),
	}
	const afterBlocked = compare(original, sampleAll())
	const blockedChanged = Object.entries(afterBlocked).filter(([, d]) => Math.max(...d) > 0).map(([c]) => c)

	// Blockbench records keyframe undo per animation, as the timeline only selects keyframes of one.
	const keyframes = easedKeyframes(['step_block', 'overshoot_block'])
	const reports = Animation.all.map((a) => {
		a.select()
		// Undo records keyframes only while the timeline shows animators, as it does when editing.
		for (const animator of animators(a)) (animator as unknown as { addToTimeline(): void }).addToTimeline()
		return convertEasingToBezier(keyframes.filter((k) => (k.animator as unknown as { animation: BBAnimation }).animation === a))
	})
	const report = {
		converted: reports.reduce((t, r) => t + r.converted, 0),
		keyframes: reports.reduce((t, r) => t + r.keyframes, 0),
		maxRelativeError: Math.max(...reports.map((r) => r.maxRelativeError)),
	}
	converted = sampleAll()
	const differences = compare(original, converted)
	const remainingEasing = keyframes.filter((k) => getEasing(k)).length
	// Segments that were not eased must keep their values: the linear segment after each eased one,
	// and the linear and catmullrom neighbours of the eased segment in 'neighbours'.
	const range = (row: number[], from: number, to: number) => Math.max(...row.slice(from * STEPS_PER_SECOND, to * STEPS_PER_SECOND + 1))
	const kept = {
		linearAfterEased: Math.max(...Object.entries(differences).filter(([c]) => c.startsWith('linear/lin_')).map(([, row]) => range(row, 1, 2))),
		neighbours: Math.max(range(differences['curves/neighbours.rotation']!, 0, 0.4), range(differences['curves/neighbours.rotation']!, 0.8, 1.6)),
	}
	return { blocked, blockedChanged, report, eased: keyframes.length, remainingEasing, kept, differences: summarize(differences) }
}

// Per channel: the largest difference and the time it occurs.
function summarize(d: Record<string, number[]>) {
	return Object.fromEntries(
		Object.entries(d).map(([c, row]) => {
			let at = 0
			row.forEach((v, i) => v > row[at]! && (at = i))
			return [c, { max: row[at]!, at: at / STEPS_PER_SECOND }]
		}),
	)
}

// 4. Undo restores the eased curves and redo the converted ones.
function checkUndo() {
	for (const _ of Animation.all) Undo.undo()
	const undone = summarize(compare(original, sampleAll()))
	for (const _ of Animation.all) Undo.redo()
	const redone = summarize(compare(converted, sampleAll()))
	return { undone, redone }
}

// 5. Saving and loading keeps the converted handles and the remaining easing.
async function checkReload() {
	const saved = Codecs.project.compile({ raw: true } as any)
	await open(saved, 'reloaded')
	return summarize(compare(converted, sampleAll()))
}

;(globalThis as any).__rigelEasing = { open, checkLinear, checkMoved, checkCurves, checkConversion, checkUndo, checkReload }
