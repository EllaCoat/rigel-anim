import type { GameVersion } from './export/target'

export const FORMAT_ID = 'rigel'

let format: ModelFormat | undefined

// Cubes follow the item-model rules of the project's version: 1.20.4 turns one axis by 22.5° steps, 26.3 any way.
// The format is shared by every Rigel project, so this runs again whenever the project or its version changes.
export function applyVersion(version: GameVersion): void {
	if (!format) return
	const limited = version === '1.20.4'
	format.rotation_limit = limited
	format.rotation_snap = limited
}

export function registerFormat(): void {
	format = new ModelFormat(FORMAT_ID, {
		icon: 'movie',
		name: 'Rigel Rig',
		description: 'Display-entity rig for Minecraft Java Edition 1.20.4 and 26.3.',
		category: 'minecraft',
		target: 'Minecraft: Java Edition',
		show_on_start_screen: true,
		model_identifier: false,
		bone_rig: true,
		locators: true,
		centered_grid: true,
		rotate_cubes: true,
		rotation_limit: true,
		rotation_snap: true,
		optional_box_uv: true,
		uv_rotation: true,
		java_face_properties: true,
		animation_mode: true,
	})
}

export function unregisterFormat(): void {
	format?.delete()
	format = undefined
}
