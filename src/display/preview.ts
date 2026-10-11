import type { DisplaySettings } from '../export/types'
import { textJson } from '../export/display'
import { isRigelProject } from '../easing/keyframes'
import { readDisplay } from './settings'

// Blockbench's three.js; the types declare it as a UMD global, which modules cannot use as a value.
const three = (globalThis as unknown as { THREE: typeof import('three') }).THREE
const PREVIEW = 'rigel_display_preview'
// Blockbench pixels per text pixel: a text_display draws one text pixel 0.025 blocks wide.
const TEXT_PIXEL = 0.025 * 16

type Setup = (group: Group) => unknown
let originalSetup: Setup | undefined
// Text previews resolve later; a newer refresh of the same group wins.
const pending = new WeakMap<Group, number>()
let serial = 0

export interface TextImage {
	canvas: HTMLCanvasElement
	// Text pixels, as Minecraft lays them out: W is the longest line, H is 10 per line.
	width: number
	height: number
}

export type TextDrawer = (display: Extract<DisplaySettings, { kind: 'text' }>) => Promise<TextImage>
let drawText: TextDrawer = fallbackText

export function setTextDrawer(drawer: TextDrawer | undefined): void {
	drawText = drawer ?? fallbackText
	refreshAll()
}

function plainText(text: string): string {
	const visit = (c: unknown): string => {
		if (typeof c === 'string') return c
		if (Array.isArray(c)) return c.map(visit).join('')
		if (typeof c === 'object' && c !== null) {
			const o = c as Record<string, unknown>
			const own = typeof o.text === 'string' ? o.text : typeof o.translate === 'string' ? o.translate : ''
			return own + (Array.isArray(o.extra) ? o.extra.map(visit).join('') : '')
		}
		return String(c)
	}
	return visit(JSON.parse(textJson(text)))
}

// Without Minecraft's font: the browser's, at the size of Minecraft's 8-pixel glyphs.
async function fallbackText(display: Extract<DisplaySettings, { kind: 'text' }>): Promise<TextImage> {
	const scale = 4
	const canvas = document.createElement('canvas')
	const ctx = canvas.getContext('2d')!
	const font = `${8 * scale}px sans-serif`
	ctx.font = font
	const lines = plainText(display.text).split('\n')
	const widths = lines.map((l) => Math.ceil(ctx.measureText(l).width / scale))
	const width = Math.max(0, ...widths)
	const height = lines.length * 10
	canvas.width = (width + 1) * scale
	canvas.height = (height + 1) * scale
	const background = display.defaultBackground ? 0x40000000 : display.background
	const alpha = ((background >>> 24) & 0xff) / 255
	if (alpha > 0) {
		ctx.fillStyle = `rgba(${(background >> 16) & 0xff},${(background >> 8) & 0xff},${background & 0xff},${alpha})`
		ctx.fillRect(0, 0, canvas.width, canvas.height)
	}
	ctx.font = font
	ctx.textBaseline = 'top'
	ctx.fillStyle = `rgba(255,255,255,${display.textOpacity / 255})`
	lines.forEach((line, i) => {
		const w = widths[i]!
		const u = display.alignment === 'left' ? 0 : display.alignment === 'right' ? width - w : width / 2 - w / 2
		ctx.fillText(line, (u + 1) * scale, (i * 10 + 1) * scale)
	})
	return { canvas, width, height }
}

function texturedPlane(canvas: HTMLCanvasElement, width: number, height: number, side: THREE.Side): THREE.Mesh {
	const texture = new three.CanvasTexture(canvas)
	texture.magFilter = three.NearestFilter
	texture.minFilter = three.NearestFilter
	return new three.Mesh(new three.PlaneGeometry(width, height), new three.MeshBasicMaterial({ map: texture, transparent: true, side, alphaTest: 0.01 }))
}

function label(text: string, background: string): HTMLCanvasElement {
	const canvas = document.createElement('canvas')
	canvas.width = 256
	canvas.height = 256
	const ctx = canvas.getContext('2d')!
	ctx.fillStyle = background
	ctx.fillRect(0, 0, 256, 256)
	ctx.strokeStyle = '#ffffff'
	ctx.lineWidth = 8
	ctx.strokeRect(4, 4, 248, 248)
	ctx.fillStyle = '#ffffff'
	ctx.font = '28px sans-serif'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	const words = text.replace(/^minecraft:/, '').split(/(?=[/:_])/)
	words.forEach((w, i) => ctx.fillText(w, 128, 128 + (i - (words.length - 1) / 2) * 32))
	return canvas
}

// Block displays draw the block from their origin towards +x, +y and +z.
function blockPreview(display: Extract<DisplaySettings, { kind: 'block' }>): THREE.Object3D {
	const texture = new three.CanvasTexture(label(display.block, 'rgba(90,140,200,0.45)'))
	const box = new three.Mesh(new three.BoxGeometry(16, 16, 16), new three.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }))
	box.position.set(8, 8, 8)
	const edges = new three.LineSegments(new three.EdgesGeometry(box.geometry), new three.LineBasicMaterial({ color: 0xffffff }))
	box.add(edges)
	return box
}

// Item displays centre the item model and turn it half around y: a flat item faces -z.
function itemPreview(display: Extract<DisplaySettings, { kind: 'item' }>): THREE.Object3D {
	const plane = texturedPlane(label(display.item, 'rgba(200,140,60,0.6)'), 16, 16, three.DoubleSide)
	plane.rotation.y = Math.PI
	return plane
}

function textPreview(group: Group, display: Extract<DisplaySettings, { kind: 'text' }>, root: THREE.Object3D): void {
	const token = ++serial
	pending.set(group, token)
	void drawText(display).then((image) => {
		if (pending.get(group) !== token) return
		// The image covers u from -1 to W and v from -1 to H; v = H sits on the origin, centred on W / 2 - 1 / 2.
		const plane = texturedPlane(image.canvas, (image.width + 1) * TEXT_PIXEL, (image.height + 1) * TEXT_PIXEL, three.FrontSide)
		plane.position.set(TEXT_PIXEL / 2, ((image.height + 1) * TEXT_PIXEL) / 2, 0)
		root.add(plane)
	})
}

export function refreshDisplayPreview(group: Group): void {
	const mesh = group.mesh as THREE.Object3D | undefined
	if (!mesh) return
	for (const old of mesh.children.filter((c) => c.name === PREVIEW)) mesh.remove(old)
	pending.delete(group)
	const display = isRigelProject() ? readDisplay(group) : undefined
	if (!display) return
	const root = new three.Object3D()
	root.name = PREVIEW
	root.scale.set(...display.scale)
	if (display.kind === 'block') root.add(blockPreview(display))
	else if (display.kind === 'item') root.add(itemPreview(display))
	else textPreview(group, display, root)
	mesh.add(root)
}

function refreshAll(): void {
	if (Project) for (const group of Group.all) refreshDisplayPreview(group)
}

// Group meshes are made anew when a project loads or groups are pasted; the preview goes with each new mesh.
export function registerDisplayPreview(): void {
	const controller = Group.preview_controller as unknown as { setup: Setup }
	const original = controller.setup
	originalSetup = original
	controller.setup = function (this: unknown, group: Group) {
		const result = original.call(this, group)
		refreshDisplayPreview(group)
		return result
	}
	refreshAll()
}

export function unregisterDisplayPreview(): void {
	if (originalSetup) (Group.preview_controller as unknown as { setup: Setup }).setup = originalSetup
	originalSetup = undefined
	if (Project) for (const group of Group.all) for (const old of (group.mesh as THREE.Object3D).children.filter((c) => c.name === PREVIEW)) group.mesh.remove(old)
}
