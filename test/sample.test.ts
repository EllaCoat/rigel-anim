import { afterEach, describe, expect, test } from 'bun:test'
import { EXPORT_POSE_EVENT, poseAnimation, sampleAnimation } from '../src/bake/sample'

// The export's calls into Blockbench, recorded in order. The rig has no bones, so no matrices are read.
const globals = globalThis as unknown as Record<string, unknown>
const saved = Object.fromEntries(['Timeline', 'Animator', 'Blockbench', 'Project'].map((name) => [name, globals[name]]))
afterEach(() => Object.assign(globals, saved))

function fakeBlockbench(onPose: (data: { animation: unknown; tick: number }) => void = () => {}) {
	const calls: string[] = []
	const timeline = { time: 0.42 }
	const matrix = { clone: () => ({ invert: () => ({ clone: () => ({}) }) }) }
	Object.assign(globals, {
		Timeline: timeline,
		Animator: {
			showDefaultPose: () => calls.push(`default ${timeline.time}`),
			stackAnimations: (animations: unknown[]) => calls.push(`stack ${animations.length} ${timeline.time}`),
			preview: () => calls.push(`preview ${timeline.time}`),
		},
		Blockbench: {
			dispatchEvent: (name: string, data: { animation: unknown; tick: number }) => {
				calls.push(`${name} ${data.tick}`)
				onPose(data)
			},
		},
		Project: { model_3d: { matrixWorld: matrix } },
	})
	return { calls, timeline }
}

describe('the pose the export reads', () => {
	test('a tick is posed like the preview, clamped to the length, and then announced with the animation', () => {
		const { calls } = fakeBlockbench()
		const animation = { length: 0.12 } as unknown as BBAnimation
		poseAnimation(animation, 1)
		poseAnimation(animation, 3)
		expect(calls).toEqual(['default 0.05', 'stack 1 0.05', `${EXPORT_POSE_EVENT} 1`, 'default 0.12', 'stack 1 0.12', `${EXPORT_POSE_EVENT} 3`])
	})

	test('sampling announces every tick in order with the sampled animation, then shows the playhead again', () => {
		const seen: unknown[] = []
		const { calls, timeline } = fakeBlockbench(({ animation }) => seen.push(animation))
		const animation = { length: 0.1 } as unknown as BBAnimation
		sampleAnimation(animation, [], [])
		expect(calls.filter((call) => call.startsWith(EXPORT_POSE_EVENT))).toEqual([0, 1, 2].map((tick) => `${EXPORT_POSE_EVENT} ${tick}`))
		expect(seen).toEqual([animation, animation, animation])
		expect(timeline.time).toBe(0.42)
		expect(calls.at(-1)).toBe('preview 0.42')
	})

	test('a listener that throws stops the sampling, and the playhead is still restored', () => {
		const { calls, timeline } = fakeBlockbench(({ tick }) => {
			if (tick === 1) throw new Error('spring failed')
		})
		expect(() => sampleAnimation({ length: 0.1 } as unknown as BBAnimation, [], [])).toThrow('spring failed')
		expect(calls.filter((call) => call.startsWith(EXPORT_POSE_EVENT))).toHaveLength(2)
		expect(timeline.time).toBe(0.42)
	})
})
