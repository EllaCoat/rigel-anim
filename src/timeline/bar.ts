import { isRigelProject } from '../easing/keyframes'
import { rowVisible } from './rows'

export type ToggleKey = 'keyframesOnly' | 'onlySelected' | 'abLoop' | 'onionSkin'

interface BarState {
	query: string
	keyframesOnly: boolean
	onlySelected: boolean
	abLoop: boolean
	onionSkin: boolean
}

const initialState = (): BarState => ({ query: '', keyframesOnly: false, onlySelected: false, abLoop: false, onionSkin: false })

export const barState: BarState = initialState()

const BAR = 'rigel-timeline-bar'
const SEARCH = 'rigel-timeline-search'
const TOGGLE = 'rigel-timeline-toggle'
const STATUS = 'rigel-timeline-status'
const HIDDEN = 'rigelHidden'

const TOGGLES: { key: ToggleKey; icon: string; title: string }[] = [
	{ key: 'keyframesOnly', icon: 'filter_alt', title: 'キーフレームのある行だけ表示します（Effects の Variant も数えます）。' },
	{ key: 'onlySelected', icon: 'link', title: 'アウトライナーで選んでいる行だけ表示します（Effects は常に表示）。' },
	{ key: 'abLoop', icon: 'loop', title: 'A-B ループ：再生中に B を過ぎたら A に戻ります。Alt+Shift+A で A、Alt+Shift+B で B、Alt+Shift+L で切り替え、Alt+Shift+X で解除します。' },
	{ key: 'onionSkin', icon: 'layers', title: 'オニオンスキン：選んでいる Group の前後の tick を重ねて表示します。範囲は Animation メニューの「オニオンスキンの範囲…」で変えます。' },
]

const CSS = `
.${BAR} {
	display: flex;
	gap: 4px;
	padding: 4px 6px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-back);
	align-items: center;
}
.${SEARCH} {
	flex: 1;
	min-width: 80px;
	padding: 2px 6px;
	background: var(--color-button);
	color: var(--color-text);
	border: 1px solid var(--color-border);
	border-radius: 2px;
	font-size: 12px;
}
.${TOGGLE} {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	min-width: 0;
	flex: 0 0 24px;
	padding: 0;
	box-shadow: none;
	background: transparent;
	color: var(--color-text);
	border: 1px solid transparent;
	border-radius: 2px;
	cursor: pointer;
}
.${TOGGLE}:hover { background: var(--color-button); }
.${TOGGLE}.active {
	background: var(--color-accent);
	color: var(--color-accent_text, white);
}
.${TOGGLE} i { font-size: 16px; margin: 0; }
.${STATUS} {
	font-size: 11px;
	color: var(--color-subtle_text);
	white-space: nowrap;
	margin-left: 4px;
	font-family: var(--font-code, monospace);
}
`

const toggleListeners = new Set<(key: ToggleKey) => void>()
const refreshListeners = new Set<(active: boolean) => void>()

let bar: HTMLElement | undefined
let laidOutFor: boolean | undefined
let status: HTMLElement | undefined
let statusText = '—'
let observer: MutationObserver | undefined
let observed: HTMLElement | undefined
let pending: number | undefined
let style: Deletable | undefined
let listeners: Deletable[] = []

// The root of the Timeline panel's Vue component.
export const timelineRoot = (): HTMLElement | undefined => Timeline.vue?.$el as HTMLElement | undefined

// The element that holds the animator rows, and what is drawn over them.
export const timelineBody = (): HTMLElement | undefined => timelineRoot()?.querySelector<HTMLElement>('#timeline_body_inner') ?? undefined

// Called when a toggle is switched, by the bar's button or by a shortcut.
export function onToggle(listener: (key: ToggleKey) => void): () => void {
	toggleListeners.add(listener)
	return () => toggleListeners.delete(listener)
}

// Called now, and after each time the bar is brought up to date, with whether the bar is in use: it is only in a Rigel project.
export function onRefresh(listener: (active: boolean) => void): () => void {
	refreshListeners.add(listener)
	listener(isRigelProject())
	return () => refreshListeners.delete(listener)
}

export function setToggle(key: ToggleKey, on: boolean): void {
	if (barState[key] === on) return
	barState[key] = on
	for (const listener of toggleListeners) listener(key)
	refresh()
}

export function setBarStatus(text: string): void {
	statusText = text
	if (status) status.textContent = text
}

function setRowHidden(row: HTMLElement, hidden: boolean): void {
	if (hidden) {
		row.style.display = 'none'
		row.dataset[HIDDEN] = ''
	} else if (HIDDEN in row.dataset) {
		row.style.display = ''
		delete row.dataset[HIDDEN]
	}
}

// Vue reuses a row element for another animator, so a row is only given back when this bar is what hid it.
function showAllRows(): void {
	for (const row of timelineBody()?.querySelectorAll<HTMLElement>('li.animator') ?? []) setRowHidden(row, false)
}

const shown = (animator: GeneralAnimator): boolean =>
	rowVisible(
		{
			name: animator.name,
			hasKeyframes: animator.keyframes.length > 0,
			selected: !!OutlinerNode.uuids[animator.uuid]?.selected,
			effects: animator instanceof EffectAnimator,
		},
		barState,
	)

const graphEditorOpen = (): boolean => (Timeline.vue as unknown as { graph_editor_open: boolean }).graph_editor_open

function applyFilter(): void {
	const body = timelineBody()
	if (!body) return
	const animators = new Map(Timeline.animators.map((animator) => [animator.uuid as string, animator]))
	for (const row of body.querySelectorAll<HTMLElement>('li.animator')) {
		const animator = animators.get(row.getAttribute('uuid') ?? '')
		if (animator) setRowHidden(row, !shown(animator))
	}
	deselectHidden()
}

// Blockbench selects keyframes of every row, hidden ones included: select all, Shift with a click on the time ruler, and a
// box selection, which places a row's keyframes by the row's offsetTop, 0 for a hidden row.
// The graph editor shows the keyframes of the selected row by their values, whether the row is hidden or not.
function deselectHidden(): void {
	if (graphEditorOpen()) return
	const dropped = Timeline.selected.filter((keyframe) => !shown(keyframe.animator))
	if (dropped.length === 0) return
	for (const keyframe of dropped) {
		keyframe.selected = false
		Timeline.selected.remove(keyframe)
	}
	updateKeyframeSelection()
}

function selectAllShown(): void {
	const keyframes = Timeline.keyframes.filter((keyframe) => shown(keyframe.animator))
	const select = keyframes.some((keyframe) => !keyframe.selected)
	for (const keyframe of keyframes) {
		if (select && !keyframe.selected) Timeline.selected.push(keyframe)
		if (!select) Timeline.selected.remove(keyframe)
		keyframe.selected = select
	}
	updateKeyframeSelection()
}

let originalScrollTo: GeneralAnimator['scrollTo'] | undefined

function scrollToShownRow(this: GeneralAnimator): GeneralAnimator {
	if (isRigelProject()) {
		applyFilter()
		if (!shown(this)) return this
	}
	originalScrollTo?.call(this)
	return this
}

function buildBar(): HTMLElement {
	const element = document.createElement('div')
	element.className = BAR
	const search = document.createElement('input')
	search.type = 'text'
	search.className = SEARCH
	search.placeholder = '名前で検索…'
	search.title = 'Timeline の行を名前で絞り込みます（Effects の行も対象です）。'
	search.value = barState.query
	search.addEventListener('input', () => {
		barState.query = search.value
		applyFilter()
	})
	element.append(search)
	for (const toggle of TOGGLES) {
		const button = document.createElement('button')
		button.className = TOGGLE
		button.title = toggle.title
		button.dataset.key = toggle.key
		const icon = document.createElement('i')
		icon.className = 'material-icons'
		icon.textContent = toggle.icon
		button.append(icon)
		button.addEventListener('click', () => setToggle(toggle.key, !barState[toggle.key]))
		element.append(button)
	}
	status = document.createElement('span')
	status.className = STATUS
	status.title = 'A-B ループの A と B です。単位は tick（1 秒 = 20 tick）です。'
	status.textContent = statusText
	element.append(status)
	return element
}

// The component takes the height the bar leaves, but only reads its own height when the panel is resized.
const resizeTimeline = (): void => Interface.Panels.timeline?.onResize()

// Above the Timeline, outside the component, so that it is not redrawn with it.
function placeBar(): void {
	const root = timelineRoot()
	if (!root?.parentElement) return
	bar ??= buildBar()
	if (bar.nextElementSibling !== root) root.parentElement.insertBefore(bar, root)
}

function watchRows(): void {
	const body = timelineBody()
	if (body === observed) return
	observer?.disconnect()
	observed = body
	if (body) observer?.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['uuid'] })
}

function refresh(): void {
	if (pending !== undefined) {
		cancelAnimationFrame(pending)
		pending = undefined
	}
	const active = isRigelProject()
	watchRows()
	placeBar()
	if (bar) {
		bar.style.display = active ? '' : 'none'
		for (const button of bar.querySelectorAll<HTMLElement>(`.${TOGGLE}`)) button.classList.toggle('active', barState[button.dataset.key as ToggleKey])
	}
	if (laidOutFor !== active) {
		laidOutFor = active
		resizeTimeline()
	}
	if (active) applyFilter()
	else showAllRows()
	for (const listener of refreshListeners) listener(active)
}

function scheduleRefresh(): void {
	pending ??= requestAnimationFrame(refresh)
}

export function registerTimelineBar(): void {
	style = Blockbench.addCSS(CSS)
	observer = new MutationObserver(scheduleRefresh)
	listeners = [
		...(['select_project', 'unselect_project', 'select_mode', 'select_animation', 'finished_edit', 'undo', 'redo'] as const).map((name) =>
			Blockbench.on(name, scheduleRefresh),
		),
		// The row elements are reused for the next project, where another plugin may hide rows before this bar refreshes.
		Blockbench.on('unselect_project', showAllRows),
		Blockbench.on('convert_format', () => {
			if (!isRigelProject()) showAllRows()
			scheduleRefresh()
		}),
		Blockbench.on('update_selection', () => {
			if (barState.onlySelected) scheduleRefresh()
		}),
		Blockbench.on('update_keyframe_selection', () => {
			if (isRigelProject()) deselectHidden()
		}),
		SharedActions.add('select_all', {
			subject: 'rigel_timeline_shown_rows',
			condition: () => Animator.open && Prop.active_panel === 'timeline' && !!BBAnimation.selected && isRigelProject() && !graphEditorOpen() && Timeline.animators.some((animator) => !shown(animator)),
			run: selectAllShown,
		}),
	]
	originalScrollTo = GeneralAnimator.prototype.scrollTo
	GeneralAnimator.prototype.scrollTo = scrollToShownRow
	refresh()
}

export function unregisterTimelineBar(): void {
	if (pending !== undefined) cancelAnimationFrame(pending)
	pending = undefined
	observer?.disconnect()
	observer = undefined
	observed = undefined
	for (const listener of listeners) listener.delete()
	listeners = []
	if (originalScrollTo) GeneralAnimator.prototype.scrollTo = originalScrollTo
	originalScrollTo = undefined
	showAllRows()
	if (bar) {
		bar.remove()
		resizeTimeline()
	}
	bar = undefined
	laidOutFor = undefined
	status = undefined
	statusText = '—'
	style?.delete()
	style = undefined
	Object.assign(barState, initialState())
}
