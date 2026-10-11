import { tickCount } from '../bake/sample'
import { isRigelProject } from '../easing/keyframes'
import { variantTimeline, showVariantTrack } from './keyframes'
import { viewPlan } from './keys'
import { DEFAULT_VARIANT_ID, readVariants, type StoredVariant } from './settings'

type Material = THREE.Material

interface Shown {
	byBone: Record<string, string>
	other: string
	headline: string
	variants: Record<string, StoredVariant>
}

// Neither is saved. `chosen` is the variant picked in the panel; `shown` is what the viewport draws, which
// the next face update of every Cube draws again.
const chosen = new WeakMap<ModelProject, string>()
const shown = new WeakMap<ModelProject, Shown>()

let listeners: Deletable[] = []
let onChange: () => void = () => {}

export function chosenId(): string {
	const id = Project && chosen.get(Project)
	return id && readVariants(Project!).some((v) => v.uuid === id) ? id : DEFAULT_VARIANT_ID
}

export function shownId(): string {
	return (Project && shown.get(Project)?.headline) || DEFAULT_VARIANT_ID
}

export function choose(id: string): void {
	if (Project) chosen.set(Project, id)
	refreshView()
}

// Swaps the materials of each Cube to those of the variant its bone wears. Blockbench draws a Cube's own textures
// whenever it updates the faces, so this runs after each of those.
function swapMaterials({ element }: { element: Cube }): void {
	const now = Project && shown.get(Project)
	if (!now) return
	const id = element.parent instanceof Group ? (now.byBone[element.parent.uuid] ?? now.other) : now.other
	const variant = now.variants[id]
	if (!variant) return
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

function plan(project: ModelProject): Shown {
	const variants = readVariants(project)
	const animation = Modes.animate && BBAnimation.selected
	const { byBone, other, headline } = viewPlan({
		painting: Modes.paint,
		keys: animation ? variantTimeline(animation) : [],
		loop: animation ? animation.loop : 'once',
		length: animation ? animation.length : 0,
		ticks: animation ? tickCount(animation) : 0,
		time: animation ? animation.time : 0,
		bones: Group.all.filter((g) => g.children.some((c) => c instanceof Cube)).map((g) => g.uuid),
		excluded: new Map(variants.map((v) => [v.uuid, new Set(v.excluded)])),
		chosen: chosenId(),
	})
	const used = new Set([...byBone.values(), other])
	return { byBone: Object.fromEntries(byBone), other, headline, variants: Object.fromEntries(variants.filter((v) => used.has(v.uuid)).map((v) => [v.uuid, v])) }
}

function draw(): boolean {
	if (!Project || !isRigelProject()) return false
	const next = plan(Project)
	if (JSON.stringify(shown.get(Project)) === JSON.stringify(next)) return false
	shown.set(Project, next)
	Canvas.updateView({ elements: Cube.all, element_aspects: { faces: true } })
	return true
}

// Draws the variant to show, and tells the panel to redraw itself.
export function refreshView(): void {
	draw()
	onChange()
}

// Runs for every frame of a playing animation, so the panel is redrawn only when the variant changes.
function followPlayhead(): void {
	if (draw()) onChange()
}

export function registerVariantView(changed: () => void): void {
	onChange = changed
	listeners = [
		// Typed as returning nothing; the listener is returned like any other.
		Cube.preview_controller.on('update_faces', swapMaterials as (data: unknown) => void) as unknown as Deletable,
		Blockbench.on('select_project', refreshView),
		Blockbench.on('select_mode', refreshView),
		Blockbench.on('display_animation_frame', followPlayhead),
		...['select_animation', 'select_project', 'select_mode'].map((name) => Blockbench.on(name as 'select_mode', showVariantTrack)),
		Codecs.project!.on('parsed', showVariantTrack),
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
