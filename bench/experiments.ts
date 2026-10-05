// Experiments for choosing the data pack structure. Each experiment is one data pack whose modes are
// alternatives for one decision. Storage namespaces: rbench (work values written every tick),
// rbench_anim (animation values, written only by setup), rbench_sink (dry runs' throwaway target).
import { type Anim, frameWrite, layouts, Q, syntheticAnim, transformationMatrix, VALUES, writeCompound } from './anim'
import { boneUuid, type Experiment, type Files, fn, NS, rootUuid, summonRigs, uuidString } from './gen'

const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const bone = (r: number, b: number) => uuidString(boneUuid(r, b))
const root = (r: number) => uuidString(rootUuid(r))

// Mode k runs function m/k each tick; the frame counter #frame rb loops over the animation and is copied
// to storage for macros.
function modeFiles(modes: string[][], frames: number): Files {
	const files: Files = {
		[fn('tick')]: [
			'scoreboard players add #frame rb 1',
			`execute if score #frame rb matches ${frames}.. run scoreboard players set #frame rb 0`,
			'execute store result storage rbench:w args.f int 1 run scoreboard players get #frame rb',
			...modes.map((_, i) => `execute if score #mode rb matches ${i + 1} run function ${NS}:m/${i + 1}`),
		].join('\n'),
	}
	modes.forEach((lines, i) => (files[fn(`m/${i + 1}`)] = lines.join('\n')))
	return files
}

const boneScores = (rigs: number, bones: number) =>
	range(rigs).flatMap((r) => range(bones).map((b) => `scoreboard players set ${bone(r, b)} rb.bone ${b}`))

const EMPTY_WRITE = '{transformation:{translation:[0f,0f,0f],left_rotation:[0f,0f,0f,1f],scale:[1f,1f,1f],right_rotation:[0f,0f,0f,1f]},start_interpolation:0}'
const COMPONENTS: [string, number][] = [
	['translation', 0], ['translation', 1], ['translation', 2],
	['left_rotation', 0], ['left_rotation', 1], ['left_rotation', 2], ['left_rotation', 3],
	['scale', 0], ['scale', 1], ['scale', 2],
]
const macroWrite = (decimal: (key: string) => string) =>
	`{transformation:{translation:[${['a', 'b', 'c'].map(decimal)}],left_rotation:[${['d', 'e', 'f', 'g'].map(decimal)}],scale:[${['h', 'i', 'j'].map(decimal)}]},start_interpolation:0}`

// E2–E6: whole pipelines that take the current frame's values to every bone. Every pipeline has a dry
// variant whose last step writes to storage instead of the entity, so its own overhead is visible
// beside the much larger entity write.
export function pipelines(rigs: number, bones: number, frames = 40): Experiment {
	const anim: Anim = syntheticAnim(frames, bones)
	const files: Files = {}
	const modes: string[] = []
	const ticks: string[][] = []
	const add = (label: string, lines: string[]) => {
		modes.push(label)
		ticks.push(lines)
	}
	const perRig = (body: (r: number) => string[]) => range(rigs).flatMap(body)

	// fork: per passenger, bone_id score → macro reading "<bone>"."<frame>" and appending 10 floats to a
	// work compound, then one write of the transformation (no start_interpolation, as in the fork).
	for (const dry of [true, false]) {
		const name = `fork${dry ? '_dry' : ''}`
		files[fn(`${name}/bone`)] = [
			'execute store result storage rbench:w args.b int 1 run scoreboard players get @s rb.bone',
			`function ${NS}:${name}/apply with storage rbench:w args`,
		].join('\n')
		files[fn(`${name}/apply`)] = [
			'data modify storage rbench:w t set value {translation:[],left_rotation:[],scale:[],right_rotation:[0f,0f,0f,1f]}',
			...COMPONENTS.map(([c], v) => `$data modify storage rbench:w t.${c} append from storage rbench_anim:a fork."$(b)"."$(f)"[${v}]`),
			dry ? 'data modify storage rbench_sink:s v set from storage rbench:w t' : 'data modify entity @s transformation set from storage rbench:w t',
		].join('\n')
		add(name, perRig((r) => [`execute as ${root(r)} on passengers run function ${NS}:${name}/bone`]))
	}

	// Macro fetch of the current frame into rbench:w cur, shared by the pipelines below.
	files[fn('fetch/ints')] = '$data modify storage rbench:w cur set from storage rbench_anim:a frameInts[$(f)]'
	files[fn('fetch/writes')] = '$data modify storage rbench:w cur set from storage rbench_anim:a frameWrites[$(f)]'
	files[fn('fetch/named')] = '$data modify storage rbench:w cur set from storage rbench_anim:a frameNamed[$(f)]'
	const fetch = (layout: string) => `function ${NS}:fetch/${layout} with storage rbench:w args`

	// Per-bone functions addressed by fixed UUID; ints restored with execute store … float 0.0001.
	for (const dry of [true, false])
		for (let r = 0; r < rigs; r++)
			files[fn(`ints${dry ? '_dry' : ''}/r${r}`)] = range(bones)
				.flatMap((b) => [
					...COMPONENTS.map(([c, i], v) => `execute store result storage rbench:w wt.transformation.${c}[${i}] float 0.0001 run data get storage rbench:w cur[${b * VALUES + v}]`),
					dry ? 'data modify storage rbench_sink:s v set from storage rbench:w wt' : `data modify entity ${bone(r, b)} {} merge from storage rbench:w wt`,
				])
				.join('\n')
	for (const dry of [true, false]) {
		const suffix = dry ? '_dry' : ''
		add(`uuid+ints+store${suffix}`, perRig((r) => [fetch('ints'), `function ${NS}:ints${suffix}/r${r}`]))
		// Same, but the frame comes from a per-rig copy of the animation consumed from the front.
		add(`uuid+ints+store, pop${suffix}`, perRig((r) => [
			`data modify storage rbench:w cur set from storage rbench:w q${r}[0]`,
			`data remove storage rbench:w q${r}[0]`,
			`execute unless data storage rbench:w q${r}[0] run data modify storage rbench:w q${r} set from storage rbench_anim:a frameInts`,
			`function ${NS}:ints${suffix}/r${r}`,
		]))
	}

	// Values kept as the compound written to the entity (method 3): no restoring at all.
	for (const dry of [true, false]) {
		const suffix = dry ? '_dry' : ''
		for (let r = 0; r < rigs; r++)
			files[fn(`writes${suffix}/r${r}`)] = range(bones)
				.map((b) => (dry ? `data modify storage rbench_sink:s v set from storage rbench:w cur[${b}]` : `data modify entity ${bone(r, b)} {} merge from storage rbench:w cur[${b}]`))
				.join('\n')
		add(`uuid+writes${suffix}`, perRig((r) => [fetch('writes'), `function ${NS}:writes${suffix}/r${r}`]))
	}
	// Values kept as the transformation alone, copied into the work compound before each write.
	files[fn('fetch/transforms')] = '$data modify storage rbench:w cur set from storage rbench_anim:a frameTransforms[$(f)]'
	for (const dry of [true, false]) {
		const suffix = dry ? '_dry' : ''
		for (let r = 0; r < rigs; r++)
			files[fn(`transforms${suffix}/r${r}`)] = range(bones)
				.flatMap((b) => [
					`data modify storage rbench:w wt.transformation set from storage rbench:w cur[${b}]`,
					dry ? 'data modify storage rbench_sink:s v set from storage rbench:w wt' : `data modify entity ${bone(r, b)} {} merge from storage rbench:w wt`,
				])
				.join('\n')
		add(`uuid+transforms${suffix}`, perRig((r) => [fetch('transforms'), `function ${NS}:transforms${suffix}/r${r}`]))
	}
	// 2(c): one dummy-macro function per frame, called with constant arguments so that after the first lap
	// the macro cache serves the parsed frame and each tick only copies it into cur.
	for (let f = 0; f < frames; f++) files[fn(`fr/${f}`)] = `$data modify storage rbench:w cur set value ${frameWrite(anim, f)}$(_)`
	files[fn('fetch/frame')] = `$function ${NS}:fr/$(f) {_:""}`
	add('frame functions+uuid+writes', perRig((r) => [`function ${NS}:fetch/frame with storage rbench:w args`, `function ${NS}:writes/r${r}`]))
	// One dummy-macro function per animation, called with constant arguments when the copy runs out; each
	// tick takes the front frame of the copy.
	for (let r = 0; r < rigs; r++) files[fn(`anim/a${r}`)] = `$data modify storage rbench:w q${r}w set value ${layouts.frameWrites(anim)}$(_)`
	add('anim function+pop+uuid+writes', perRig((r) => [
		`execute unless data storage rbench:w q${r}w[0] run function ${NS}:anim/a${r} {_:""}`,
		`data modify storage rbench:w cur set from storage rbench:w q${r}w[0]`,
		`data remove storage rbench:w q${r}w[0]`,
		`function ${NS}:writes/r${r}`,
	]))
	// Passenger order instead of UUIDs: each passenger takes the front entry of cur.
	for (const dry of [true, false]) {
		const suffix = dry ? '_dry' : ''
		files[fn(`pop${suffix}/bone`)] = [
			dry ? 'data modify storage rbench_sink:s v set from storage rbench:w cur[0]' : 'data modify entity @s {} merge from storage rbench:w cur[0]',
			'data remove storage rbench:w cur[0]',
		].join('\n')
		add(`passengers+writes${suffix}`, perRig((r) => [fetch('writes'), `execute as ${root(r)} on passengers run function ${NS}:pop${suffix}/bone`]))
	}

	// Method 1: one macro per bone that writes `<int>e-4f` literals.
	for (const dry of [true, false]) {
		const suffix = dry ? '_dry' : ''
		files[fn(`macro${suffix}/w`)] = dry
			? `$data modify storage rbench_sink:s v set value ${macroWrite((k) => `$(${k})e-4f`)}`
			: `$data merge entity @s ${macroWrite((k) => `$(${k})e-4f`)}`
		for (let r = 0; r < rigs; r++)
			files[fn(`macro${suffix}/r${r}`)] = range(bones).map((b) => `execute as ${bone(r, b)} run function ${NS}:macro${suffix}/w with storage rbench:w cur.b${b}`).join('\n')
		add(`uuid+macro${suffix}`, perRig((r) => [fetch('named'), `function ${NS}:macro${suffix}/r${r}`]))
	}

	const setup = [
		summonRigs({ rigs, bones, tags: 0 }),
		...boneScores(rigs, bones),
		`data modify storage rbench:w wt set value ${EMPTY_WRITE}`,
		`data modify storage rbench_anim:a frameInts set value ${layouts.frameInts(anim)}`,
		`data modify storage rbench_anim:a frameWrites set value ${layouts.frameWrites(anim)}`,
		`data modify storage rbench_anim:a frameTransforms set value ${layouts.frameTransforms(anim)}`,
		`data modify storage rbench_anim:a frameNamed set value ${layouts.frameNamed(anim)}`,
		`data modify storage rbench_anim:a fork set value ${layouts.fork(anim)}`,
		...range(rigs).map((r) => `data modify storage rbench:w q${r} set from storage rbench_anim:a frameInts`),
	].join('\n')
	return { name: 'pipelines', modes, setup, bones: rigs * bones, files: { ...files, ...modeFiles(ticks, frames) } }
}

// E12: forms of the one entity write, under the same conditions. Each tick alternates between two frames
// so every write changes the value.
export function writeForms(rigs: number, bones: number, options: { model?: boolean; ride?: boolean } = {}): Experiment {
	const anim = syntheticAnim(2, bones, 5)
	const at = (b: number, f: number) => anim.values.subarray((f * bones + b) * VALUES, (f * bones + b + 1) * VALUES)
	const files: Files = {}
	const forms: [string, (r: number, b: number, f: number) => string[]][] = [
		['data merge entity (literal)', (r, b, f) => [`data merge entity ${bone(r, b)} ${writeCompound(at(b, f))}`]],
		['data merge entity (literal matrix)', (r, b, f) => [`data merge entity ${bone(r, b)} {transformation:${transformationMatrix(at(b, f))},start_interpolation:0}`]],
		['modify {} merge from storage', (r, b, f) => [`data modify entity ${bone(r, b)} {} merge from storage rbench_anim:a w[${f}][${b}]`]],
		['modify {} merge value (literal)', (r, b, f) => [`data modify entity ${bone(r, b)} {} merge value ${writeCompound(at(b, f))}`]],
		['set transformation only (no interpolation)', (r, b, f) => [`data modify entity ${bone(r, b)} transformation set from storage rbench_anim:a full[${f}][${b}]`]],
		['set transformation + set start_interpolation', (r, b, f) => [
			`data modify entity ${bone(r, b)} transformation set from storage rbench_anim:a full[${f}][${b}]`,
			`data modify entity ${bone(r, b)} start_interpolation set value 0`,
		]],
	]
	// Bones that do not ride the root have to be moved with it; this mode is that cost alone.
	if (options.ride === false)
		forms.push(['tp every bone (no write)', (r, b, f) => [`tp ${bone(r, b)} ${r * 4 + f * 0.25} -60 0`]])
	const ticks = forms.map(([, lines], m) => {
		for (const f of [0, 1]) files[fn(`wf/${m}_${f}`)] = range(rigs).flatMap((r) => range(bones).flatMap((b) => lines(r, b, f))).join('\n')
		return [`execute if score #p rb matches 0 run function ${NS}:wf/${m}_0`, `execute if score #p rb matches 1 run function ${NS}:wf/${m}_1`]
	})
	const tick = modeFiles(ticks, 1)
	tick[fn('tick')] = [tick[fn('tick')]!, 'scoreboard players add #p rb 1', 'execute if score #p rb matches 2 run scoreboard players set #p rb 0'].join('\n')
	return {
		name: 'write-forms',
		modes: forms.map(([label]) => label),
		setup: [
			summonRigs({ rigs, bones, tags: 0, item: { model: options.model ?? true }, ride: options.ride }),
			`data modify storage rbench_anim:a w set value ${layouts.frameWrites(anim)}`,
			`data modify storage rbench_anim:a full set value ${layouts.frameTransformsFull(anim)}`,
		].join('\n'),
		bones: rigs * bones,
		files: { ...files, ...tick },
	}
}

// E3: only the step that reaches each bone, with a trivial storage copy as the per-bone work.
export function dispatch(rigs: number, bones: number): Experiment {
	const files: Files = {}
	const work = (index: string) => `data modify storage rbench_sink:s v set from storage rbench:w cur[${index}]`
	files[fn('d/pop')] = ['data modify storage rbench_sink:s v set from storage rbench:w q[0]', 'data remove storage rbench:w q[0]'].join('\n')
	files[fn('d/macro')] = ['execute store result storage rbench:w args.b int 1 run scoreboard players get @s rb.bone', `function ${NS}:d/macro_w with storage rbench:w args`].join('\n')
	files[fn('d/macro_w')] = `$${work('$(b)')}`
	// Binary search over the bone_id score down to a leaf that knows its index.
	const tree = (lo: number, hi: number): string => {
		const name = `d/tree/${lo}_${hi}`
		if (lo === hi) files[fn(name)] = work(String(lo))
		else {
			const mid = (lo + hi) >> 1
			files[fn(name)] = [
				`execute if score @s rb.bone matches ..${mid} run return run function ${NS}:${tree(lo, mid)}`,
				`function ${NS}:${tree(mid + 1, hi)}`,
			].join('\n')
		}
		return name
	}
	const treeRoot = tree(0, bones - 1)
	for (let r = 0; r < rigs; r++) files[fn(`d/uuid/r${r}`)] = range(bones).map((b) => `execute as ${bone(r, b)} run ${work(String(b))}`).join('\n')
	const perRig = (body: (r: number) => string[]) => range(rigs).flatMap(body)
	const ticks = [
		perRig((r) => ['data modify storage rbench:w q set from storage rbench:w list', `execute as ${root(r)} on passengers run function ${NS}:d/pop`]),
		perRig((r) => [`execute as ${root(r)} on passengers run function ${NS}:${treeRoot}`]),
		perRig((r) => [`execute as ${root(r)} on passengers run function ${NS}:d/macro`]),
		perRig((r) => [`function ${NS}:d/uuid/r${r}`]),
	]
	const setup = [
		summonRigs({ rigs, bones, tags: 0 }),
		...boneScores(rigs, bones),
		`data modify storage rbench:w list set value [${range(bones).join(',')}]`,
		'data modify storage rbench:w cur set from storage rbench:w list',
	].join('\n')
	return {
		name: `dispatch-${bones}`,
		modes: ['passenger order', 'bone_id binary search', 'bone_id macro (fork)', 'fixed UUID'],
		setup,
		bones: rigs * bones,
		files: { ...files, ...modeFiles(ticks, 1) },
	}
}

// E7: reaching each root once per tick with other entities around.
export function rootSearch(rigs: number, others: number): Experiment {
	const work = 'scoreboard players add #c rb 1'
	const setup = [
		summonRigs({ rigs, bones: 1, tags: 0 }),
		// Background entities spread over the spawn area.
		...range(others).map((i) => `summon marker ${(i % 50) - 25} -60 ${Math.floor(i / 50) - 50} {Tags:["rb"]}`),
	].join('\n')
	const ticks = [
		range(rigs).map((r) => `execute as ${root(r)} run ${work}`),
		[`execute positioned 0 -60 0 as @e[type=item_display,tag=rb.root,distance=..48] run ${work}`],
		[`execute as @e[type=item_display,tag=rb.root] run ${work}`],
	]
	return { name: `roots-${others}`, modes: ['fixed UUID slots', 'distance from a player', 'all entities'], setup, bones: rigs, files: modeFiles(ticks, 1) }
}

// Frame functions as dummy macros that are called once before playback, so that playback is served from
// the macro cache. `direct`: one line per bone that writes the entity, behind a guard that returns before
// the writes while #warm is 1. `storage`: one line per rig that copies the frame into rbench:w c<rig>,
// written to the bones from there.
const WARM_GUARD = 'execute if score #warm rb matches 1 run return 0'
type WarmForm = 'direct' | 'storage'
// How a direct line writes its values: decimal places kept, and whether the scale list is written.
interface LineShape {
	decimals: number
	scale: boolean
	matrix?: boolean
	// The fixed words of a matrix line come from macro arguments (WRAP_ARGS) instead of the line text.
	wrap?: boolean
}
const FULL_LINE: LineShape = { decimals: 4, scale: true }
const WRAP_ARGS = '{m:"data merge entity",t:"transformation",s:"start_interpolation:0"}'
function warmFrame(form: WarmForm, anim: Anim, f: number, rigs: number, macro: boolean, target = bone, shape = FULL_LINE): string {
	const at = (b: number) => anim.values.subarray((f * anim.bones + b) * VALUES, (f * anim.bones + b + 1) * VALUES)
	// The argument goes where any digit keeps the line valid: after start_interpolation:0, or after the
	// storage key. Called with {_:""} the line is the plain one.
	const [head, arg] = macro ? ['$', '$(_)'] : ['', '']
	if (form === 'storage') return range(rigs).map((r) => `${head}data modify storage rbench:w c${r}${arg} set value ${frameWrite(anim, f)}`).join('\n')
	if (shape.wrap) return range(rigs).flatMap((r) => range(anim.bones).map((b) => `$$(m) ${target(r, b)} {$(t):${transformationMatrix(at(b), shape.decimals)},$(s)}`)).join('\n')
	const list = (vs: ArrayLike<number>) => `[${Array.from(vs, (v) => `${Number((v / Q).toFixed(shape.decimals))}f`).join(',')}]`
	const write = (c: Int32Array) =>
		shape.matrix ? `{transformation:${transformationMatrix(c, shape.decimals)},start_interpolation:0${arg}}` :
		`{transformation:{translation:${list(c.subarray(0, 3))},left_rotation:${list(c.subarray(3, 7))}${shape.scale ? `,scale:${list(c.subarray(7, 10))}` : ''}},start_interpolation:0${arg}}`
	return range(rigs).flatMap((r) => range(anim.bones).map((b) => `${head}data merge entity ${target(r, b)} ${write(at(b))}`)).join('\n')
}

// Warming: the parse on a dummy macro's first call (arguments cycled through 10 values so the cache never
// serves it), and playback once warmed, beside the plain-line form.
export function warmPlayback(rigs: number, bones: number): Experiment {
	const anim = syntheticAnim(2, bones, 11)
	const absent = (r: number, b: number) => bone(r + 10, b)
	const files: Files = {
		[fn('wp/s')]: warmFrame('storage', anim, 0, rigs, true),
		[fn('wp/g')]: [WARM_GUARD, warmFrame('direct', anim, 0, rigs, true)].join('\n'),
		[fn('wp/u')]: warmFrame('direct', anim, 0, rigs, true, absent),
		[fn('wp/w')]: range(rigs).flatMap((r) => range(bones).map((b) => `data modify entity ${bone(r, b)} {} merge from storage rbench:w c${r}[${b}]`)).join('\n'),
	}
	for (const f of [0, 1]) {
		files[fn(`wp/c${f}`)] = warmFrame('direct', anim, f, rigs, true)
		files[fn(`wp/p${f}`)] = warmFrame('direct', anim, f, rigs, false)
		files[fn(`wp/f${f}`)] = warmFrame('storage', anim, f, rigs, true)
	}
	const alternate = (call: (f: number) => string[]) => [0, 1].flatMap((f) => call(f).map((line) => `execute if score #p rb matches ${f} run ${line}`))
	const ticks = [
		[`function ${NS}:wp/s with storage rbench:w ld`],
		[`function ${NS}:wp/g with storage rbench:w ld`],
		[`function ${NS}:wp/u with storage rbench:w ld`],
		alternate((f) => [`function ${NS}:wp/c${f} {_:""}`]),
		alternate((f) => [`function ${NS}:wp/p${f}`]),
		alternate((f) => [`function ${NS}:wp/f${f} {_:""}`, `function ${NS}:wp/w`]),
	]
	const tick = modeFiles(ticks, 1)
	tick[fn('tick')] = [
		'scoreboard players add #ld rb 1',
		'execute if score #ld rb matches 10.. run scoreboard players set #ld rb 0',
		'execute store result storage rbench:w ld._ int 1 run scoreboard players get #ld rb',
		tick[fn('tick')]!,
		'scoreboard players add #p rb 1',
		'execute if score #p rb matches 2 run scoreboard players set #p rb 0',
	].join('\n')
	return {
		name: 'warm-playback',
		modes: [
			'storage frame, first call (parse)',
			'direct lines, first call, guarded (parse)',
			'direct lines, first call, entities absent (parse + failed writes)',
			'direct lines, warmed (writes)',
			'plain direct lines (writes)',
			'storage frame, warmed, then writes from storage',
		],
		setup: [summonRigs({ rigs, bones, tags: 0 }), 'scoreboard players set #warm rb 1'].join('\n'),
		bones: rigs * bones,
		files: { ...files, ...tick },
	}
}

export const WARM_FILLS = {
	direct: { form: 'direct', macro: true, shape: FULL_LINE },
	'direct, no scale': { form: 'direct', macro: true, shape: { decimals: 4, scale: false } },
	'direct, 2 decimals': { form: 'direct', macro: true, shape: { decimals: 2, scale: true } },
	'direct, matrix': { form: 'direct', macro: true, shape: { decimals: 4, scale: true, matrix: true } },
	'direct, matrix, wrapped words': { form: 'direct', macro: true, shape: { decimals: 4, scale: true, matrix: true, wrap: true } },
	'plain direct lines': { form: 'direct', macro: false, shape: FULL_LINE },
	storage: { form: 'storage', macro: true, shape: FULL_LINE },
} as const satisfies Record<string, { form: WarmForm; macro: boolean; shape: LineShape }>

// Heap of `frames` frame functions of 250 bones. The setup calls each macro once with constant arguments;
// plain functions are parsed by /reload and not called.
export function warmFill(kind: keyof typeof WARM_FILLS, frames: number): Experiment {
	const { form, macro, shape } = WARM_FILLS[kind]
	const anim = syntheticAnim(frames, 250, 13)
	const files: Files = { [fn('tick')]: '' }
	for (let f = 0; f < frames; f++) {
		const lines = warmFrame(form, anim, f, 1, macro, bone, shape)
		files[fn(`wm/${f}`)] = form === 'direct' && macro ? [WARM_GUARD, lines].join('\n') : lines
	}
	return {
		name: `warm-fill-${kind}`,
		modes: [],
		setup: macro ? ['scoreboard players set #warm rb 1', ...range(frames).map((f) => `function ${NS}:wm/${f} ${'wrap' in shape && shape.wrap ? WRAP_ARGS : '{_:""}'}`), 'data remove storage rbench:w c0'].join('\n') : '',
		bones: 0,
		files,
	}
}

export type LoadForm = 'frameInts' | 'boneInts' | 'frameNamed' | 'frameWrites' | 'frameTransforms' | 'fork'

// E5/E8: one staged-load step — a dummy-macro line holding `cells` cells — run every tick. The macro
// argument cycles through 10 values so the 8-entry expansion cache never serves it.
// With `cached` the argument is constant, so after the first call only the copy of the parsed value is left.
export function loadStep(steps: { form: LoadForm; cells: number; cached?: boolean }[]): Experiment {
	const files: Files = {}
	const ticks: string[][] = []
	const modes: string[] = []
	steps.forEach(({ form, cells, cached }, i) => {
		const bones = Math.min(cells, 250)
		const anim = syntheticAnim(Math.ceil(cells / bones), bones, i + 1)
		files[fn(`ld/${i}`)] = `$data modify storage rbench_anim:ld v$(_) set value ${layouts[form](anim)}`
		modes.push(`${form} ${cells} cells${cached ? ', cached' : ''}`)
		ticks.push([cached ? `function ${NS}:ld/${i} {_:""}` : `function ${NS}:ld/${i} with storage rbench:w ld`])
	})
	const tick = modeFiles(ticks, 1)
	tick[fn('tick')] = [
		'scoreboard players add #ld rb 1',
		'execute if score #ld rb matches 10.. run scoreboard players set #ld rb 0',
		'execute store result storage rbench:w ld._ int 1 run scoreboard players get #ld rb',
		tick[fn('tick')]!,
	].join('\n')
	return { name: 'load', modes, setup: summonRigs({ rigs: 1, bones: 1, tags: 0 }), bones: 1, files: { ...files, ...tick } }
}

// E8: /reload with `cells` cells of load functions, 1,000 cells per file. With `macro` the lines are
// dummy-macro lines that /reload leaves unparsed.
export function reloadPack(cells: number, macro: boolean): Experiment {
	const files: Files = {}
	for (let i = 0; i * 1000 < cells; i++) {
		const anim = syntheticAnim(4, 250, i + 1)
		files[fn(`rl/${i}`)] = macro ? `$data modify storage rbench_anim:rl v${i}$(_) set value ${layouts.frameInts(anim)}` : `data modify storage rbench_anim:rl v${i} set value ${layouts.frameInts(anim)}`
	}
	return { name: `reload-${macro ? 'macro' : 'plain'}`, modes: [], setup: summonRigs({ rigs: 1, bones: 1, tags: 0 }), bones: 1, files: { ...files, [fn('tick')]: '' } }
}

// E5 memory and E9 saving: fills storage with `cells` cells of one layout under `namespace`, and writes
// one small value to rbench:w every tick.
// With `macro` the setup fills storage through a dummy-macro function called with constant arguments.
export function storageFill(form: LoadForm, cells: number, namespace: string, macro = false): Experiment {
	const bones = 250
	const frames = Math.ceil(cells / bones)
	const anim = syntheticAnim(frames, bones, 7)
	const fill = `data modify storage ${namespace}:a v set value ${layouts[form](anim)}`
	return {
		name: `fill-${form}-${namespace}${macro ? '-macro' : ''}`,
		modes: [],
		setup: [summonRigs({ rigs: 1, bones: 1, tags: 0 }), macro ? `function ${NS}:fill {_:""}` : fill].join('\n'),
		bones: 1,
		files: {
			[fn('tick')]: 'execute store result storage rbench:w t int 1 run scoreboard players add #frame rb 1',
			...(macro ? { [fn('fill')]: `$${fill}$(_)` } : {}),
		},
	}
}
