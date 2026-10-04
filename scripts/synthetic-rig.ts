// A small rig whose animations cover what baking has to handle: catmullrom, bezier, step and linear
// keyframes; shear (children turning under unevenly scaled parents, with and without two equal scale
// axes); zero scale; mirroring; a bone without cubes; a 'once' animation whose length is not a
// whole number of ticks; and eased segments, overshooting ones included.
let next = 0
const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

type V = [number, number, number]

const elements: object[] = []
function group(name: string, origin: V, cube?: [V, V], children: object[] = []) {
	const kids: (object | string)[] = []
	if (cube) {
		const uuid = id()
		elements.push({ name, type: 'cube', uuid, from: cube[0], to: cube[1], origin, rotation: [0, 0, 0] })
		kids.push(uuid)
	}
	return { name, uuid: id(), origin, rotation: [0, 0, 0], children: [...kids, ...children] }
}

function key(channel: string, time: number, [x, y, z]: V, interpolation = 'linear', extra: object = {}) {
	return { channel, data_points: [{ x, y, z }], uuid: id(), time, color: -1, interpolation, ...extra }
}

const eased = (family: string, mode: string) => ({ rigel_easing: { name: `${family} ${mode}`, curve: { type: 'function', family, mode } } })

function bezier(time: number, value: V, left: V, right: V) {
	return key('rotation', time, value, 'bezier', {
		bezier_linked: false,
		bezier_left_time: [-0.2, -0.2, -0.2],
		bezier_left_value: left,
		bezier_right_time: [0.2, 0.2, 0.2],
		bezier_right_value: right,
	})
}

export function syntheticRig() {
	next = 0
	elements.length = 0
	const hand = group('hand', [4, 6, 0], [[3, 4, -1], [5, 6, 1]])
	const arm = group('arm', [4, 12, 0], [[3, 6, -1], [5, 12, 1]], [hand])
	const tailtip = group('tailtip', [0, 6, -8], [[-1, 5, -10], [1, 7, -8]])
	const tail = group('tail', [0, 6, -4], [[-1, 5, -8], [1, 7, -4]], [tailtip])
	const gem = group('gem', [0, 16, 0], [[-1, 16, -1], [1, 18, 1]])
	const pivot = group('pivot', [0, 14, 0], undefined, [gem])
	const body = group('body', [0, 8, 0], [[-3, 4, -2], [3, 12, 2]], [arm, tail, pivot])

	const animation = (name: string, loop: string, length: number, animators: Record<string, object[]>, bones: Record<string, { uuid: string }>) => ({
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
		animators: Object.fromEntries(Object.entries(animators).map(([bone, keyframes]) => [bones[bone]!.uuid, { name: bone, type: 'bone', keyframes }])),
	})
	const bones = { body, arm, hand, tail, tailtip, pivot, gem }

	return {
		meta: { format_version: '5.0', model_format: 'rigel', box_uv: false },
		name: 'synthetic',
		resolution: { width: 16, height: 16 },
		elements,
		outliner: [body],
		textures: [],
		animations: [
			animation('curves', 'loop', 1.5, {
				body: [key('rotation', 0, [0, 0, 0], 'catmullrom'), key('rotation', 0.5, [10, 60, 0], 'catmullrom'), key('rotation', 1, [0, 120, 20], 'catmullrom'), key('rotation', 1.5, [0, 0, 0], 'catmullrom')],
				arm: [bezier(0, [0, 0, 0], [0, 0, 0], [0, 0, -40]), bezier(0.75, [0, 0, -80], [0, 0, -20], [0, 0, 20]), bezier(1.5, [0, 0, 0], [0, 0, -40], [0, 0, 0])],
				hand: [key('position', 0, [0, 0, 0], 'step'), key('position', 0.5, [0, 2, 0], 'step'), key('position', 1, [1, 0, 0], 'step')],
				pivot: [key('rotation', 0, [0, 0, 0]), key('rotation', 1.5, [0, 360, 0])],
			}, bones),
			animation('squash', 'loop', 1, {
				body: [key('scale', 0, [1, 1, 1]), key('scale', 0.5, [1.5, 0.7, 1.5]), key('scale', 1, [1, 1, 1])],
				arm: [key('rotation', 0, [0, 0, 0]), key('rotation', 1, [90, 45, 0])],
				tail: [key('scale', 0, [2, 1.5, 1]), key('scale', 1, [2, 1.5, 1])],
				tailtip: [key('rotation', 0, [0, 0, 0]), key('rotation', 1, [30, 60, 90])],
			}, bones),
			animation('hide', 'hold', 1, {
				tail: [key('scale', 0, [1, 1, 1]), key('scale', 0.5, [0, 0, 0]), key('scale', 1, [1, 1, 1])],
				arm: [key('scale', 0, [1, 1, 1]), key('scale', 1, [-1, 1, 1])],
			}, bones),
			animation('eased', 'loop', 2, {
				body: [key('rotation', 0, [0, 0, 0], 'linear', eased('back', 'out')), key('rotation', 1, [0, 90, 0], 'linear', eased('elastic', 'inOut')), key('rotation', 2, [0, 0, 0])],
				arm: [key('rotation', 0, [0, 0, 0], 'catmullrom', eased('sine', 'inOut')), key('rotation', 0.7, [0, 0, -70], 'catmullrom', eased('back', 'in')), key('rotation', 1.4, [30, 0, -20], 'catmullrom'), key('rotation', 2, [0, 0, 0], 'catmullrom')],
				hand: [key('position', 0, [0, 0, 0], 'linear', eased('bounce', 'out')), key('position', 1, [0, 3, 0]), key('position', 2, [0, 0, 0])],
				tail: [key('scale', 0, [1, 1, 1], 'linear', { rigel_easing: { name: 'pop', curve: { type: 'bezier', x1: 0.3, y1: 1.6, x2: 0.6, y2: 1 } } }), key('scale', 2, [1.5, 1.5, 1.5])],
			}, bones),
			animation('once', 'once', 1.03, {
				body: [key('position', 0, [0, 0, 0]), key('position', 1.03, [0, 0, 8])],
				hand: [key('rotation', 0, [0, 0, 0], 'catmullrom'), key('rotation', 0.5, [45, 0, 0], 'catmullrom'), key('rotation', 1.03, [0, 0, 0], 'catmullrom')],
			}, bones),
		],
	}
}
