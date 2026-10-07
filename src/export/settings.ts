// Export settings saved in the project file: per project, and the warm-up priority per animation.
import { FORMAT_ID } from '../format'
import { WARM_PRIORITIES, type WarmPriority } from './types'

export const DEFAULT_CHUNK_LINES = 500
export const DEFAULT_PRIORITY: WarmPriority = 'high'

export interface ProjectSettings {
	rig: string
	id: number
	item: string
	datapacks: string
	resourcePack: string
	chunkLines: number
}

const KEYS = {
	rig: 'rigel_rig',
	id: 'rigel_id',
	item: 'rigel_item',
	datapacks: 'rigel_datapacks',
	resourcePack: 'rigel_resource_pack',
	chunkLines: 'rigel_chunk_lines',
} as const
const PRIORITY_KEY = 'rigel_warm'

type Bag = Record<string, unknown>

let properties: Deletable[] = []

export function registerExportSettings(): void {
	// Edited in the export dialog only; exposed properties would also show unlabelled in the project settings.
	const condition = { formats: [FORMAT_ID] }
	const exposed = false
	properties = [
		new Property(ModelProject, 'string', KEYS.rig, { condition, exposed }),
		new Property(ModelProject, 'number', KEYS.id, { condition, exposed, default: 0 }),
		new Property(ModelProject, 'string', KEYS.item, { condition, exposed }),
		new Property(ModelProject, 'string', KEYS.datapacks, { condition, exposed }),
		new Property(ModelProject, 'string', KEYS.resourcePack, { condition, exposed }),
		new Property(ModelProject, 'number', KEYS.chunkLines, { condition, exposed, default: DEFAULT_CHUNK_LINES }),
		new Property(Animation, 'enum', PRIORITY_KEY, { condition, exposed, default: DEFAULT_PRIORITY, values: [...WARM_PRIORITIES] }),
	]
}

export function unregisterExportSettings(): void {
	for (const p of properties) p.delete()
	properties = []
}

export function readProjectSettings(project: ModelProject): ProjectSettings {
	const bag = project as unknown as Bag
	const text = (key: string) => (typeof bag[key] === 'string' ? (bag[key] as string) : '')
	const number = (key: string, fallback: number) => (typeof bag[key] === 'number' && Number.isFinite(bag[key]) ? (bag[key] as number) : fallback)
	return {
		rig: text(KEYS.rig),
		id: number(KEYS.id, 0),
		item: text(KEYS.item),
		datapacks: text(KEYS.datapacks),
		resourcePack: text(KEYS.resourcePack),
		chunkLines: number(KEYS.chunkLines, DEFAULT_CHUNK_LINES),
	}
}

export function writeProjectSettings(project: ModelProject, settings: ProjectSettings): void {
	const bag = project as unknown as Bag
	for (const [field, key] of Object.entries(KEYS)) bag[key] = settings[field as keyof ProjectSettings]
}

export function getPriority(animation: BBAnimation): WarmPriority {
	const value = (animation as unknown as Bag)[PRIORITY_KEY]
	return WARM_PRIORITIES.includes(value as WarmPriority) ? (value as WarmPriority) : DEFAULT_PRIORITY
}

export function setPriority(animation: BBAnimation, priority: WarmPriority): void {
	;(animation as unknown as Bag)[PRIORITY_KEY] = priority
}

// A random unsigned 32-bit number other than 0, made once per project.
export function newRigId(): number {
	const [n] = crypto.getRandomValues(new Uint32Array(1))
	return n || 1
}
