import { onTextPreviewDrawn, PREVIEW as DISPLAY_PREVIEW } from '../display/preview'
import { isRigelProject } from '../easing/keyframes'
import { barState, onToggle } from './bar'
import { clampOnionRange, DEFAULT_ONION_RANGE, MAX_ONION_RANGE, MIN_ONION_RANGE, onionFade, onionFrames, storedOnionRange, type OnionFrame } from './ticks'

// Blockbench's three.js; the types declare it as a UMD global, which modules cannot use as a value.
const three = (globalThis as unknown as { THREE: typeof import('three') }).THREE

const ROOT = 'rigel_onion_skin_ghosts'
const ACTION_ID = 'rigel_onion_skin_range'
const STORAGE_KEY = 'rigel.onion_skin_range'
const COLORS = { past: 0x66aaff, future: 0xffaa66 }
const OPACITY = 0.2

type Stackable = { stackAnimations(animations: BBAnimation[], inLoop: boolean): void; displayMeshDeformation(): void }

let range = DEFAULT_ONION_RANGE
let root: THREE.Object3D | undefined
// A ghost per mesh drawn, direction and distance. They are kept while the same meshes are drawn, and only move.
const ghosts = new Map<string, THREE.Mesh>()
const materials = new Map<string, THREE.Material>()
let signature: string | undefined
let busy = false

let listeners: Deletable[] = []
let stops: (() => void)[] = []
let action: Action | undefined
let dialog: Dialog | undefined

const available = (): boolean => isRigelProject() && Modes.animate

// The meshes that make up a Group: its Cubes and Meshes, and the previews of the displays in it, however deep.
function collectSources(group: Group): THREE.Mesh[] {
	const sources: THREE.Mesh[] = []
	const add = (object: THREE.Object3D) => {
		const mesh = object as THREE.Mesh
		if (mesh.isMesh && mesh.geometry) sources.push(mesh)
	}
	const visit = (node: OutlinerNode) => {
		const { mesh, visibility } = node as unknown as { mesh?: THREE.Object3D; visibility?: boolean }
		if (!mesh || visibility === false) return
		if (node instanceof Group) {
			for (const child of mesh.children) if (child.name === DISPLAY_PREVIEW) child.traverse(add)
			node.children.forEach(visit)
		} else add(mesh)
	}
	visit(group)
	return sources
}

function ghostRoot(): THREE.Object3D {
	if (!root) {
		root = Object.assign(new three.Object3D(), { name: ROOT, no_export: true })
		Canvas.gizmos.push(root)
	}
	if (root.parent !== Canvas.scene) Canvas.scene.add(root)
	return root
}

function materialFor(frame: OnionFrame): THREE.Material {
	const key = `${frame.direction}|${frame.distance}`
	let material = materials.get(key)
	if (!material) {
		material = new three.MeshBasicMaterial({ color: COLORS[frame.direction], transparent: true, opacity: OPACITY * onionFade(frame.distance, range), depthWrite: false, side: three.DoubleSide })
		materials.set(key, material)
	}
	return material
}

function ghostFor(source: THREE.Mesh, frame: OnionFrame): THREE.Mesh {
	const key = `${source.uuid}|${frame.direction}|${frame.distance}`
	let ghost = ghosts.get(key)
	if (!ghost) {
		ghost = new three.Mesh(source.geometry.clone(), materialFor(frame))
		ghost.matrixAutoUpdate = false
		ghost.frustumCulled = false
		ghost.renderOrder = 10
		ghosts.set(key, ghost)
		ghostRoot().add(ghost)
	}
	return ghost
}

// A format with a centred grid does not move the scene, so the world matrix of the source is the matrix of the ghost.
function follow(ghost: THREE.Mesh, source: THREE.Mesh): void {
	source.updateWorldMatrix(true, false)
	ghost.matrix.copy(source.matrixWorld)
}

function clearGhosts(): void {
	for (const ghost of ghosts.values()) {
		ghost.geometry.dispose()
		root?.remove(ghost)
	}
	ghosts.clear()
	signature = undefined
}

function clearMaterials(): void {
	for (const material of materials.values()) material.dispose()
	materials.clear()
}

function showPose(time: number, animations: BBAnimation[]): void {
	Timeline.time = time
	Animator.showDefaultPose(true)
	const animator = Animator as unknown as Stackable
	animator.stackAnimations(animations, false)
	animator.displayMeshDeformation()
}

function target(): { animation: BBAnimation; group: Group } | undefined {
	if (!barState.onionSkin || !isRigelProject() || !Modes.animate) return undefined
	const animation = BBAnimation.selected
	const group = Group.first_selected
	return animation && group?.mesh ? { animation, group } : undefined
}

// ponytail: poses the whole rig 2 x range times on each frame; cache the poses by tick if playback gets slow with a big rig
function rebuild(): void {
	if (busy) return
	const chosen = target()
	if (!chosen) return clearGhosts()
	const sources = collectSources(chosen.group)
	if (sources.length === 0) return clearGhosts()
	busy = true
	const now = Timeline.time
	try {
		const next = `${chosen.group.uuid}|${range}|${sources.map((source) => source.uuid).join(',')}`
		if (next !== signature) {
			clearGhosts()
			signature = next
		}
		const shown = new Set<THREE.Mesh>()
		for (const frame of onionFrames(now, range)) {
			showPose(frame.time, [chosen.animation])
			for (const source of sources) {
				const ghost = ghostFor(source, frame)
				follow(ghost, source)
				shown.add(ghost)
			}
		}
		// Near time 0 there are fewer past frames; the ghosts kept from a later playhead would show an old pose.
		for (const ghost of ghosts.values()) ghost.visible = shown.has(ghost)
	} catch (error) {
		console.warn('Rigel: could not build the onion skin', error)
		clearGhosts()
	} finally {
		showPose(now, BBAnimation.all.filter((animation) => animation.playing))
		busy = false
	}
}

function setRange(value: number): void {
	const next = clampOnionRange(value)
	if (next === undefined || next === range) return
	range = next
	localStorage.setItem(STORAGE_KEY, String(next))
	clearGhosts()
	clearMaterials()
	rebuild()
}

function openRangeDialog(): void {
	dialog?.delete()
	dialog = new Dialog({
		id: ACTION_ID,
		title: 'オニオンスキンの範囲',
		form: {
			range: {
				label: '前後の tick 数',
				description: `再生位置の前後それぞれ ${MIN_ONION_RANGE}〜${MAX_ONION_RANGE} tick（1 tick は 1/20 秒）の姿勢を重ねて表示します。過去は青、未来は橙で、離れるほど薄くなります。`,
				type: 'number',
				value: range,
				min: MIN_ONION_RANGE,
				max: MAX_ONION_RANGE,
				step: 1,
			},
		},
		onConfirm(form: Record<string, unknown>) {
			setRange(Number(form.range))
		},
	})
	dialog.show()
}

export function registerOnionSkin(): void {
	range = storedOnionRange(localStorage.getItem(STORAGE_KEY))
	listeners = (['display_animation_frame', 'update_selection', 'select_mode', 'select_animation', 'select_project', 'unselect_project'] as const).map((name) => Blockbench.on(name, rebuild))
	stops = [
		onToggle((key) => {
			if (key === 'onionSkin') rebuild()
		}),
		onTextPreviewDrawn(rebuild),
	]
	action = new Action(ACTION_ID, { name: 'オニオンスキンの範囲…', icon: 'layers', category: 'animation', condition: available, click: openRangeDialog })
	MenuBar.addAction(action, 'animation')
}

export function unregisterOnionSkin(): void {
	for (const listener of listeners) listener.delete()
	listeners = []
	for (const stop of stops) stop()
	stops = []
	action?.delete()
	action = undefined
	dialog?.delete()
	dialog = undefined
	clearGhosts()
	clearMaterials()
	if (root) {
		Canvas.scene.remove(root)
		Canvas.gizmos.remove(root)
	}
	root = undefined
}
