// A small rig whose animations cover what baking has to handle: catmullrom, bezier, step and linear
// keyframes; shear (children turning under unevenly scaled parents, with and without two equal scale
// axes); zero scale; mirroring; a bone without cubes; a 'once' animation whose length is not a
// whole number of ticks; eased segments, overshooting ones included; two variants, one of them
// on two bones only, and variant keyframes in each kind of animation (on the last tick of a loop and
// of a hold, twice on one tick, and on the last tick of a 'once'); locators with and without an
// entity; and the three displays. Each face direction has its own colour, so a mirrored
// or turned export shows in screenshots.
import { deflateSync } from 'node:zlib'

let next = 0
const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

type V = [number, number, number]

// 16×16 texture in 2 px wide stripes; face direction i uses stripe i.
const STRIPES: [number, number, number][] = [[220, 40, 40], [40, 80, 220], [40, 180, 60], [230, 200, 40], [240, 240, 240], [60, 60, 60]]
const DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down']

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})
function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const out = Buffer.alloc(body.length + 8)
	out.writeUInt32BE(data.length, 0)
	body.copy(out, 4)
	out.writeUInt32BE(crc32(body), body.length + 4)
	return out
}
function png(width: number, height: number, pixel: (x: number, y: number) => number[]): Buffer {
	const raw = Buffer.alloc(height * (width * 4 + 1))
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4)
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 6, 0, 0, 0], 8)
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
}
function paletteDataUrl(invert = false): string {
	const image = png(16, 16, (x) => [...(STRIPES[Math.floor(x / 2)] ?? [255, 0, 255]).map((c) => (invert ? 255 - c : c)), 255])
	return `data:image/png;base64,${image.toString('base64')}`
}

const CLEAR = [0, 0, 0, 0]
// U+E000: a red bar on the left, a blue base and a yellow dot at the top right, 16 pixels wide.
const wideGlyph = (x: number, y: number) => (x < 4 ? [220, 40, 40, 255] : y >= 12 ? [40, 80, 220, 255] : x >= 12 && x < 15 && y >= 1 && y < 4 ? [230, 200, 40, 255] : CLEAR)
// U+E001: a green triangle, 10 pixels wide at its base, in a 16 pixel cell.
const narrowGlyph = (x: number, y: number) => (x < ((y + 1) * 10) / 16 ? [40, 180, 60, 255] : CLEAR)

/**
 * The resource pack with `check:icons`, the font the note display uses: two bitmap glyphs taller than the default
 * font's, one narrower than its cell, and a space that steps back between them.
 */
export function syntheticFontPack(): Record<string, string | Buffer> {
	const providers = [
		{ type: 'bitmap', file: 'check:font/icons.png', ascent: 12, height: 16, chars: [''] },
		{ type: 'space', advances: { '': -4 } },
	]
	return {
		'pack.mcmeta': JSON.stringify({ pack: { pack_format: 22, description: 'synthetic font' } }),
		'assets/check/font/icons.json': JSON.stringify({ providers }),
		'assets/check/textures/font/icons.png': png(32, 16, (x, y) => (x < 16 ? wideGlyph(x, y) : narrowGlyph(x - 16, y))),
	}
}
const faces = () => Object.fromEntries(DIRECTIONS.map((d, i) => [d, { uv: [i * 2 + 0.5, 4, i * 2 + 1.5, 12], texture: 0 }]))

const elements: object[] = []
function group(name: string, origin: V, cube?: [V, V], children: (object | string)[] = [], extra: object = {}) {
	const kids: (object | string)[] = []
	if (cube) {
		const uuid = id()
		elements.push({ name, type: 'cube', uuid, from: cube[0], to: cube[1], origin, rotation: [0, 0, 0], faces: faces() })
		kids.push(uuid)
	}
	return { name, uuid: id(), origin, rotation: [0, 0, 0], children: [...kids, ...children], ...extra }
}
function locator(name: string, position: V, entity = '', nbt = '') {
	const uuid = id()
	elements.push({ name, type: 'locator', uuid, position, rotation: [0, 0, 0], rigel_entity: entity, rigel_entity_nbt: nbt })
	return uuid
}
const display = (name: string, origin: V, settings: object) => group(name, origin, undefined, [], { rigel_display: { scale: [1, 1, 1], nbt: '', ...settings } })

function key(channel: string, time: number, [x, y, z]: V, interpolation = 'linear', extra: object = {}) {
	return { channel, data_points: [{ x, y, z }], uuid: id(), time, color: -1, interpolation, ...extra }
}

// A keyframe of the variant track; 'default' is the original model.
const variantKey = (time: number, variant: string) => ({ channel: 'variant', data_points: [{ variant }], uuid: id(), time, color: -1, interpolation: 'linear' })

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
	const sword = display('sword', [4, 4, 0], { kind: 'item', item: 'minecraft:iron_sword', tag: '', mode: 'none', scale: [0.5, 0.5, 0.5] })
	const hand = group('hand', [4, 6, 0], [[3, 4, -1], [5, 6, 1]], [locator('tip', [4, 3, 0]), sword])
	const arm = group('arm', [4, 12, 0], [[3, 6, -1], [5, 12, 1]], [hand, locator('mark', [5, 9, 1], 'minecraft:marker', '{data:{check:1b}}')])
	const tailtip = group('tailtip', [0, 6, -8], [[-1, 5, -10], [1, 7, -8]])
	const tail = group('tail', [0, 6, -4], [[-1, 5, -8], [1, 7, -4]], [tailtip])
	// Keys that draw nothing, so the shots stay as they were.
	const gem = group('gem', [0, 16, 0], [[-1, 16, -1], [1, 18, 1]], [], { rigel_nbt: `{view_range:2f,CustomName:'"gem"'}` })
	const pivot = group('pivot', [0, 14, 0], undefined, [gem])
	const label = display('label', [0, 20, 0], {
		kind: 'text',
		text: '[{"text":"Rigel ","color":"gold","bold":true},{"text":"文字の表示"}]',
		lineWidth: 200,
		background: 0x40000000,
		defaultBackground: false,
		textOpacity: 255,
		shadow: true,
		seeThrough: false,
		alignment: 'center',
	})
	// Wrapped Japanese, decorations and the font of syntheticFontPack.
	const note = display('note', [-14, 2, 3], {
		kind: 'text',
		text: '[{"text":"折り返す長めの日本語","italic":true},{"text":" under","underlined":true},{"text":" strike ","strikethrough":true,"color":"aqua"},{"text":"\\uE000\\uF801\\uE001","font":"check:icons"}]',
		lineWidth: 64,
		background: 0x60204080,
		defaultBackground: false,
		textOpacity: 255,
		shadow: false,
		seeThrough: false,
		alignment: 'left',
		scale: [0.5, 0.5, 0.5],
	})
	// Behind the body, so that it hides nothing from the front.
	const ice = display('ice', [-8, 0, -28], { kind: 'block', block: 'minecraft:oak_stairs[facing=east,half=top]' })
	const body = group('body', [0, 8, 0], [[-3, 4, -2], [3, 12, 2]], [arm, tail, pivot, label, note, ice])

	const animation = (name: string, loop: string, length: number, animators: Record<string, object[]>, bones: Record<string, { uuid: string }>, variantKeys: object[] = []) => ({
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
		animators: {
			...Object.fromEntries(Object.entries(animators).map(([bone, keyframes]) => [bones[bone]!.uuid, { name: bone, type: 'bone', keyframes }])),
			...(variantKeys.length > 0 ? { effects: { name: 'effects', type: 'effect', keyframes: variantKeys } } : {}),
		},
	})
	const bones = { body, arm, hand, tail, tailtip, pivot, gem, ice }
	const palette = { name: 'palette.png', id: '0', uuid: id(), width: 16, height: 16, uv_width: 16, uv_height: 16, source: paletteDataUrl() }
	const paletteAlt = { name: 'palette_alt.png', id: '1', uuid: id(), width: 16, height: 16, uv_width: 16, uv_height: 16, source: paletteDataUrl(true) }
	const alt = id()
	const tip = id()

	return {
		meta: { format_version: '5.0', model_format: 'rigel', box_uv: false },
		name: 'synthetic',
		resolution: { width: 16, height: 16 },
		elements,
		outliner: [body],
		textures: [palette, paletteAlt],
		// alt leaves the tail as it is; tip changes only the hand and the gem.
		rigel_variants: [
			{ uuid: alt, name: 'alt', textures: [[palette.uuid, paletteAlt.uuid]], excluded: [tail.uuid], onApply: 'check:applied' },
			{ uuid: tip, name: 'tip', textures: [[palette.uuid, paletteAlt.uuid]], excluded: [body.uuid, arm.uuid, tail.uuid, tailtip.uuid, pivot.uuid], onApply: '' },
		],
		animations: [
			animation('curves', 'loop', 1.5, {
				body: [key('rotation', 0, [0, 0, 0], 'catmullrom'), key('rotation', 0.5, [10, 60, 0], 'catmullrom'), key('rotation', 1, [0, 120, 20], 'catmullrom'), key('rotation', 1.5, [0, 0, 0], 'catmullrom')],
				arm: [bezier(0, [0, 0, 0], [0, 0, 0], [0, 0, -40]), bezier(0.75, [0, 0, -80], [0, 0, -20], [0, 0, 20]), bezier(1.5, [0, 0, 0], [0, 0, -40], [0, 0, 0])],
				hand: [key('position', 0, [0, 0, 0], 'step'), key('position', 0.5, [0, 2, 0], 'step'), key('position', 1, [1, 0, 0], 'step')],
				pivot: [key('rotation', 0, [0, 0, 0]), key('rotation', 1.5, [0, 360, 0])],
			}, bones, [variantKey(0, alt), variantKey(0.5, tip), variantKey(1, 'default')]),
			animation('squash', 'loop', 1, {
				body: [key('scale', 0, [1, 1, 1]), key('scale', 0.5, [1.5, 0.7, 1.5]), key('scale', 1, [1, 1, 1])],
				arm: [key('rotation', 0, [0, 0, 0]), key('rotation', 1, [90, 45, 0])],
				tail: [key('scale', 0, [2, 1.5, 1]), key('scale', 1, [2, 1.5, 1])],
				tailtip: [key('rotation', 0, [0, 0, 0]), key('rotation', 1, [30, 60, 90])],
				ice: [key('scale', 0, [1, 1, 1]), key('scale', 0.5, [0.25, 0.25, 0.25]), key('scale', 1, [1, 1, 1])],
			}, bones, [variantKey(0.5, alt), variantKey(1, 'default')]),
			animation('hide', 'hold', 1, {
				tail: [key('scale', 0, [1, 1, 1]), key('scale', 0.5, [0, 0, 0]), key('scale', 1, [1, 1, 1])],
				arm: [key('scale', 0, [1, 1, 1]), key('scale', 1, [-1, 1, 1])],
			}, bones, [variantKey(0.25, alt), variantKey(0.5, tip), variantKey(0.52, 'default'), variantKey(1, alt)]),
			animation('eased', 'loop', 2, {
				body: [key('rotation', 0, [0, 0, 0], 'linear', eased('back', 'out')), key('rotation', 1, [0, 90, 0], 'linear', eased('elastic', 'inOut')), key('rotation', 2, [0, 0, 0])],
				arm: [key('rotation', 0, [0, 0, 0], 'catmullrom', eased('sine', 'inOut')), key('rotation', 0.7, [0, 0, -70], 'catmullrom', eased('back', 'in')), key('rotation', 1.4, [30, 0, -20], 'catmullrom'), key('rotation', 2, [0, 0, 0], 'catmullrom')],
				hand: [key('position', 0, [0, 0, 0], 'linear', eased('bounce', 'out')), key('position', 1, [0, 3, 0]), key('position', 2, [0, 0, 0])],
				tail: [key('scale', 0, [1, 1, 1], 'linear', { rigel_easing: { name: 'pop', curve: { type: 'bezier', x1: 0.3, y1: 1.6, x2: 0.6, y2: 1 } } }), key('scale', 2, [1.5, 1.5, 1.5])],
			}, bones),
			animation('once', 'once', 1.03, {
				body: [key('position', 0, [0, 0, 0]), key('position', 1.03, [0, 0, 8])],
				hand: [key('rotation', 0, [0, 0, 0], 'catmullrom'), key('rotation', 0.5, [45, 0, 0], 'catmullrom'), key('rotation', 1.03, [0, 0, 0], 'catmullrom')],
			}, bones, [variantKey(0.5, tip), variantKey(1.03, alt)]),
		],
	}
}
