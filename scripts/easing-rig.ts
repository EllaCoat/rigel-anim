// A rig for checking easing in the development Blockbench: one bone per built-in easing on a linear
// segment, eased catmullrom and bézier segments (including overshoot where Blockbench's spline has no
// neighbouring keyframe), and channels whose conversion to béziers must be refused.
import { builtinEasings, type Easing } from '../src/easing/curves'

type V = [number, number, number]
let next = 0
const id = () => `00000000-0000-4000-9000-${String(++next).padStart(12, '0')}`

export const CUSTOM_BEZIER: Easing = { name: 'custom', curve: { type: 'bezier', x1: 0.2, y1: -0.4, x2: 0.6, y2: 1.5 } }
export const LINEAR_DELTA: V = [90, 45, -30]

function key(channel: string, time: number, [x, y, z]: V, interpolation = 'linear', easing?: Easing, extra: object = {}) {
	return { channel, data_points: [{ x, y, z }], uuid: id(), time, color: -1, interpolation, rigel_easing: easing ?? {}, ...extra }
}

const easing = (name: string) => builtinEasings().find((e) => e.name === name)!

export function easingRig() {
	next = 0
	const bones: { name: string; uuid: string; origin: V; rotation: V; children: never[] }[] = []
	const bone = (name: string) => {
		const b = { name, uuid: id(), origin: [0, 0, 0] as V, rotation: [0, 0, 0] as V, children: [] }
		bones.push(b)
		return b
	}
	const animators = (entries: [string, object[]][]) =>
		Object.fromEntries(entries.map(([name, keyframes]) => [bones.find((b) => b.name === name)!.uuid, { name, type: 'bone', keyframes }]))
	const animation = (name: string, loop: string, length: number, entries: [string, object[]][]) => ({
		uuid: id(),
		name,
		loop,
		override: false,
		length,
		snapping: 20,
		selected: false,
		anim_time_update: '',
		blend_weight: '',
		start_delay: '',
		loop_delay: '',
		animators: animators(entries),
	})

	const linear: [string, object[]][] = [...builtinEasings(), CUSTOM_BEZIER].map((e) => {
		bone(`lin_${e.name}`)
		return [`lin_${e.name}`, [key('rotation', 0, [0, 0, 0], 'linear', e), key('rotation', 1, LINEAR_DELTA), key('rotation', 2, [0, 0, 0])]]
	})
	bone('pos_bounce')
	linear.push(['pos_bounce', [key('position', 0, [0, 0, 0], 'linear', easing('easeOutBounce')), key('position', 1, [0, 16, 8])]])

	for (const name of ['cr_open', 'bz', 'neighbours', 'step_block', 'overshoot_block', 'cr_loop']) bone(name)
	const bezier = (time: number, value: V, left: V, right: V, e?: Easing) =>
		key('rotation', time, value, 'bezier', e, { bezier_linked: false, bezier_left_time: [-0.15, -0.15, -0.15], bezier_left_value: left, bezier_right_time: [0.15, 0.15, 0.15], bezier_right_value: right })
	const strongElastic: Easing = { name: 'strong', curve: { type: 'function', family: 'elastic', mode: 'out', amplitude: 3 } }
	const curves: [string, object[]][] = [
		// Non-looping catmullrom: the first segment has no keyframe before it, the last none after it.
		['cr_open', [
			key('rotation', 0, [0, 0, 0], 'catmullrom', easing('easeInBack')),
			key('rotation', 0.5, [60, 0, 0], 'catmullrom', strongElastic),
			key('rotation', 1, [0, 60, 0], 'catmullrom', easing('easeInOutSine')),
			key('rotation', 1.5, [0, 0, 60], 'catmullrom', easing('easeOutBack')),
			key('rotation', 2, [0, 0, 0], 'catmullrom'),
		]],
		['bz', [bezier(0, [0, 0, 0], [0, 0, 0], [20, 0, 0], easing('easeInOutQuad')), bezier(1, [0, 90, 0], [-20, 0, 0], [0, 0, 0]), bezier(2, [0, 0, 0], [0, 0, 0], [0, 0, 0])]],
		// Linear and catmullrom neighbours around an eased linear segment, which conversion must keep.
		['neighbours', [
			key('rotation', 0, [0, 0, 0]),
			key('rotation', 0.4, [30, 0, 0], 'linear', easing('easeInOutCubic')),
			key('rotation', 0.8, [30, 60, 0]),
			key('rotation', 1.2, [0, 60, 30], 'catmullrom'),
			key('rotation', 1.6, [0, 0, 30], 'catmullrom', easing('easeInOutQuad')),
			key('rotation', 2, [0, 0, 0]),
		]],
		['step_block', [key('rotation', 0, [0, 0, 0], 'linear', easing('easeOutQuad')), key('rotation', 1, [0, 45, 0], 'step'), key('rotation', 2, [0, 90, 0])]],
		['overshoot_block', [key('rotation', 0, [0, 0, 0], 'linear', easing('easeInOutQuad')), key('rotation', 1, [45, 0, 0], 'linear', easing('easeOutBack')), key('rotation', 2, [0, 0, 0])]],
	]
	const loop: [string, object[]][] = [
		['cr_loop', [
			key('rotation', 0, [0, 0, 0], 'catmullrom', easing('easeInBack')),
			key('rotation', 0.5, [0, 90, 0], 'catmullrom'),
			key('rotation', 1, [0, 0, 0], 'catmullrom'),
		]],
	]

	return {
		meta: { format_version: '5.0', model_format: 'rigel', box_uv: false },
		name: 'easing',
		resolution: { width: 16, height: 16 },
		elements: [],
		outliner: bones,
		textures: [],
		animations: [animation('linear', 'once', 2, linear), animation('curves', 'once', 2, curves), animation('loop', 'loop', 1, loop)],
	}
}
