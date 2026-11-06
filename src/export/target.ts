import type { Vec3 } from '../bake/matrix'
import { textJson } from './display'
import { itemDefinition, itemDefinitionPath, itemModelPath, mergeItemModel } from './resource-pack'
import type { Files } from './types'

export const GAME_VERSIONS = ['1.20.4', '26.3'] as const
export type GameVersion = (typeof GAME_VERSIONS)[number]
export const DEFAULT_VERSION: GameVersion = '1.20.4'

export const isGameVersion = (value: unknown): value is GameVersion => GAME_VERSIONS.includes(value as GameVersion)

const AXES = ['x', 'y', 'z'] as const

// What the packs for each Minecraft version write differently; the rest of the export is shared.
export interface Target {
	version: GameVersion
	// The folder of functions under data/<namespace>/, and of function tags under data/minecraft/tags/.
	functions: string
	// The data packs' pack.mcmeta pack section, without the description.
	dataPack: object
	// An item stack in a summon compound. data is the SNBT compound of the item's own data (1.20.4's tag, 26.3's
	// components), or '' for none.
	item(id: string, data: string): string
	// text_display's text from a JSON text component, or plain text when it does not parse as JSON.
	text(text: string): string
	// block_display's block_state; property values are strings.
	blockState(id: string, properties: [string, string][]): string
	// A bone's item and the command that switches a bone to another model. model is what the version names a model
	// with: 1.20.4's CustomModelData, 26.3's item model ID.
	boneItem(item: string, model: string): string
	setBoneModel(entity: string, item: string, model: string): string
	// The resource pack file the models are merged into (1.20.4's item model, whose overrides pick the
	// CustomModelData), if any; models gets its contents as existing.
	sharedModelFile(item: string): string | undefined
	// What bones name each model ID with, and the resource pack files that make those names draw the models.
	models(item: string, rig: string, ids: string[], existing: string | undefined): { names: string[]; files: Files }
	// Moves the root to the execution position and turns it and its passengers to the execution rotation.
	tp(root: string): string[]
	// A cube's rotation in the item model, or a problem when the version cannot rotate it so. rotation has one value
	// per axis in degrees, applied in Blockbench's order (Z, then Y, then X, as euler_order ZYX).
	elementRotation(rotation: Vec3, origin: Vec3): object | string
}

const propertyNbt = (properties: [string, string][]) => properties.map(([k, v]) => `${k}:"${v}"`).join(',')
const quoted = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\b': '\\b', '\f': '\\f' }
// SnbtGrammar's escapes; other control characters keep their code point.
const snbtString = (s: string) => `"${s.replace(/[\\"\u0000-\u001f]/g, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`

// A JSON value as SNBT. A list may mix types; Minecraft wraps the elements that need it.
export function jsonSnbt(value: unknown): string {
	if (typeof value === 'string') return snbtString(value)
	if (typeof value === 'number') return Number.isInteger(value) ? String(value) : `${value}d`
	if (typeof value === 'boolean') return String(value)
	if (Array.isArray(value)) return `[${value.map(jsonSnbt).join(',')}]`
	if (typeof value === 'object' && value !== null) return `{${Object.entries(value).map(([k, v]) => `${snbtString(k)}:${jsonSnbt(v)}`).join(',')}}`
	return '""'
}

const TARGETS: Record<GameVersion, Target> = {
	'1.20.4': {
		version: '1.20.4',
		functions: 'functions',
		dataPack: { pack_format: 26 },
		item: (id, data) => `{id:"${id}",Count:1b${data ? `,tag:${data}` : ''}}`,
		text: (text) => quoted(textJson(text)),
		blockState: (id, properties) => `{Name:"${id}"${properties.length > 0 ? `,Properties:{${propertyNbt(properties)}}` : ''}}`,
		boneItem: (item, model) => `{id:"${item}",Count:1b,tag:{CustomModelData:${model}}}`,
		setBoneModel: (entity, _item, model) => `data merge entity ${entity} {item:{tag:{CustomModelData:${model}}}}`,
		// Passengers move with the root, but keep their own facing.
		tp: (root) => [`tp ${root} ~ ~ ~ ~ ~`, `execute as ${root} on passengers run tp @s ~ ~ ~ ~ ~`],
		sharedModelFile: itemModelPath,
		models(item, rig, ids, existing) {
			const merged = mergeItemModel(existing, item, rig, ids)
			return { names: merged.cmds.map(String), files: new Map([[itemModelPath(item), merged.json]]) }
		},
		elementRotation(rotation, origin) {
			const turned = [0, 1, 2].filter((i) => rotation[i] !== 0)
			if (turned.length > 1) return '回転が 2 軸以上あります（1.20.4 の item model は 1 軸だけです）。'
			const axis = turned[0]!
			const angle = rotation[axis]!
			if (![-45, -22.5, 22.5, 45].includes(angle)) return `回転 ${angle}° は 1.20.4 の item model で使えません（使えるのは -45・-22.5・22.5・45 だけです）。`
			return { angle, axis: AXES[axis], origin }
		},
	},
	'26.3': {
		version: '26.3',
		functions: 'function',
		// An integer max_format takes every minor version of it.
		dataPack: { min_format: 121, max_format: 121 },
		item: (id, data) => `{id:"${id}",count:1${data ? `,components:${data}` : ''}}`,
		text: (text) => jsonSnbt(JSON.parse(textJson(text))),
		// BlockState.CODEC: the block's ID, or a compound with the ID and the properties (StateHolder.codec).
		blockState: (id, properties) => `{id:"${id}"${properties.length > 0 ? `,properties:{${propertyNbt(properties)}}` : ''}}`,
		boneItem: (item, model) => `{id:"${item}",count:1,components:{"minecraft:item_model":"${model}"}}`,
		// Sets the slot only, where data merge entity reads and writes all of the entity's NBT.
		setBoneModel: (entity, item, model) => `item replace entity ${entity} contents with ${item}[item_model="${model}"]`,
		// Passengers turn with the root (Entity.calculatePassengerTransition), and tp on a passenger dismounts it.
		tp: (root) => [`tp ${root} ~ ~ ~ ~ ~`],
		sharedModelFile: () => undefined,
		models: (_item, _rig, ids) => ({ names: ids, files: new Map(ids.map((id) => [itemDefinitionPath(id), itemDefinition(id)])) }),
		// Any angle on one axis; on more, x, y and z (CuboidModelElement, CuboidRotation.EulerXYZRotation).
		elementRotation(rotation, origin) {
			const turned = [0, 1, 2].filter((i) => rotation[i] !== 0)
			if (turned.length === 1) return { angle: rotation[turned[0]!], axis: AXES[turned[0]!], origin }
			return { origin, x: rotation[0], y: rotation[1], z: rotation[2] }
		},
	},
}

export const targetOf = (version: GameVersion): Target => TARGETS[version]
