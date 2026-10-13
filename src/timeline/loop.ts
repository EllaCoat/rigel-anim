import { nearestTick, TICKS_PER_SECOND } from '../bake/sample'
import { isRigelProject } from '../easing/keyframes'
import { barState, onRefresh, setBarStatus, setToggle, timelineBody } from './bar'
import { loopBack, loopLabel, loopSpan, type LoopRange } from './ticks'

const MARKER = 'rigel-ab-marker'

// The z-index puts the lines over the keyframes and under the row names.
const CSS = `
.${MARKER} {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 2px;
	pointer-events: none;
	z-index: 4;
}
.${MARKER}-a { background-color: #66cc66; box-shadow: 0 0 4px rgba(102, 204, 102, 0.6); }
.${MARKER}-b { background-color: #cc6666; box-shadow: 0 0 4px rgba(204, 102, 102, 0.6); }
`

// A loop is set on an animation, so another animation or project does not show or follow it.
let ranges = new WeakMap<BBAnimation, LoopRange>()
const markers: Partial<Record<'a' | 'b', HTMLElement>> = {}

let actions: Action[] = []
let listeners: Deletable[] = []
let style: Deletable | undefined
let stopRefresh: (() => void) | undefined
let stopWatchingZoom: (() => void) | undefined

const available = (): boolean => isRigelProject() && Modes.animate

function rangeOf(animation: BBAnimation | null): LoopRange {
	return (animation && ranges.get(animation)) || {}
}

function setEnd(end: 'a' | 'b'): void {
	const animation = BBAnimation.selected
	if (!animation) return
	ranges.set(animation, { ...rangeOf(animation), [end]: nearestTick(Timeline.time) })
	show(true)
}

function clear(): void {
	const animation = BBAnimation.selected
	if (animation) ranges.delete(animation)
	show(true)
}

// A marker is drawn where Blockbench draws a keyframe of that time.
function show(active: boolean): void {
	const range = active ? rangeOf(BBAnimation.selected) : {}
	setBarStatus(loopLabel(range))
	const body = timelineBody()
	if (!body) return
	const { size, head_width } = Timeline.vue as unknown as { size: number; head_width: number }
	for (const end of ['a', 'b'] as const) {
		const tick = range[end]
		let marker = markers[end]
		if (tick === undefined && !marker) continue
		if (!marker) {
			marker = document.createElement('div')
			marker.className = `${MARKER} ${MARKER}-${end}`
			markers[end] = marker
		}
		if (marker.parentElement !== body) body.append(marker)
		marker.style.display = tick === undefined ? 'none' : 'block'
		if (tick !== undefined) marker.style.left = `${head_width + (tick / TICKS_PER_SECOND) * size + 8}px`
	}
}

let lastFrame: number | undefined
let restartAtPause = false

function playedRange(): LoopRange | undefined {
	const range = rangeOf(BBAnimation.selected)
	return barState.abLoop && isRigelProject() && Modes.animate && loopSpan(range) ? range : undefined
}

// The frame is shown after the jump back, so a pose past B is never drawn.
function loopPlayback(data?: { in_loop?: boolean }): void {
	const previous = lastFrame
	lastFrame = undefined
	const range = playedRange()
	if (!Timeline.playing || !range) return
	const inLoop = data?.in_loop
	const back = loopBack(Timeline.time, inLoop === undefined ? undefined : previous, range)
	if (back !== undefined) {
		Timeline.setTime(back)
		Animator.preview(true)
	}
	if (inLoop !== undefined) restartAtPause = inLoop === false
	lastFrame = Timeline.time
}

function restartFromA(): void {
	lastFrame = undefined
	if (!restartAtPause) return
	restartAtPause = false
	const span = loopSpan(playedRange() ?? {})
	if (!span) return
	Timeline.setTime(span.start)
	Timeline.start()
}

export function registerAbLoop(): void {
	style = Blockbench.addCSS(CSS)
	actions = [
		new Action('rigel_set_loop_start', {
			name: 'Rigel：A-B ループの A を再生位置に置く',
			icon: 'first_page',
			category: 'animation',
			keybind: new Keybind({ key: 'a', alt: true, shift: true }),
			condition: available,
			click: () => setEnd('a'),
		}),
		new Action('rigel_set_loop_end', {
			name: 'Rigel：A-B ループの B を再生位置に置く',
			icon: 'last_page',
			category: 'animation',
			keybind: new Keybind({ key: 'b', alt: true, shift: true }),
			condition: available,
			click: () => setEnd('b'),
		}),
		new Action('rigel_toggle_ab_loop', {
			name: 'Rigel：A-B ループの入切',
			icon: 'loop',
			category: 'animation',
			keybind: new Keybind({ key: 'l', alt: true, shift: true }),
			condition: available,
			click: () => setToggle('abLoop', !barState.abLoop),
		}),
		new Action('rigel_clear_ab_loop', {
			name: 'Rigel：A-B ループの範囲を解除',
			icon: 'clear',
			category: 'animation',
			keybind: new Keybind({ key: 'x', alt: true, shift: true }),
			condition: available,
			click: clear,
		}),
	]
	listeners = [
		Blockbench.on('display_animation_frame', (data) => loopPlayback(data as { in_loop?: boolean })),
		Blockbench.on('timeline_pause', restartFromA),
	]
	stopRefresh = onRefresh(show)
	const timeline = Timeline.vue as unknown as { size: number; head_width: number; $watch(source: () => string, callback: () => void): () => void }
	stopWatchingZoom = timeline.$watch(
		() => `${timeline.size}:${timeline.head_width}`,
		() => show(isRigelProject()),
	)
}

export function unregisterAbLoop(): void {
	stopWatchingZoom?.()
	stopWatchingZoom = undefined
	stopRefresh?.()
	stopRefresh = undefined
	for (const listener of listeners) listener.delete()
	listeners = []
	for (const action of actions) action.delete()
	actions = []
	for (const end of ['a', 'b'] as const) {
		markers[end]?.remove()
		delete markers[end]
	}
	style?.delete()
	style = undefined
	ranges = new WeakMap()
	lastFrame = undefined
	restartAtPause = false
}
