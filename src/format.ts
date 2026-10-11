export const FORMAT_ID = 'rigel'

let format: ModelFormat | undefined

// rotation_limit and rotation_snap: cubes follow 1.20.4's item-model rules, the stricter of the two targets.
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
