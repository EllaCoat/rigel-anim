import { planChunks, type FrameWrite, type Poses, type WarmItem } from './frames'
import { WARM_PRIORITIES, type Files, type Loop, type WarmPriority } from './types'

export const NAMESPACE = 'rigel'
export const COMMON_PACK = 'rigel'
// The function paths and storages the common pack uses under the namespace, and its folder.
export const RESERVED_RIG_NAMES = ['core', 'const', 'warm', COMMON_PACK]
// Written into every pack folder the export creates; only folders with it are replaced. Each pack
// writes it first, so a folder cut short by a failed write can still be replaced next time.
export const MARKER = 'rigel.json'

const PACK_FORMAT = 26
const OBJECTIVES = ['Rigel.Frame', 'Rigel.Playing', 'Rigel.PlayedAt', 'Rigel.Warming', 'Rigel.Temp', 'Rigel.Wait']
const FRAME_ARGS = 'rigel:const FrameArgs'
const LIST: Record<WarmPriority, string> = { xhigh: 'XHigh', high: 'High', low: 'Low' }
// Ticks; an interpolation this long does not visibly move.
const HOLD = 1_000_000_000
// A tween takes turns between these, so its shadow_strength differs from what every bone holds, the last tween's
// included, and every bone restarts its interpolation from the pose the client shows: a block or text display otherwise
// replays its last interpolation when its pose stays the same.
const TWEEN_SHADOWS = ['.998f', '.997f'] as const

const fn = (path: string) => `data/${NAMESPACE}/functions/${path}.mcfunction`
const json = (value: unknown) => `${JSON.stringify(value, null, '\t')}\n`
const text = (lines: string[]) => `${lines.join('\n')}\n`

export const hexId = (id: number) => (id >>> 0).toString(16).padStart(8, '0')

// Entity n of the rig: 0 is the root, renderable bones follow from 1. The third group stays 0, which
// the version-4 UUIDs Minecraft gives entities never have.
export function uuidString(id: number, n: number): string {
	return `${hexId(id)}-0-0-0-${n.toString(16)}`
}

function uuidNbt(id: number, n: number): string {
	return `[I;${id | 0},0,0,${n}]`
}

function objectives(): string[] {
	return OBJECTIVES.map((o) => `scoreboard objectives add ${o} dummy`)
}

export interface PassengerInput {
	// The summon compound's keys without UUID, Tags and the transformation.
	nbt: string
	// Displays get a tag with their name so other packs can select them.
	name?: string
	rest: string
}

export interface LocatorInput {
	name: string
	entity?: { type: string; nbt: string }
	// x,y,z as locatorString writes it.
	rest: string
}

export interface VariantInput {
	name: string
	// Passenger indices and the CustomModelData each gets.
	writes: { passenger: number; cmd: number }[]
	onApply: string
}

export interface RigPackInput {
	rig: string
	id: number
	chunkLines: number
	teleportDuration: number
	passengers: PassengerInput[]
	locators: LocatorInput[]
	variants: VariantInput[]
	animations: {
		name: string
		loop: Loop
		priority: WarmPriority
		poses: Poses
		frames: FrameWrite[][]
		// [frame][locator]: x,y,z, with a loop's last frame already showing frame 0.
		locators: string[][]
		// frame → the variant its function applies.
		variants?: ReadonlyMap<number, string>
		// frame → the bones a tween to it finishes the run of (planEntries).
		entries?: ReadonlyMap<number, FrameWrite[]>
	}[]
}

const hasRuns = (a: RigPackInput['animations'][number]) => a.frames.some((writes) => writes.some((w) => w.duration > 1))

export function rigPack(p: RigPackInput): Files {
	const files: Files = new Map()
	const self = `$Rigel.${p.rig}`
	const root = uuidString(p.id, 0)
	const bone = (b: number) => uuidString(p.id, b + 1)
	const id = (path: string) => `${NAMESPACE}:${p.rig}/${path}`
	const write = (path: string, lines: string[]) => files.set(fn(`${p.rig}/${path}`), text(lines))
	const warmingCheck = `execute if score ${self} Rigel.Warming matches 1 run return 0`
	// f/0 restores the shadow_strength stop, pause and tween change, and the interpolation length a tween or
	// restart leaves. PortalCooldown keeps the frame a run ends at for restart; display entities neither count it down nor send it.
	const head = (f: number, w: FrameWrite, runs: boolean) =>
		f === 0 ? 'shadow_strength:1f,PortalCooldown:0,interpolation_duration:1,' : !runs ? '' : w.duration > 1 ? `PortalCooldown:${f + w.duration - 1},interpolation_duration:${w.duration},` : `interpolation_duration:${w.duration},`
	// f/0 and rest leave start_interpolation out: sent with an unchanged pose, it makes the client replay its last
	// interpolation (Display.tick).
	const headArgs = `rigel:${p.rig}`
	const tail = (f: number) => (f === 0 ? '$(s)' : '$(_)')
	// A changed shadow_strength (not drawn while shadow_radius is 0) restarts the client's interpolation from the
	// pose it shows (Display.createInterpolatedRenderState), and HOLD keeps it there.
	const hold = `execute as ${root} on passengers run data merge entity @s {shadow_strength:.999f,interpolation_duration:${HOLD},start_interpolation:0}`
	// While a tween runs frames 0 to its frame, their variants wait for it to arrive.
	const seeking = 'execute unless score $Rigel.Seek Rigel.Temp matches 1 run '
	const tags = `"rigel","rigel.${p.rig}"`
	const locatorEntity = (l: number) => uuidString(p.id, p.passengers.length + 1 + l)
	const storage = `rigel:${p.rig}`
	const placeLocator = (l: number, at: string) => {
		const locator = p.locators[l]!
		const [x, y, z] = at.split(',')
		const lines = [`data modify storage ${storage} Locators.${locator.name} set value {x:${x}d,y:${y}d,z:${z}d}`]
		if (locator.entity) lines.push(`execute at ${root} run tp ${locatorEntity(l)} ^${x} ^${y} ^${z} ~ ~`)
		return lines
	}

	files.set(MARKER, json({ generator: 'rigel', rig: p.rig, id: hexId(p.id) }))
	files.set('pack.mcmeta', json({ pack: { pack_format: PACK_FORMAT, description: `rigel: ${p.rig}` } }))
	files.set('data/minecraft/tags/functions/load.json', json({ values: [id('load')] }))
	files.set('data/minecraft/tags/functions/tick.json', json({ values: [id('tick')] }))

	// f/0 of every animation is warmed first within a priority: play writes it on the tick it is called.
	const heads: Record<WarmPriority, WarmItem[]> = { xhigh: [], high: [], low: [] }
	const rests: Record<WarmPriority, WarmItem[]> = { xhigh: [], high: [], low: [] }
	p.animations.forEach((animation, a) => {
		const last = animation.frames.length - 1
		const runs = hasRuns(animation)
		animation.frames.forEach((writes, f) => {
			const lines = [warmingCheck]
			for (const w of writes) lines.push(`$data merge entity ${bone(w.bone)} {${head(f, w, runs)}transformation:[${animation.poses[w.pose]![w.bone]}${tail(f)}`)
			animation.locators[f]?.forEach((at, l) => {
				if (f === 0 || at !== animation.locators[f - 1]![l]) lines.push(...placeLocator(l, at))
			})
			const variant = animation.variants?.get(f)
			if (variant) lines.push(`${seeking}function ${id(`variant/${variant}`)}`)
			if (f === last) {
				if (animation.loop === 'loop' && last > 0) lines.push(`scoreboard players set ${self} Rigel.Frame 0`)
				else if (animation.loop !== 'once') lines.push(`scoreboard players set ${self} Rigel.Playing 0`)
			}
			write(`frames/${a}/${f}`, lines)
			if (writes.length > 0) (f === 0 ? heads : rests)[animation.priority].push({ animation: a, frame: f, lines: writes.length })
		})
		if (animation.loop === 'once') write(`frames/${a}/${last + 1}`, [warmingCheck, `function ${id('rest')}`, `scoreboard players set ${self} Rigel.Playing 0`])
		// A tween to the last frame arrives with the frame after it.
		else if (!(animation.loop === 'loop' && last > 0)) write(`frames/${a}/${last + 1}`, [`scoreboard players set ${self} Rigel.Playing 0`])
	})

	const registrations: string[] = []
	for (const priority of WARM_PRIORITIES) {
		const list = `rigel:warm ${LIST[priority]}`
		const chunks = planChunks([...heads[priority], ...rests[priority]], p.chunkLines)
		chunks.forEach((chunk, c) => {
			write(`warm/${priority}/${c}`, [
				`scoreboard players set ${self} Rigel.Warming 1`,
				...chunk.map((item) => `function ${id(`frames/${item.animation}/${item.frame}`)} with storage ${item.frame === 0 ? headArgs : FRAME_ARGS}`),
				`scoreboard players set ${self} Rigel.Warming 0`,
				c + 1 < chunks.length ? `data modify storage ${list}[0].Chunk set value ${c + 1}` : `data remove storage ${list}[0]`,
				'return 1',
			])
		})
		if (chunks.length > 0) registrations.push(`data modify storage ${list} append value {Rig:"${p.rig}",Tier:"${priority}",Chunk:0}`)
	}
	write('load', [
		...objectives(),
		...WARM_PRIORITIES.map((priority) => `data remove storage rigel:warm ${LIST[priority]}[{Rig:"${p.rig}"}]`),
		...registrations,
		`data modify storage ${headArgs} s set value ",0f,0f,0f,1f]}"`,
		`scoreboard players set ${self} Rigel.Warming 0`,
		...(registrations.length > 0 ? ['scoreboard players set $Rigel.Warm Rigel.Warming 1'] : []),
	])

	write('tick', [
		`execute unless score ${self} Rigel.Playing matches 1 run return 0`,
		'execute store result score $Rigel.Now Rigel.PlayedAt run time query gametime',
		`execute if score ${self} Rigel.PlayedAt = $Rigel.Now Rigel.PlayedAt run return 0`,
		// A tween waits out its ticks, then arrives on the tick that writes the frame after its own.
		`execute if score ${self} Rigel.Wait matches 2.. run return run scoreboard players remove ${self} Rigel.Wait 1`,
		`execute if score ${self} Rigel.Wait matches 1 run function ${id('tween/arrive')} with storage rigel:${p.rig}`,
		`execute store result storage rigel:${p.rig} Frame int 1 run scoreboard players add ${self} Rigel.Frame 1`,
		`function ${id('next')} with storage rigel:${p.rig}`,
	])
	write('next', [`$function ${id('frames')}/$(Animation)/$(Frame) with storage ${FRAME_ARGS}`])

	const count = p.animations.length
	const noSuchId = `tellraw @a [{"text":"[rigel] ${p.rig}: no animation with ID ","color":"red"},{"score":{"name":"$Rigel.ID","objective":"Rigel.Temp"},"color":"red"}]`
	const unless = count > 0 ? `execute unless score $Rigel.ID Rigel.Temp matches 0..${count - 1} run ` : ''
	const checkId = ['$scoreboard players set $Rigel.ID Rigel.Temp $(ID)', `${unless}${noSuchId}`, `${unless}return fail`]
	write('play', [
		...p.animations.map((a, i) => `# ${i}: ${a.name.replace(/[\r\n]+/g, ' ')}`),
		...checkId,
		`$data modify storage rigel:${p.rig} Animation set value $(ID)`,
		`scoreboard players set ${self} Rigel.Frame 0`,
		`scoreboard players set ${self} Rigel.Wait 0`,
		`scoreboard players set ${self} Rigel.Playing 1`,
		`execute store result score ${self} Rigel.PlayedAt run time query gametime`,
		`$function ${id('frames')}/$(ID)/0 with storage ${headArgs}`,
	])
	write('stop', [`scoreboard players set ${self} Rigel.Playing 0`, hold])
	write('pause', [`execute unless score ${self} Rigel.Playing matches 1 run return fail`, `scoreboard players set ${self} Rigel.Playing 2`, hold])
	write('restart', [
		`execute unless score ${self} Rigel.Playing matches 2 run return fail`,
		`scoreboard players set ${self} Rigel.Playing 1`,
		// Rigel.Frame is 0 on the tick of play and after a loop's last frame, when every run has ended. While a tween
		// waits, every bone's run ends at its frame and the tween arrives Rigel.Wait ticks away, as the frame after a run's
		// end is written: the frame now is Rigel.Wait - 1 before its own.
		`scoreboard players operation $Rigel.At Rigel.Temp = ${self} Rigel.Frame`,
		`execute unless score ${self} Rigel.Wait matches 1.. if score $Rigel.At Rigel.Temp matches 0 run scoreboard players set $Rigel.At Rigel.Temp 2147483647`,
		`scoreboard players operation $Rigel.At Rigel.Temp -= ${self} Rigel.Wait`,
		`execute if score ${self} Rigel.Wait matches 1.. run scoreboard players add $Rigel.At Rigel.Temp 1`,
		`execute as ${root} on passengers run function ${id('resume')}`,
	])
	write('resume', [
		'execute store result score $Rigel.Left Rigel.Temp run data get entity @s PortalCooldown',
		'scoreboard players operation $Rigel.Left Rigel.Temp -= $Rigel.At Rigel.Temp',
		'execute if score $Rigel.Left Rigel.Temp matches ..0 run scoreboard players set $Rigel.Left Rigel.Temp 1',
		'execute store result entity @s interpolation_duration int 1 run scoreboard players get $Rigel.Left Rigel.Temp',
		'data merge entity @s {shadow_strength:1f,start_interpolation:0}',
	])

	// tween runs frames 0 to its frame on one tick, so the client gets only where they leave each bone; then every bone
	// interpolates from the pose the client shows to there over the ticks asked.
	write('tween', [
		...checkId,
		'$scoreboard players set $Rigel.Ticks Rigel.Temp $(ticks)',
		`execute unless score $Rigel.Ticks Rigel.Temp matches 1.. run tellraw @a {"text":"[rigel] ${p.rig}: tween needs ticks of 1 or more","color":"red"}`,
		'execute unless score $Rigel.Ticks Rigel.Temp matches 1.. run return fail',
		'$scoreboard players set $Rigel.To Rigel.Temp $(frame)',
		`$data modify storage rigel:${p.rig} Animation set value $(ID)`,
		`$function ${id('tween')}/$(ID)`,
		`execute store result storage rigel:${p.rig} Tween.ticks int 1 run scoreboard players get $Rigel.Ticks Rigel.Temp`,
		`execute store result storage rigel:${p.rig} Tween.frame int 1 run scoreboard players get $Rigel.To Rigel.Temp`,
		`execute store success score $Rigel.Shade Rigel.Temp if data storage rigel:${p.rig} Tween{shadow:"${TWEEN_SHADOWS[0]}"}`,
		...TWEEN_SHADOWS.map((s, i) => `execute if score $Rigel.Shade Rigel.Temp matches ${i} run data modify storage rigel:${p.rig} Tween.shadow set value "${s}"`),
		`function ${id('tween/blend')} with storage rigel:${p.rig} Tween`,
		`scoreboard players operation ${self} Rigel.Frame = $Rigel.To Rigel.Temp`,
		`scoreboard players operation ${self} Rigel.Wait = $Rigel.Ticks Rigel.Temp`,
		`scoreboard players set ${self} Rigel.Playing 1`,
		`execute store result score ${self} Rigel.PlayedAt run time query gametime`,
	])
	// ponytail: a tween runs every write of frames 0 to its frame on one tick; store whole poses per frame if far frames get
	// slow or near maxCommandChainLength (65536), which cuts the tick short and leaves $Rigel.Seek at 1.
	write('tween/seek', [
		`execute store result storage rigel:${p.rig} Frame int 1 run scoreboard players get $Rigel.F Rigel.Temp`,
		`function ${id('next')} with storage rigel:${p.rig}`,
		'execute if score $Rigel.F Rigel.Temp >= $Rigel.To Rigel.Temp run return 1',
		'scoreboard players add $Rigel.F Rigel.Temp 1',
		`function ${id('tween/seek')}`,
	])
	write('tween/blend', [`$execute as ${root} on passengers run data merge entity @s {PortalCooldown:$(frame),interpolation_duration:$(ticks),start_interpolation:0,shadow_strength:$(shadow)}`])
	write('tween/arrive', [`scoreboard players set ${self} Rigel.Wait 0`, `$function ${id('tween')}/$(Animation)/arrive`])
	const onApply = new Set(p.variants.filter((v) => v.onApply).map((v) => v.name))
	for (const v of p.variants) if (onApply.has(v.name)) write(`tween/quiet/${v.name}`, v.writes.map((w) => `data merge entity ${bone(w.passenger)} {item:{tag:{CustomModelData:${w.cmd}}}}`))
	p.animations.forEach((animation, a) => {
		const last = animation.frames.length - 1
		const looping = animation.loop === 'loop' && last > 0
		const to = (t: number) => `execute if score $Rigel.To Rigel.Temp matches ${t} run `
		const entries = [...(animation.entries ?? [])].sort(([x], [y]) => x - y)
		write(`tween/${a}`, [
			...(looping
				? [`scoreboard players set $Rigel.Length Rigel.Temp ${last}`, 'scoreboard players operation $Rigel.To Rigel.Temp %= $Rigel.Length Rigel.Temp']
				: [`execute if score $Rigel.To Rigel.Temp matches ${last + 1}.. run scoreboard players set $Rigel.To Rigel.Temp ${last}`, 'execute if score $Rigel.To Rigel.Temp matches ..-1 run scoreboard players set $Rigel.To Rigel.Temp 0']),
			'scoreboard players set $Rigel.Seek Rigel.Temp 1',
			`function ${id(`frames/${a}/0`)} with storage ${headArgs}`,
			'scoreboard players set $Rigel.F Rigel.Temp 1',
			`execute if score $Rigel.To Rigel.Temp matches 1.. run function ${id('tween/seek')}`,
			'scoreboard players set $Rigel.Seek Rigel.Temp 0',
			...entries.map(([t]) => `${to(t)}function ${id(`tween/${a}/into/${t}`)} with storage ${FRAME_ARGS}`),
		])
		const merge = (b: number, head: string, pose: string) => `$data merge entity ${bone(b)} {${head}transformation:[${pose}$(_)`
		for (const [t, writes] of entries) {
			write(`tween/${a}/into/${t}`, writes.map((w) => merge(w.bone, '', animation.poses[t]![w.bone]!)))
			write(`tween/${a}/from/${t}`, writes.map((w) => merge(w.bone, head(t + 1, w, true), animation.poses[w.pose]![w.bone]!)))
		}
		const on = (t: number) => `execute if score ${self} Rigel.Frame matches ${t} run `
		const since = (t: number) => `execute if score ${self} Rigel.Frame matches ${t}.. run `
		const calls = [...(animation.variants ?? [])].filter(([k]) => !(looping && k === last)).sort(([x], [y]) => x - y)
		write(`tween/${a}/arrive`, [
			// Clears the tween's frame from PortalCooldown, as f/0 does in play, so restart finds no run ending there; without
			// runs, frames leave the interpolation length as it is.
			`execute as ${root} on passengers run data merge entity @s {${hasRuns(animation) ? '' : 'interpolation_duration:1,'}PortalCooldown:0}`,
			...entries.map(([t]) => `${on(t)}function ${id(`tween/${a}/from/${t}`)} with storage ${FRAME_ARGS}`),
			// The variants of frames 0 to the tween's frame, with the functions of only those on it.
			...calls.flatMap(([k, v]) =>
				onApply.has(v) ? [`${since(k + 1)}function ${id(`tween/quiet/${v}`)}`, `${on(k)}function ${id(`variant/${v}`)}`] : [`${since(k)}function ${id(`variant/${v}`)}`],
			),
		])
	})

	const passengers = p.passengers.map(
		(e, i) =>
			`{${e.nbt},UUID:${uuidNbt(p.id, i + 1)},Tags:[${tags}${e.name ? `,"rigel.${p.rig}.${e.name}"` : ''}],interpolation_duration:1,transformation:[${e.rest},0f,0f,0f,1f]}`,
	)
	const entityLocators = p.locators.flatMap((l, i) => (l.entity ? [{ ...l, entity: l.entity, i }] : []))
	const restLocators = p.locators.map((l) => {
		const [x, y, z] = l.rest.split(',')
		return `${l.name}:{x:${x}d,y:${y}d,z:${z}d}`
	})
	write('spawn', [
		`execute if entity ${root} run return fail`,
		`summon item_display ~ ~ ~ {UUID:${uuidNbt(p.id, 0)},Tags:[${tags},"rigel.root"],Passengers:[${passengers.join(',')}]}`,
		...(p.locators.length > 0 ? [`data modify storage ${storage} Locators set value {${restLocators.join(',')}}`] : []),
		...entityLocators.flatMap((l) => {
			const uuid = locatorEntity(l.i)
			const nbt = l.entity.nbt.trim().slice(1, -1).trim()
			return [
				`execute at ${root} run summon ${l.entity.type} ~ ~ ~ {UUID:${uuidNbt(p.id, p.passengers.length + 1 + l.i)}${nbt ? `,${nbt}` : ''}}`,
				...['rigel', `rigel.${p.rig}`, `rigel.${p.rig}.${l.name}`].map((t) => `tag ${uuid} add ${t}`),
			]
		}),
		`function ${id('tp')}`,
		`function ${id('teleport_duration')} {duration:${p.teleportDuration}}`,
		`scoreboard players set ${self} Rigel.Playing 0`,
	])
	// Passengers move with the root; their facing is their own. Locator entities ride nothing, so they are placed again.
	write('tp', [
		`tp ${root} ~ ~ ~ ~ ~`,
		`execute as ${root} on passengers run tp @s ~ ~ ~ ~ ~`,
		...entityLocators.map((l) => `function ${id(`locator/${l.name}/place`)} with storage ${storage} Locators.${l.name}`),
	])
	write('teleport_duration', [
		`execute unless entity ${root} run return fail`,
		`$data modify entity ${root} teleport_duration set value $(duration)`,
		`$execute as ${root} on passengers run data modify entity @s teleport_duration set value $(duration)`,
	])
	for (const l of entityLocators) write(`locator/${l.name}/place`, [`$execute at ${root} run tp ${locatorEntity(l.i)} ^$(x) ^$(y) ^$(z) ~ ~`])
	write('kill', [
		`execute as ${root} on passengers run kill @s`,
		...entityLocators.map((l) => `kill ${locatorEntity(l.i)}`),
		`kill ${root}`,
		`scoreboard players set ${self} Rigel.Playing 0`,
	])
	write('rest', [
		...p.passengers.map((e, i) => `data merge entity ${bone(i)} {interpolation_duration:1,transformation:[${e.rest},0f,0f,0f,1f]}`),
		...p.locators.flatMap((l, i) => placeLocator(i, l.rest)),
	])

	for (const v of p.variants)
		write(`variant/${v.name}`, [
			`execute unless entity ${root} run return fail`,
			...v.writes.map((w) => `data merge entity ${bone(w.passenger)} {item:{tag:{CustomModelData:${w.cmd}}}}`),
			...(v.onApply ? [`function ${v.onApply}`] : []),
		])

	for (const l of p.locators)
		write(`at_locator/${l.name}`, [
			`data modify storage ${storage} At set from storage ${storage} Locators.${l.name}`,
			`$data modify storage ${storage} At.function set value "$(function)"`,
			`function ${id('locator/at')} with storage ${storage} At`,
		])
	// @s stays the caller; the rotation is the rig's.
	if (p.locators.length > 0) write('locator/at', [`$execute at ${root} positioned ^$(x) ^$(y) ^$(z) run function $(function)`])
	return files
}

export function commonPack(): Files {
	const files: Files = new Map()
	const write = (path: string, lines: string[]) => files.set(fn(path), text(lines))
	files.set(MARKER, json({ generator: 'rigel', common: true }))
	files.set('pack.mcmeta', json({ pack: { pack_format: PACK_FORMAT, description: 'rigel: common' } }))
	files.set('data/minecraft/tags/functions/load.json', json({ values: ['rigel:core/load'] }))
	files.set('data/minecraft/tags/functions/tick.json', json({ values: ['rigel:core/tick'] }))
	write('core/load', [...objectives(), `data modify storage ${FRAME_ARGS} set value {_:",0f,0f,0f,1f],start_interpolation:0}"}`])
	write('core/tick', [
		'execute unless score $Rigel.Warm Rigel.Warming matches 1 run return 0',
		...WARM_PRIORITIES.map((priority) => `execute if data storage rigel:warm ${LIST[priority]}[0] run return run function rigel:core/warm/${priority}`),
		'scoreboard players set $Rigel.Warm Rigel.Warming 0',
	])
	// A rig whose pack was disabled leaves its registration behind; its chunk function cannot be called
	// and returns nothing, so the registration is dropped.
	for (const priority of WARM_PRIORITIES) {
		write(`core/warm/${priority}`, [
			'scoreboard players set $Rigel.Done Rigel.Temp 0',
			`execute store result score $Rigel.Done Rigel.Temp run function rigel:core/warm/call with storage rigel:warm ${LIST[priority]}[0]`,
			`execute if score $Rigel.Done Rigel.Temp matches 0 run data remove storage rigel:warm ${LIST[priority]}[0]`,
		])
	}
	write('core/warm/call', ['$return run function rigel:$(Rig)/warm/$(Tier)/$(Chunk)'])
	return files
}
