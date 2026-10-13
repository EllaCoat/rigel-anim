import { FORMAT_ID } from '../format'
import { WARM_PRIORITIES, type AnimationThin, type Tolerance, type WarmPriority } from './types'

export const DEFAULT_CHUNK_LINES = 500
export const DEFAULT_PRIORITY: WarmPriority = 'high'
export const DEFAULT_SPAN = 20
export const DEFAULT_TELEPORT_DURATION = 1
export const DEFAULT_TOLERANCE: Tolerance = { position: 0, rotation: 0 }

export interface ProjectSettings {
	rig: string
	id: number
	item: string
	datapacks: string
	resourcePack: string
	chunkLines: number
	thin?: Tolerance
	// The tolerance the dialog shows, kept while thinning is off.
	tolerance: Tolerance
	span: number
	teleportDuration: number
}

const KEYS = {
	rig: 'rigel_rig',
	id: 'rigel_id',
	item: 'rigel_item',
	datapacks: 'rigel_datapacks',
	resourcePack: 'rigel_resource_pack',
	chunkLines: 'rigel_chunk_lines',
	span: 'rigel_thin_span',
	teleportDuration: 'rigel_teleport_duration',
} as const
const THIN_KEY = 'rigel_thin'
const POSITION_KEY = 'rigel_thin_position'
const ROTATION_KEY = 'rigel_thin_rotation'
const PRIORITY_KEY = 'rigel_warm'
export const ANIMATION_THIN = ['project', 'off', 'custom'] as const
export type AnimationThinMode = (typeof ANIMATION_THIN)[number]

type Bag = Record<string, unknown>

let properties: Deletable[] = []

export function registerExportSettings(): void {
	// Edited in Rigel's own dialogs only; exposed properties would also show unlabelled in Blockbench's project settings.
	const condition = { formats: [FORMAT_ID] }
	const exposed = false
	properties = [
		new Property(ModelProject, 'string', KEYS.rig, { condition, exposed }),
		new Property(ModelProject, 'number', KEYS.id, { condition, exposed, default: 0 }),
		new Property(ModelProject, 'string', KEYS.item, { condition, exposed }),
		new Property(ModelProject, 'string', KEYS.datapacks, { condition, exposed }),
		new Property(ModelProject, 'string', KEYS.resourcePack, { condition, exposed }),
		new Property(ModelProject, 'number', KEYS.chunkLines, { condition, exposed, default: DEFAULT_CHUNK_LINES }),
		new Property(ModelProject, 'boolean', THIN_KEY, { condition, exposed, default: false }),
		new Property(ModelProject, 'number', POSITION_KEY, { condition, exposed, default: DEFAULT_TOLERANCE.position }),
		new Property(ModelProject, 'number', ROTATION_KEY, { condition, exposed, default: DEFAULT_TOLERANCE.rotation }),
		new Property(ModelProject, 'number', KEYS.span, { condition, exposed, default: DEFAULT_SPAN }),
		new Property(ModelProject, 'number', KEYS.teleportDuration, { condition, exposed, default: DEFAULT_TELEPORT_DURATION }),
		new Property(Animation, 'enum', PRIORITY_KEY, { condition, exposed, default: DEFAULT_PRIORITY, values: [...WARM_PRIORITIES] }),
		new Property(Animation, 'enum', THIN_KEY, { condition, exposed, default: 'project', values: [...ANIMATION_THIN] }),
		new Property(Animation, 'number', POSITION_KEY, { condition, exposed, default: DEFAULT_TOLERANCE.position }),
		new Property(Animation, 'number', ROTATION_KEY, { condition, exposed, default: DEFAULT_TOLERANCE.rotation }),
	]
}

export function unregisterExportSettings(): void {
	for (const p of properties) p.delete()
	properties = []
}

const text = (bag: Bag, key: string) => (typeof bag[key] === 'string' ? (bag[key] as string) : '')
const number = (bag: Bag, key: string, fallback: number) => (typeof bag[key] === 'number' && Number.isFinite(bag[key]) ? (bag[key] as number) : fallback)
const toleranceIn = (bag: Bag): Tolerance => ({ position: number(bag, POSITION_KEY, DEFAULT_TOLERANCE.position), rotation: number(bag, ROTATION_KEY, DEFAULT_TOLERANCE.rotation) })

export function readProjectSettings(project: ModelProject): ProjectSettings {
	const bag = project as unknown as Bag
	const tolerance = toleranceIn(bag)
	return {
		rig: text(bag, KEYS.rig),
		id: number(bag, KEYS.id, 0),
		item: text(bag, KEYS.item),
		datapacks: text(bag, KEYS.datapacks),
		resourcePack: text(bag, KEYS.resourcePack),
		chunkLines: number(bag, KEYS.chunkLines, DEFAULT_CHUNK_LINES),
		thin: bag[THIN_KEY] === true ? tolerance : undefined,
		tolerance,
		span: number(bag, KEYS.span, DEFAULT_SPAN),
		teleportDuration: number(bag, KEYS.teleportDuration, DEFAULT_TELEPORT_DURATION),
	}
}

export function writeProjectSettings(project: ModelProject, settings: ProjectSettings): void {
	const bag = project as unknown as Bag
	for (const [field, key] of Object.entries(KEYS)) bag[key] = settings[field as keyof typeof KEYS]
	bag[THIN_KEY] = settings.thin !== undefined
	bag[POSITION_KEY] = settings.tolerance.position
	bag[ROTATION_KEY] = settings.tolerance.rotation
}

export function getPriority(animation: BBAnimation): WarmPriority {
	const value = (animation as unknown as Bag)[PRIORITY_KEY]
	return WARM_PRIORITIES.includes(value as WarmPriority) ? (value as WarmPriority) : DEFAULT_PRIORITY
}

export function setPriority(animation: BBAnimation, priority: WarmPriority): void {
	;(animation as unknown as Bag)[PRIORITY_KEY] = priority
}

export function getThinMode(animation: BBAnimation): AnimationThinMode {
	const value = (animation as unknown as Bag)[THIN_KEY]
	return ANIMATION_THIN.includes(value as AnimationThinMode) ? (value as AnimationThinMode) : 'project'
}

export function getAnimationTolerance(animation: BBAnimation): Tolerance {
	return toleranceIn(animation as unknown as Bag)
}

export function getThin(animation: BBAnimation): AnimationThin {
	const mode = getThinMode(animation)
	return mode === 'custom' ? getAnimationTolerance(animation) : mode
}

export function setThin(animation: BBAnimation, mode: AnimationThinMode, tolerance: Tolerance): void {
	const bag = animation as unknown as Bag
	bag[THIN_KEY] = mode
	bag[POSITION_KEY] = tolerance.position
	bag[ROTATION_KEY] = tolerance.rotation
}

export function newRigId(): number {
	const [n] = crypto.getRandomValues(new Uint32Array(1))
	return n || 1
}
