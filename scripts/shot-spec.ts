// The screenshot spec mc-shot.ts reads, and the camera Minecraft and Blockbench are each given for a view.
// No Node imports: shot-harness.ts bundles this file for the Blockbench renderer.
export type Vec3 = [number, number, number]

export interface View {
	name: string
	// Eye position in blocks, relative to the spec's origin.
	eye: Vec3
	// Minecraft's facing in degrees: yaw 0 looks south (+Z), 90 west (−X); positive pitch looks down.
	yaw: number
	pitch: number
}

export interface Spec {
	// The world position Blockbench's origin stands for.
	origin: Vec3
	views: View[]
	// Server console commands run once the player has joined, before the first view.
	setup: string[]
	// Folders, relative to the spec, copied into the new world's datapacks before the server starts.
	datapacks: string[]
	// Folders, relative to the spec, enabled in the client on top of the vanilla resources.
	resourcePacks: string[]
	// A .bbmodel, relative to the spec, drawn in the development Blockbench from the same views.
	model?: string
	// Wait after each teleport before the screenshot, so the client has drawn the new position.
	settleMs: number
}

// Standing eye height; spectators stand.
export const EYE_HEIGHT = 1.62
// The client's options.txt sets this FOV and turns the FOV effects off, so the vertical field of view is exactly this.
export const FOV = 70
const DEFAULT_SETTLE_MS = 1500

function fail(message: string): never {
	throw new Error(`spec: ${message}`)
}

function vec3(value: unknown, field: string): Vec3 {
	if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => typeof v === 'number' && Number.isFinite(v)))
		fail(`${field} must be three numbers`)
	return [value[0], value[1], value[2]]
}

function strings(value: unknown, field: string): string[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) fail(`${field} must be a list of strings`)
	return value
}

function view(value: unknown, i: number): View {
	const v = (value ?? {}) as Record<string, unknown>
	const at = `views[${i}]`
	if (typeof v.name !== 'string' || !/^[\w-]+$/.test(v.name)) fail(`${at}.name must be letters, digits, _ or -`)
	if (typeof v.yaw !== 'number' || !Number.isFinite(v.yaw)) fail(`${at}.yaw must be a number`)
	// Straight up or down leaves Blockbench's camera without an up direction.
	if (typeof v.pitch !== 'number' || !(Math.abs(v.pitch) < 90)) fail(`${at}.pitch must be between -90 and 90 (exclusive)`)
	return { name: v.name, eye: vec3(v.eye, `${at}.eye`), yaw: v.yaw, pitch: v.pitch }
}

export function parseSpec(value: unknown): Spec {
	const s = (value ?? {}) as Record<string, unknown>
	if (!Array.isArray(s.views) || s.views.length === 0) fail('views must list at least one view')
	const views = s.views.map(view)
	const names = new Set(views.map((v) => v.name))
	if (names.size !== views.length) fail('view names must be unique')
	if (s.model !== undefined && (typeof s.model !== 'string' || !s.model.endsWith('.bbmodel'))) fail('model must be a .bbmodel path')
	if (s.settleMs !== undefined && (typeof s.settleMs !== 'number' || !(s.settleMs >= 0))) fail('settleMs must be a number of milliseconds')
	return {
		origin: vec3(s.origin, 'origin'),
		views,
		setup: strings(s.setup, 'setup'),
		datapacks: strings(s.datapacks, 'datapacks'),
		resourcePacks: strings(s.resourcePacks, 'resourcePacks'),
		model: s.model as string | undefined,
		settleMs: (s.settleMs as number | undefined) ?? DEFAULT_SETTLE_MS,
	}
}

export function lookDirection(yaw: number, pitch: number): Vec3 {
	const y = (yaw * Math.PI) / 180
	const p = (pitch * Math.PI) / 180
	return [-Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)]
}

// Always with a decimal point: /tp, like /summon, moves a whole-number x or z to the block's centre.
const coordinate = (x: number) => x.toFixed(4)

// The /tp position and rotation that put the player's eye at the view's eye.
export function teleportArgs(spec: Spec, view: View): string {
	const [x, y, z] = view.eye.map((v, i) => v + spec.origin[i]!) as Vec3
	return [x, y - EYE_HEIGHT, z, view.yaw, view.pitch].map(coordinate).join(' ')
}

// Blockbench draws a block as 16 units with its origin at the spec's origin.
export function blockbenchCamera(view: View): { position: Vec3; target: Vec3 } {
	const position = view.eye.map((v) => v * 16) as Vec3
	const d = lookDirection(view.yaw, view.pitch)
	return { position, target: position.map((v, i) => v + d[i]! * 16) as Vec3 }
}
