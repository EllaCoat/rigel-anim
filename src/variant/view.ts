import { isRigelProject } from '../easing/keyframes'
import { DEFAULT_VARIANT_ID, readVariants, type StoredVariant } from './settings'

type Material = THREE.Material

// Neither is saved. `chosen` is the variant picked in the panel; `shown` is the one the viewport draws, which
// the next face update of every Cube draws again.
const chosen = new WeakMap<ModelProject, string>()
const shown = new WeakMap<ModelProject, StoredVariant | undefined>()

let listeners: Deletable[] = []
let onChange: () => void = () => {}

export function chosenId(): string {
	const id = Project && chosen.get(Project)
	return id && readVariants(Project!).some((v) => v.uuid === id) ? id : DEFAULT_VARIANT_ID
}

export function shownId(): string {
	return (Project && shown.get(Project)?.uuid) || DEFAULT_VARIANT_ID
}

export function choose(id: string): void {
	if (Project) chosen.set(Project, id)
	refreshView()
}

// Swaps the materials of the Cubes the variant applies to. Blockbench draws a Cube's own textures whenever it updates
// the faces, so this runs after each of those.
function swapMaterials({ element }: { element: Cube }): void {
	const variant = Project && shown.get(Project)
	if (!variant || (element.parent instanceof Group && variant.excluded.includes(element.parent.uuid))) return
	const replace = new Map<Material, Material>()
	for (const [from, to] of variant.textures) {
		const a = Texture.all.find((t) => t.uuid === from)
		const b = Texture.all.find((t) => t.uuid === to)
		if (a && b) replace.set(a.getMaterial() as Material, b.getMaterial() as Material)
	}
	if (replace.size === 0) return
	const mesh = element.mesh as THREE.Mesh
	const swap = (m: Material) => replace.get(m) ?? m
	mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
}

// Draws the chosen variant, and tells the panel to redraw itself.
export function refreshView(): void {
	if (Project && isRigelProject()) {
		const next = readVariants(Project).find((v) => v.uuid === chosenId())
		if (JSON.stringify(shown.get(Project)) !== JSON.stringify(next)) {
			shown.set(Project, next)
			Canvas.updateView({ elements: Cube.all, element_aspects: { faces: true } })
		}
	}
	onChange()
}

export function registerVariantView(changed: () => void): void {
	onChange = changed
	listeners = [
		// Typed as returning nothing; the listener is returned like any other.
		Cube.preview_controller.on('update_faces', swapMaterials as (data: unknown) => void) as unknown as Deletable,
		Blockbench.on('select_project', refreshView),
		Blockbench.on('select_mode', refreshView),
	]
	refreshView()
}

export function unregisterVariantView(): void {
	for (const l of listeners) l.delete()
	listeners = []
	onChange = () => {}
	if (Project) {
		shown.delete(Project)
		Canvas.updateView({ elements: Cube.all, element_aspects: { faces: true } })
	}
}
