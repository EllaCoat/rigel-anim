// Data packs for Minecraft 1.20.4: one per rig (rigel:<rig>/…) and the common pack rigel (rigel:core/…).
import { planChunks, planFrames, type Poses, type WarmItem } from './frames'
import { WARM_PRIORITIES, type Files, type Loop, type WarmPriority } from './types'

export const NAMESPACE = 'rigel'
export const COMMON_PACK = 'rigel'
// Paths and storages the common pack uses under the namespace, and the common pack's folder.
export const RESERVED_RIG_NAMES = ['core', 'const', 'warm', COMMON_PACK]
// Written into every pack folder the export creates; only folders with it are replaced. Each pack
// writes it first, so a folder cut short by a failed write can still be replaced next time.
export const MARKER = 'rigel.json'

const PACK_FORMAT = 26
const OBJECTIVES = ['Rigel.Frame', 'Rigel.Playing', 'Rigel.PlayedAt', 'Rigel.Warming', 'Rigel.Temp']
const FRAME_ARGS = 'rigel:const FrameArgs'
const LIST: Record<WarmPriority, string> = { xhigh: 'XHigh', high: 'High', low: 'Low' }

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

export interface RigPackInput {
	rig: string
	id: number
	item: string
	chunkLines: number
	// Renderable bones in outliner order.
	bones: { cmd: number; rest: string }[]
	animations: { name: string; loop: Loop; priority: WarmPriority; poses: Poses }[]
}

export function rigPack(p: RigPackInput): Files {
	const files: Files = new Map()
	const self = `$Rigel.${p.rig}`
	const root = uuidString(p.id, 0)
	const bone = (b: number) => uuidString(p.id, b + 1)
	const id = (path: string) => `${NAMESPACE}:${p.rig}/${path}`
	const write = (path: string, lines: string[]) => files.set(fn(`${p.rig}/${path}`), text(lines))
	const warmingCheck = `execute if score ${self} Rigel.Warming matches 1 run return 0`

	files.set(MARKER, json({ generator: 'rigel', rig: p.rig, id: hexId(p.id) }))
	files.set('pack.mcmeta', json({ pack: { pack_format: PACK_FORMAT, description: `rigel: ${p.rig}` } }))
	files.set('data/minecraft/tags/functions/load.json', json({ values: [id('load')] }))
	files.set('data/minecraft/tags/functions/tick.json', json({ values: [id('tick')] }))

	// f/0 of every animation is warmed first within a priority: play writes it on the tick it is called.
	const heads: Record<WarmPriority, WarmItem[]> = { xhigh: [], high: [], low: [] }
	const rests: Record<WarmPriority, WarmItem[]> = { xhigh: [], high: [], low: [] }
	p.animations.forEach((animation, a) => {
		const plans = planFrames(animation.loop, animation.poses)
		const last = plans.length - 1
		plans.forEach((plan, f) => {
			const lines = [warmingCheck]
			for (const b of plan.writes) lines.push(`$data merge entity ${bone(b)} {transformation:[${animation.poses[plan.pose]![b]}$(_)`)
			if (f === last) {
				if (animation.loop === 'loop' && last > 0) lines.push(`scoreboard players set ${self} Rigel.Frame 0`)
				else if (animation.loop !== 'once') lines.push(`scoreboard players set ${self} Rigel.Playing 0`)
			}
			write(`frames/${a}/${f}`, lines)
			if (plan.writes.length > 0) (f === 0 ? heads : rests)[animation.priority].push({ animation: a, frame: f, lines: plan.writes.length })
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
				...chunk.map((item) => `function ${id(`frames/${item.animation}/${item.frame}`)} with storage ${FRAME_ARGS}`),
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
		`$function ${id('frames')}/$(ID)/0 with storage ${FRAME_ARGS}`,
	])
	write('stop', [`scoreboard players set ${self} Rigel.Playing 0`])
	write('pause', [`execute unless score ${self} Rigel.Playing matches 1 run return fail`, `scoreboard players set ${self} Rigel.Playing 2`])
	write('restart', [`execute unless score ${self} Rigel.Playing matches 2 run return fail`, `scoreboard players set ${self} Rigel.Playing 1`])

	const tags = `"rigel","rigel.${p.rig}"`
	const passengers = p.bones.map(
		(b, i) =>
			`{id:"minecraft:item_display",UUID:${uuidNbt(p.id, i + 1)},Tags:[${tags}],item:{id:"${p.item}",Count:1b,tag:{CustomModelData:${b.cmd}}},interpolation_duration:1,transformation:[${b.rest},0f,0f,0f,1f]}`,
	)
	write('spawn', [
		`execute if entity ${root} run return fail`,
		`summon item_display ~ ~ ~ {UUID:${uuidNbt(p.id, 0)},Tags:[${tags},"rigel.root"],Passengers:[${passengers.join(',')}]}`,
		`function ${id('tp')}`,
		`scoreboard players set ${self} Rigel.Playing 0`,
	])
	// Passengers move with the root; their facing is their own.
	write('tp', [`tp ${root} ~ ~ ~ ~ ~`, `execute as ${root} on passengers run tp @s ~ ~ ~ ~ ~`])
	write('kill', [`execute as ${root} on passengers run kill @s`, `kill ${root}`, `scoreboard players set ${self} Rigel.Playing 0`])
	write(
		'rest',
		p.bones.map((b, i) => `data merge entity ${bone(i)} {transformation:[${b.rest},0f,0f,0f,1f],start_interpolation:0}`),
	)
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
