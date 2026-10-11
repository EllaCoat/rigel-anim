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
const OBJECTIVES = ['Rigel.Frame', 'Rigel.Playing', 'Rigel.PlayedAt', 'Rigel.Warming', 'Rigel.Temp']
const FRAME_ARGS = 'rigel:const FrameArgs'
const LIST: Record<WarmPriority, string> = { xhigh: 'XHigh', high: 'High', low: 'Low' }
// Ticks; an interpolation this long does not visibly move.
const HOLD = 1_000_000_000

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
	}[]
}

const hasRuns = (a: RigPackInput['animations'][number]) => a.frames.some((writes) => writes.some((w) => w.duration > 1))
const thinned = (p: RigPackInput) => p.animations.some(hasRuns)

export function rigPack(p: RigPackInput): Files {
	const files: Files = new Map()
	const self = `$Rigel.${p.rig}`
	const root = uuidString(p.id, 0)
	const bone = (b: number) => uuidString(p.id, b + 1)
	const id = (path: string) => `${NAMESPACE}:${p.rig}/${path}`
	const write = (path: string, lines: string[]) => files.set(fn(`${p.rig}/${path}`), text(lines))
	const warmingCheck = `execute if score ${self} Rigel.Warming matches 1 run return 0`
	const thin = thinned(p)
	// f/0 restores the shadow_strength stop and pause change. PortalCooldown keeps the frame a run ends at for restart;
	// display entities neither count it down nor send it.
	const head = (f: number, w: FrameWrite, runs: boolean) =>
		!thin ? '' : f === 0 ? 'shadow_strength:1f,PortalCooldown:0,interpolation_duration:1,' : !runs ? '' : w.duration > 1 ? `PortalCooldown:${f + w.duration - 1},interpolation_duration:${w.duration},` : `interpolation_duration:${w.duration},`
	// Thinned packs leave start_interpolation out of f/0 and rest: sent with an unchanged pose, it makes the client
	// replay its last interpolation (Display.tick).
	const headArgs = thin ? `rigel:${p.rig}` : FRAME_ARGS
	const tail = (f: number) => (thin && f === 0 ? '$(s)' : '$(_)')
	// A changed shadow_strength (not drawn while shadow_radius is 0) restarts the client's interpolation from the
	// pose it shows (Display.createInterpolatedRenderState), and HOLD keeps it there.
	const hold = `execute as ${root} on passengers run data merge entity @s {shadow_strength:.999f,interpolation_duration:${HOLD},start_interpolation:0}`
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
			if (variant) lines.push(`function ${id(`variant/${variant}`)}`)
			if (f === last) {
				if (animation.loop === 'loop' && last > 0) lines.push(`scoreboard players set ${self} Rigel.Frame 0`)
				else if (animation.loop !== 'once') lines.push(`scoreboard players set ${self} Rigel.Playing 0`)
			}
			write(`frames/${a}/${f}`, lines)
			if (writes.length > 0) (f === 0 ? heads : rests)[animation.priority].push({ animation: a, frame: f, lines: writes.length })
		})
		if (animation.loop === 'once') write(`frames/${a}/${last + 1}`, [warmingCheck, `function ${id('rest')}`, `scoreboard players set ${self} Rigel.Playing 0`])
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
		...(thin ? [`data modify storage ${headArgs} s set value ",0f,0f,0f,1f]}"`] : []),
		`scoreboard players set ${self} Rigel.Warming 0`,
		...(registrations.length > 0 ? ['scoreboard players set $Rigel.Warm Rigel.Warming 1'] : []),
	])

	write('tick', [
		`execute unless score ${self} Rigel.Playing matches 1 run return 0`,
		'execute store result score $Rigel.Now Rigel.PlayedAt run time query gametime',
		`execute if score ${self} Rigel.PlayedAt = $Rigel.Now Rigel.PlayedAt run return 0`,
		`execute store result storage rigel:${p.rig} Frame int 1 run scoreboard players add ${self} Rigel.Frame 1`,
		`function ${id('next')} with storage rigel:${p.rig}`,
	])
	write('next', [`$function ${id('frames')}/$(Animation)/$(Frame) with storage ${FRAME_ARGS}`])

	const count = p.animations.length
	const noSuchId = `tellraw @a [{"text":"[rigel] ${p.rig}: no animation with ID ","color":"red"},{"score":{"name":"$Rigel.ID","objective":"Rigel.Temp"},"color":"red"}]`
	const unless = count > 0 ? `execute unless score $Rigel.ID Rigel.Temp matches 0..${count - 1} run ` : ''
	write('play', [
		...p.animations.map((a, i) => `# ${i}: ${a.name.replace(/[\r\n]+/g, ' ')}`),
		'$scoreboard players set $Rigel.ID Rigel.Temp $(ID)',
		`${unless}${noSuchId}`,
		`${unless}return fail`,
		`$data modify storage rigel:${p.rig} Animation set value $(ID)`,
		`scoreboard players set ${self} Rigel.Frame 0`,
		`scoreboard players set ${self} Rigel.Playing 1`,
		`execute store result score ${self} Rigel.PlayedAt run time query gametime`,
		`$function ${id('frames')}/$(ID)/0 with storage ${headArgs}`,
	])
	write('stop', [`scoreboard players set ${self} Rigel.Playing 0`, ...(thin ? [hold] : [])])
	write('pause', [`execute unless score ${self} Rigel.Playing matches 1 run return fail`, `scoreboard players set ${self} Rigel.Playing 2`, ...(thin ? [hold] : [])])
	write('restart', [
		`execute unless score ${self} Rigel.Playing matches 2 run return fail`,
		`scoreboard players set ${self} Rigel.Playing 1`,
		// Rigel.Frame is 0 on the tick of play and after a loop's last frame, when every run has ended.
		...(thin
			? [
					`scoreboard players operation $Rigel.At Rigel.Temp = ${self} Rigel.Frame`,
					'execute if score $Rigel.At Rigel.Temp matches 0 run scoreboard players set $Rigel.At Rigel.Temp 2147483647',
					`execute as ${root} on passengers run function ${id('resume')}`,
				]
			: []),
	])
	if (thin)
		write('resume', [
			'execute store result score $Rigel.Left Rigel.Temp run data get entity @s PortalCooldown',
			'scoreboard players operation $Rigel.Left Rigel.Temp -= $Rigel.At Rigel.Temp',
			'execute if score $Rigel.Left Rigel.Temp matches ..0 run scoreboard players set $Rigel.Left Rigel.Temp 1',
			'execute store result entity @s interpolation_duration int 1 run scoreboard players get $Rigel.Left Rigel.Temp',
			'data merge entity @s {shadow_strength:1f,start_interpolation:0}',
		])

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
		`scoreboard players set ${self} Rigel.Playing 0`,
	])
	// Passengers move with the root; their facing is their own. Locator entities ride nothing, so they are placed again.
	write('tp', [
		`tp ${root} ~ ~ ~ ~ ~`,
		`execute as ${root} on passengers run tp @s ~ ~ ~ ~ ~`,
		...entityLocators.map((l) => `function ${id(`locator/${l.name}/place`)} with storage ${storage} Locators.${l.name}`),
	])
	for (const l of entityLocators) write(`locator/${l.name}/place`, [`$execute at ${root} run tp ${locatorEntity(l.i)} ^$(x) ^$(y) ^$(z) ~ ~`])
	write('kill', [
		`execute as ${root} on passengers run kill @s`,
		...entityLocators.map((l) => `kill ${locatorEntity(l.i)}`),
		`kill ${root}`,
		`scoreboard players set ${self} Rigel.Playing 0`,
	])
	write('rest', [
		...p.passengers.map((e, i) => `data merge entity ${bone(i)} {${thin ? 'interpolation_duration:1,' : ''}transformation:[${e.rest},0f,0f,0f,1f]${thin ? '' : ',start_interpolation:0'}}`),
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
