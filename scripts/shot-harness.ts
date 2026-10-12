// Runs inside the development Blockbench: mc-shot.ts bundles this file and injects it as __rigelShot.
import { tickCount } from '../src/bake/sample'
import { variantKeys } from '../src/export/collect'
import { variantCalls } from '../src/export/variant-keys'
import { readVariants } from '../src/variant/settings'
import { blockbenchCamera, FOV, type Pose, type View } from './shot-spec'
import { callVariant, ORIGINAL, viewCalls, type Worn } from './shot-variants'

const TICKS_PER_SECOND = 20
let worn: Worn = new Map()
type Stackable = { stackAnimations(animations: BBAnimation[], inLoop: boolean): void }

async function open(model: any, name: string) {
	const format = model.meta?.model_format
	if (!Formats[format]) throw new Error(`model format "${format}" is not registered; rigel models need \`bun scripts/dev-bb.ts install\``)
	for (const project of [...ModelProject.all]) {
		project.saved = true
		await project.close(true)
	}
	Codecs.project.load(model, { name, path: name, no_file: true } as any)
	worn = new Map()
	// The viewport follows the selected animation's variant keyframes; this harness sets the variant itself.
	for (const animation of Project!.animations) {
		const effects = animation.animators.effects as unknown as { muted: Record<string, boolean> } | undefined
		if (effects) effects.muted.variant = true
	}
	unselectAllElements()
	// The export includes cubes hidden in the viewport, so the comparison draws them too.
	for (const node of [...Outliner.elements, ...Group.all]) (node as { visibility: boolean }).visibility = true
	Canvas.updateVisibility()
	Modes.options.animate!.select()
	await textDrawn()
	return { format: Format.id, elements: Outliner.elements.length }
}

// The plugin draws text displays once Minecraft's font has loaded, a while after the groups are made.
async function textDrawn(timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	const waiting = () =>
		Group.all.filter((g) => (g as unknown as { rigel_display?: { kind?: string } }).rigel_display?.kind === 'text' && !(g.mesh as THREE.Object3D).getObjectByName('rigel_display_preview')?.children.length)
	while (waiting().length > 0) {
		if (Date.now() > deadline) throw new Error(`text displays not drawn: ${waiting().map((g) => g.name).join(', ')}`)
		await new Promise((r) => setTimeout(r, 100))
	}
}

// The pose the export samples for this tick (src/bake/sample.ts), or the rest pose.
function applyPose(pose: Pose | undefined): void {
	if (!pose) {
		Animator.showDefaultPose()
		return
	}
	Animator.showDefaultPose(true)
	const animation = Project!.animations.find((a) => a.name === pose.animation)
	if (!animation) throw new Error(`no animation "${pose.animation}"`)
	Timeline.time = Math.min(pose.tick / TICKS_PER_SECOND, animation.length)
	;(Animator as unknown as Stackable).stackAnimations([animation], false)
}

function applyVariants(view: View): void {
	const variants = readVariants(Project!)
	const excluded = new Map(variants.map((v) => [v.name, new Set(v.excluded)]))
	const bones = Group.all.filter((g) => g.children.some((c) => c instanceof Cube)).map((g) => g.uuid)
	const animation = view.pose && Project!.animations.find((a) => a.name === view.pose!.animation)
	const ticks = animation ? tickCount(animation) : 0
	const frameCalls = animation ? variantCalls(animation.loop, ticks, variantKeys(animation).flatMap((k) => (k.variant === null ? [] : [{ time: k.time, variant: k.variant }]))) : new Map<number, string>()
	for (const name of viewCalls(view, frameCalls, ticks)) {
		if (name !== ORIGINAL && !excluded.has(name)) throw new Error(`no variant "${name}"`)
		worn = callVariant(worn, name, excluded, bones)
	}
	Canvas.updateView({ elements: Cube.all, element_aspects: { faces: true } })
	for (const cube of Cube.all) {
		const variant = variants.find((v) => v.name === (cube.parent instanceof Group ? worn.get(cube.parent.uuid) : undefined))
		if (!variant) continue
		const replace = new Map<THREE.Material, THREE.Material>()
		for (const [from, to] of variant.textures) {
			const a = Texture.all.find((t) => t.uuid === from)
			const b = Texture.all.find((t) => t.uuid === to)
			if (a && b) replace.set(a.getMaterial() as THREE.Material, b.getMaterial() as THREE.Material)
		}
		const mesh = cube.mesh as THREE.Mesh
		const swap = (m: THREE.Material) => replace.get(m) ?? m
		mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
	}
}

// Draws only the model (no grid, gizmos or background) into a transparent image of the given size.
function render(view: View, width: number, height: number): string {
	applyPose(view.pose)
	applyVariants(view)
	const renderer = Preview.selected!.renderer
	const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.5, 30000)
	const { position, target } = blockbenchCamera(view)
	camera.position.set(...position)
	camera.lookAt(...target)

	const renderTarget = new THREE.WebGLRenderTarget(width, height)
	const previousTarget = renderer.getRenderTarget()
	const previousColor = renderer.getClearColor(new THREE.Color())
	const previousAlpha = renderer.getClearAlpha()
	const pixels = new Uint8Array(width * height * 4)
	try {
		renderer.setRenderTarget(renderTarget)
		renderer.setClearColor(0x000000, 0)
		renderer.clear()
		renderer.render(Project!.model_3d, camera)
		renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)
	} finally {
		renderer.setRenderTarget(previousTarget)
		renderer.setClearColor(previousColor, previousAlpha)
		renderTarget.dispose()
	}

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const image = new ImageData(width, height)
	// WebGL rows run bottom to top.
	for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
	canvas.getContext('2d')!.putImageData(image, 0, 0)
	return canvas.toDataURL('image/png')
}

function load(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('could not decode an image'))
		image.src = url
	})
}

// Minecraft | Blockbench | Blockbench at half opacity over Minecraft, each labelled.
async function compose(minecraft: string, blockbench: string): Promise<string> {
	const [mc, bb] = await Promise.all([load(minecraft), load(blockbench)])
	const { width, height } = mc
	const canvas = document.createElement('canvas')
	canvas.width = width * 3
	canvas.height = height
	const ctx = canvas.getContext('2d')!
	ctx.drawImage(mc, 0, 0)
	ctx.fillStyle = '#3a3f47'
	ctx.fillRect(width, 0, width, height)
	ctx.drawImage(bb, width, 0)
	ctx.drawImage(mc, width * 2, 0)
	ctx.globalAlpha = 0.5
	ctx.drawImage(bb, width * 2, 0)
	ctx.globalAlpha = 1
	ctx.font = `bold ${Math.round(height / 24)}px sans-serif`
	ctx.textBaseline = 'top'
	;['Minecraft', 'Blockbench', 'Blockbench over Minecraft'].forEach((label, i) => {
		const x = width * i + 12
		ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
		ctx.fillRect(x - 6, 6, ctx.measureText(label).width + 12, height / 24 + 12)
		ctx.fillStyle = '#ffffff'
		ctx.fillText(label, x, 12)
	})
	return canvas.toDataURL('image/png')
}

;(window as any).__rigelShot = { open, render, compose }
