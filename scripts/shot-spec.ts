// The screenshot spec mc-shot.ts reads, and the camera Minecraft and Blockbench are each given for a view.
// No Node imports: shot-harness.ts bundles this file for the Blockbench renderer.
export type Vec3 = [number, number, number]

// An animation at a tick: Blockbench shows it, and Minecraft calls the rig's frame functions up to the tick. With
// `play`, Minecraft plays it on a frozen server and steps to the tick, so the client shows what interpolation makes
// of it, as a thinned rig needs. `pause` pauses at frame `at` for `hold` ticks, then restarts if `tick` is later.
// `tween` (with play) instead plays `from` to its frame `at`, tweens to this animation's `frame` over `ticks` and
// steps `after` ticks, its `pause` pausing `at` of them in for `hold` ticks; Blockbench still shows this animation at `tick`.
export interface Pose {
	animation: string
	tick: number
	play?: boolean
	pause?: { at: number; hold: number }
	tween?: { from: string; at: number; ticks: number; frame: number; after: number; pause?: { at: number; hold: number } }
}

export interface View {
	name: string
	// Eye position in blocks, relative to the spec's origin.
	eye: Vec3
	// Minecraft's facing in degrees: yaw 0 looks south (+Z), 90 west (−X); positive pitch looks down.
	yaw: number
	pitch: number
	// Without a pose the rig shows its rest pose.
	pose?: Pose
	// A variant function of the rig, called before the pose so that played poses step it onto the client. The bones it does not
	// exclude wear it, in Minecraft and in the Blockbench drawing, until a later call changes them; default puts the project's own textures on every bone.
	variant?: string
	// Server console commands run after the pose, before the screenshot.
	commands?: string[]
}

export interface Spec {
	// The world position Blockbench's origin stands for.
	origin: Vec3
	// Name of the Rigel rig the data packs hold, needed by views with a pose.
	rig?: string
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
	const out: View = { name: v.name, eye: vec3(v.eye, `${at}.eye`), yaw: v.yaw, pitch: v.pitch }
	if (v.variant !== undefined) {
		if (typeof v.variant !== 'string' || !/^[a-z0-9_]+$/.test(v.variant)) fail(`${at}.variant must be a variant name`)
		out.variant = v.variant
	}
	if (v.commands !== undefined) out.commands = strings(v.commands, `${at}.commands`)
	if (v.pose !== undefined) {
		const p = v.pose as Record<string, unknown>
		if (typeof p.animation !== 'string' || !Number.isInteger(p.tick) || (p.tick as number) < 0) fail(`${at}.pose must be { animation: name, tick: whole number ≥ 0 }`)
		out.pose = { animation: p.animation, tick: p.tick as number }
		if (p.play !== undefined) {
			if (typeof p.play !== 'boolean') fail(`${at}.pose.play must be true or false`)
			out.pose.play = p.play
		}
		if (p.pause !== undefined) {
			const pause = p.pause as Record<string, unknown>
			const whole = (x: unknown) => Number.isInteger(x) && (x as number) >= 0
			if (!out.pose.play || !whole(pause.at) || !whole(pause.hold) || (pause.at as number) > out.pose.tick)
				fail(`${at}.pose.pause needs play and must be { at: tick ≤ pose.tick, hold: ticks }`)
			out.pose.pause = { at: pause.at as number, hold: pause.hold as number }
		}
		if (p.tween !== undefined) {
			const t = p.tween as Record<string, unknown>
			const whole = (x: unknown) => Number.isInteger(x) && (x as number) >= 0
			const pause = t.pause as Record<string, unknown> | undefined
			if (
				!out.pose.play ||
				out.pose.pause ||
				typeof t.from !== 'string' ||
				!whole(t.at) ||
				!whole(t.frame) ||
				!whole(t.after) ||
				!(whole(t.ticks) && (t.ticks as number) > 0) ||
				(pause !== undefined && !(whole(pause.at) && (pause.at as number) > 0 && (pause.at as number) <= (t.after as number) && whole(pause.hold)))
			)
				fail(`${at}.pose.tween needs play without pause and must be { from: name, at, ticks ≥ 1, frame, after, pause?: { at: 1 to after, hold } }`)
			out.pose.tween = { from: t.from, at: t.at as number, ticks: t.ticks as number, frame: t.frame as number, after: t.after as number }
			if (pause) out.pose.tween.pause = { at: pause.at as number, hold: pause.hold as number }
		}
	}
	return out
}

export function parseSpec(value: unknown): Spec {
	const s = (value ?? {}) as Record<string, unknown>
	if (!Array.isArray(s.views) || s.views.length === 0) fail('views must list at least one view')
	const views = s.views.map(view)
	const names = new Set(views.map((v) => v.name))
	if (names.size !== views.length) fail('view names must be unique')
	if (s.model !== undefined && (typeof s.model !== 'string' || !s.model.endsWith('.bbmodel'))) fail('model must be a .bbmodel path')
	if (s.settleMs !== undefined && (typeof s.settleMs !== 'number' || !(s.settleMs >= 0))) fail('settleMs must be a number of milliseconds')
	if (views.some((v) => v.pose || v.variant)) {
		if (typeof s.rig !== 'string' || !/^[a-z0-9_]+$/.test(s.rig)) fail('rig must name the rig when a view has a pose or a variant')
		if (s.model === undefined) fail('model is needed when a view has a pose or a variant')
	}
	return {
		origin: vec3(s.origin, 'origin'),
		rig: s.rig as string | undefined,
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

const TICKS_PER_SECOND = 20

// Console commands that put the rig in the view's pose: f/0 writes every bone and later frames the
// changes, so calling them in order reaches the tick from any earlier state.
export function poseCommands(spec: Spec, animations: { name: string; length: number }[], view: View): string[] {
	const variant = view.variant ? [`function rigel:${spec.rig}/variant/${view.variant}`] : []
	return [...variant, ...posing(spec, animations, view), ...(view.commands ?? [])]
}

function posing(spec: Spec, animations: { name: string; length: number }[], view: View): string[] {
	if (!spec.rig) return []
	const call = (name: string) => `function rigel:${spec.rig}/${name}`
	// A play view leaves the server frozen, where the client stops redrawing the rig, and the animation playing.
	const thaw = !view.pose?.play && spec.views.some((v) => v.pose?.play) ? ['tick unfreeze', call('stop')] : []
	if (!view.pose) return [...thaw, call('rest')]
	const index = animations.findIndex((a) => a.name === view.pose!.animation)
	if (index < 0) fail(`views ${view.name}: the model has no animation "${view.pose.animation}"`)
	const last = Math.max(0, Math.ceil(animations[index]!.length * TICKS_PER_SECOND - 1e-9))
	const tick = Math.min(view.pose.tick, last)
	if (!view.pose.play) return [...thaw, ...Array.from({ length: tick + 1 }, (_, f) => `${call(`frames/${index}/${f}`)} with storage rigel:const FrameArgs`)]
	// play writes f/0 and the first step keeps it (same game time), so frame t needs t + 1 steps.
	const start = ['tick freeze', call('stop'), `${call('play')} {ID:${index}}`]
	// A frozen client ticks entities only during server steps, and the last step's writes arrive after its last tick.
	// One more step with Rigel.Playing 0, which writes nothing unlike stop and pause, shows them.
	const playing = (n: number) => `scoreboard players set $Rigel.${spec.rig} Rigel.Playing ${n}`
	const settle = [playing(0), 'tick step 1']
	const tween = view.pose.tween
	if (tween) {
		const from = animations.findIndex((a) => a.name === tween.from)
		if (from < 0) fail(`views ${view.name}: the model has no animation "${tween.from}"`)
		// The first step after the tween keeps the tick it was called on, like play's. While it waits, nothing is written
		// for the client to catch up with before a pause.
		const step = (n: number) => (n > 0 ? [`tick step ${n}`] : [])
		const p = tween.pause
		const steps = p
			? [...step(p.at), call('pause'), ...step(p.hold), ...(tween.after > p.at ? [call('restart'), ...step(tween.after - p.at)] : [])]
			: step(tween.after)
		return ['tick freeze', call('stop'), `${call('play')} {ID:${from}}`, `tick step ${tween.at + 1}`, ...settle, playing(1), `${call('tween')} {ID:${index},ticks:${tween.ticks},frame:${tween.frame}}`, ...steps, ...settle]
	}
	const pause = view.pose.pause
	if (!pause) return [...start, `tick step ${tick + 1}`, ...settle]
	const at = Math.min(pause.at, tick)
	// pause holds the pose the client shows, so the client first catches up with frame `at`. After restart, calling
	// the rig's tick function writes the next frame at once; then one step per frame.
	const left = tick - at
	const resume = left > 0 ? [call('restart'), call('tick'), ...(left > 1 ? [`tick step ${left - 1}`] : [])] : []
	return [...start, `tick step ${at + 1}`, ...settle, playing(1), call('pause'), ...(pause.hold > 0 ? [`tick step ${pause.hold}`] : []), ...resume, ...settle]
}

// Blockbench draws a block as 16 units with its origin at the spec's origin.
export function blockbenchCamera(view: View): { position: Vec3; target: Vec3 } {
	const position = view.eye.map((v) => v * 16) as Vec3
	const d = lookDirection(view.yaw, view.pitch)
	return { position, target: position.map((v, i) => v + d[i]! * 16) as Vec3 }
}
