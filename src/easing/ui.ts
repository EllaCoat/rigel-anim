// The keyframe context menu entry and the preset dialog.
import type { CustomMenuItem, MenuItem } from 'blockbench-types/generated/interface/menu'
import {
	builtinEasings,
	DEFAULT_AMPLITUDE,
	DEFAULT_OVERSHOOT,
	defaultPeriod,
	ease,
	FAMILIES,
	functionName,
	isEasing,
	MODES,
	sameCurve,
	type BezierCurve,
	type Easing,
	type EasingCurve,
	type Family,
	type FunctionCurve,
	type Mode,
} from './curves'
import { channelKeyframes, getEasing, isRigelProject, setEasing } from './keyframes'
import { loadPresets, mergePresets, parsePresetFile, presetFile, savePresets } from './presets'
import { segmentKind } from './segments'

const MENU_ID = 'rigel_easing'
const MODE_LABEL: Record<Mode, string> = { in: 'In', out: 'Out', inOut: 'InOut' }
const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/** A small plot of the curve as an image data URL, for menus and lists. */
export function curveIcon(curve: EasingCurve): string {
	const points: string[] = []
	for (let i = 0; i <= 32; i++) {
		const t = i / 32
		const y = Math.min(1.3, Math.max(-0.3, ease(curve, t)))
		points.push(`${(3 + t * 18).toFixed(2)},${(18 - y * 12).toFixed(2)}`)
	}
	const svg =
		`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
		`<path d='M3 18H21M3 6H21' stroke='#7a8091' stroke-width='0.75' stroke-dasharray='1.5 1.5'/>` +
		`<polyline points='${points.join(' ')}' fill='none' stroke='#9db4ff' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/></svg>`
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function selectedKeyframes(): BBKeyframe[] {
	return Timeline.selected.filter((k) => k.transform)
}

function refreshAnimation(): void {
	Animator.preview()
	updateKeyframeSelection()
	// The graph editor caches its curves until one of its inputs changes.
	const vue = (Timeline as unknown as { vue?: { show_zero_line: boolean } }).vue
	if (vue) {
		vue.show_zero_line = !vue.show_zero_line
		vue.show_zero_line = !vue.show_zero_line
	}
}

function applyEasing(easing: Easing | undefined): void {
	const keyframes = selectedKeyframes()
	if (keyframes.length === 0) return
	Undo.initEdit({ keyframes })
	for (const k of keyframes) setEasing(k, easing && { name: easing.name, curve: tidyCurve(easing.curve) })
	Undo.finishEdit(easing ? `Set easing ${easing.name}` : 'Remove easing')
	refreshAnimation()
}

function easingMenuItem(easing: Easing): CustomMenuItem {
	return {
		name: easing.name,
		icon: curveIcon(easing.curve),
		marked: () => {
			const keyframes = selectedKeyframes()
			return keyframes.length > 0 && keyframes.every((k) => {
				const e = getEasing(k)
				return !!e && e.name === easing.name && sameCurve(e.curve, easing.curve)
			})
		},
		click: () => applyEasing(easing),
	}
}

function menuChildren(): MenuItem[] {
	const builtins = builtinEasings()
	const presets = loadPresets()
	return [
		{ name: 'なし', icon: 'block', click: () => applyEasing(undefined) },
		'_',
		...FAMILIES.map(
			(family): CustomMenuItem => ({
				name: capitalize(family),
				icon: curveIcon({ type: 'function', family, mode: 'inOut' }),
				children: builtins.filter((e) => e.curve.type === 'function' && e.curve.family === family).map(easingMenuItem),
			}),
		),
		...(presets.length ? ['_', ...presets.map(easingMenuItem)] : []),
		'_',
		{ name: 'プリセットを管理…', icon: 'tune', click: () => openPresetDialog() },
	]
}

const menuItem: CustomMenuItem = {
	id: MENU_ID,
	name: 'イージング',
	icon: curveIcon({ type: 'function', family: 'cubic', mode: 'inOut' }),
	condition: () => isRigelProject() && selectedKeyframes().length > 0,
	children: menuChildren,
}

/** Only the parameters of the curve's family, with defaults left out. */
function tidyCurve(curve: EasingCurve): EasingCurve {
	if (curve.type === 'bezier') return { type: 'bezier', x1: curve.x1, y1: curve.y1, x2: curve.x2, y2: curve.y2 }
	const tidy: FunctionCurve = { type: 'function', family: curve.family, mode: curve.mode }
	if (curve.family === 'back' && curve.overshoot !== undefined) tidy.overshoot = curve.overshoot
	if (curve.family === 'elastic') {
		if (curve.amplitude !== undefined) tidy.amplitude = curve.amplitude
		if (curve.period !== undefined) tidy.period = curve.period
	}
	return tidy
}

// Vue 2 only tracks properties present when an object becomes reactive, so the editor gets every key.
function editable(easing: Easing): Easing {
	const c = easing.curve
	if (c.type === 'bezier') return { name: easing.name, curve: { ...c } }
	return { name: easing.name, curve: { type: 'function', family: c.family, mode: c.mode, overshoot: c.overshoot, amplitude: c.amplitude, period: c.period } }
}

const UNNAMED = '名前なし'

// Presets as saved and exported: a preset whose name was cleared keeps a placeholder name instead
// of being dropped.
function storable(presets: Easing[]): Easing[] {
	return presets.map((p) => ({ name: p.name.trim() || UNNAMED, curve: tidyCurve(p.curve) })).filter(isEasing)
}

function uniqueName(base: string, presets: Easing[]): string {
	const names = new Set(presets.map((p) => p.name))
	if (!names.has(base)) return base
	for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
}

/** The bézier of the first selected keyframe's segment, normalized on the axis that moves most. */
function bezierFromSelection(): BezierCurve | string {
	const keyframe = selectedKeyframes()[0]
	if (!keyframe) return 'キーフレームを選んでから取り込んで'
	const sorted = channelKeyframes(keyframe)
	const after = sorted[sorted.indexOf(keyframe) + 1]
	if (!after) return '選んだキーフレームの後ろに同じチャンネルのキーフレームがない'
	if (segmentKind(keyframe, after) !== 'bezier') return '選んだキーフレームから始まる区間が bezier ではない'
	const gap = after.time - keyframe.time
	const deltas = ([0, 1, 2] as const).map((i) => after.calc((['x', 'y', 'z'] as const)[i], 0) - keyframe.calc((['x', 'y', 'z'] as const)[i], 1))
	const axis = deltas.reduce((best, d, i) => (Math.abs(d) > Math.abs(deltas[best]!) ? i : best), 0)
	const delta = deltas[axis]!
	if (gap <= 0 || Math.abs(delta) < 1e-6) return '区間の値が変わらないので形を取り出せない'
	const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
	const round = (x: number) => Math.round(x * 1000) / 1000
	return {
		type: 'bezier',
		x1: round(clamp01(keyframe.bezier_right_time[axis]! / gap)),
		y1: round(keyframe.bezier_right_value[axis]! / delta),
		x2: round(clamp01(1 + after.bezier_left_time[axis]! / gap)),
		y2: round(1 + after.bezier_left_value[axis]! / delta),
	}
}

// Plot coordinates: x from 0 to 1 spans 40..200; the value range shown spans 220..20.
const PLOT = { size: 240, left: 40, span: 160, top: 20, height: 200 }
// Béziers get room for their handles; function curves are fitted, overshoot included.
const BEZIER_RANGE: [number, number] = [-0.5, 1.5]

let dialog: Dialog | undefined

function presetDialogComponent(): Vue.Component {
	return {
		data: () => ({
			presets: loadPresets().map(editable),
			index: loadPresets().length ? 0 : -1,
			families: FAMILIES,
			modes: MODES,
			modeLabel: MODE_LABEL,
			dragging: 0,
			dragRange: null as [number, number] | null,
			phase: 0,
			frame: 0,
		}),
		computed: {
			current(): Easing | undefined {
				return (this as any).presets[(this as any).index]
			},
			range(): [number, number] {
				const self = this as any
				const current = self.current as Easing | undefined
				if (self.dragRange) return self.dragRange
				let [lo, hi] = current?.curve.type === 'bezier' ? BEZIER_RANGE : [0, 1]
				if (current) {
					const values = Array.from({ length: 101 }, (_, i) => ease(current.curve, i / 100))
					if (current.curve.type === 'bezier') values.push(current.curve.y1, current.curve.y2)
					lo = Math.min(lo, ...values)
					hi = Math.max(hi, ...values)
				}
				const margin = (hi - lo) * 0.05
				return [lo - margin, hi + margin]
			},
			curvePath(): string {
				const self = this as any
				const current = self.current as Easing | undefined
				if (!current) return ''
				const points: string[] = []
				for (let i = 0; i <= 100; i++) {
					const t = i / 100
					points.push(`${self.x(t)},${self.y(ease(current.curve, t))}`)
				}
				return `M${points.join('L')}`
			},
			linearLeft(): string {
				return `${(this as any).phase * 100}%`
			},
			easedLeft(): string {
				const current = (this as any).current as Easing | undefined
				return `${(current ? ease(current.curve, (this as any).phase) : 0) * 100}%`
			},
		},
		watch: {
			presets: {
				deep: true,
				handler(presets: Easing[]) {
					savePresets(storable(presets))
				},
			},
		},
		mounted() {
			const start = performance.now()
			const tick = (now: number) => {
				// Closing the dialog only detaches it, so the preview stops once it leaves the document.
				if (!(this as any).$el?.isConnected) return
				// 1.2 s of motion, then 0.4 s at the end.
				;(this as any).phase = Math.min(1, ((now - start) % 1600) / 1200)
				;(this as any).frame = requestAnimationFrame(tick)
			}
			;(this as any).frame = requestAnimationFrame(tick)
		},
		beforeDestroy() {
			cancelAnimationFrame((this as any).frame)
		},
		methods: {
			icon: curveIcon,
			defaultPeriod,
			x: (v: number) => PLOT.left + v * PLOT.span,
			y(v: number): number {
				const [lo, hi] = (this as any).range as [number, number]
				return PLOT.top + ((hi - v) / (hi - lo)) * PLOT.height
			},
			add(curve: EasingCurve, name: string) {
				const self = this as any
				self.presets.push(editable({ name: uniqueName(name, self.presets), curve }))
				self.index = self.presets.length - 1
			},
			addBezier() {
				;(this as any).add({ type: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, 'ベジェ')
			},
			addFunction() {
				;(this as any).add({ type: 'function', family: 'back', mode: 'out', overshoot: DEFAULT_OVERSHOOT }, functionName('back', 'out'))
			},
			fromSelection() {
				const curve = bezierFromSelection()
				if (typeof curve === 'string') Blockbench.showQuickMessage(curve, 2500)
				else (this as any).add(curve, '取り込んだベジェ')
			},
			remove() {
				const self = this as any
				self.presets.splice(self.index, 1)
				self.index = Math.min(self.index, self.presets.length - 1)
			},
			setParam(key: 'overshoot' | 'amplitude' | 'period', text: string) {
				const curve = (this as any).current.curve as FunctionCurve
				const value = text.trim() === '' ? undefined : Number(text)
				if (value === undefined || (Number.isFinite(value) && (key !== 'period' || value > 0))) curve[key] = value
			},
			setBezier(key: 'x1' | 'y1' | 'x2' | 'y2', text: string) {
				const curve = (this as any).current.curve as BezierCurve
				let value = Number(text)
				if (text.trim() === '' || !Number.isFinite(value)) return
				if (key === 'x1' || key === 'x2') value = Math.min(1, Math.max(0, value))
				curve[key] = value
			},
			startDrag(handle: number, event: PointerEvent) {
				// The range stays put while dragging, so the handle follows the pointer.
				;(this as any).dragRange = (this as any).range
				;(this as any).dragging = handle
				;(event.target as Element).setPointerCapture?.(event.pointerId)
			},
			drag(event: PointerEvent) {
				const self = this as any
				if (!self.dragging || self.current?.curve.type !== 'bezier') return
				const rect = (self.$refs.plot as SVGSVGElement).getBoundingClientRect()
				const px = ((event.clientX - rect.left) * PLOT.size) / rect.width
				const py = ((event.clientY - rect.top) * PLOT.size) / rect.height
				const round = (v: number) => Math.round(v * 1000) / 1000
				const curve = self.current.curve as BezierCurve
				const [lo, hi] = self.range as [number, number]
				const vx = round(Math.min(1, Math.max(0, (px - PLOT.left) / PLOT.span)))
				const vy = round(Math.min(hi, Math.max(lo, hi - ((py - PLOT.top) / PLOT.height) * (hi - lo))))
				if (self.dragging === 1) Object.assign(curve, { x1: vx, y1: vy })
				else Object.assign(curve, { x2: vx, y2: vy })
			},
			endDrag() {
				;(this as any).dragging = 0
				;(this as any).dragRange = null
			},
			applyToSelection() {
				const self = this as any
				if (!self.current?.name.trim()) return Blockbench.showQuickMessage('名前を付けてから当てて', 2000)
				if (selectedKeyframes().length === 0) return Blockbench.showQuickMessage('キーフレームを選んでから当てて', 2000)
				applyEasing({ name: self.current.name, curve: self.current.curve })
			},
			exportFile() {
				const presets = storable((this as any).presets)
				Blockbench.export({ type: 'JSON', extensions: ['json'], name: 'rigel-easing-presets', content: presetFile(presets) })
			},
			importFile() {
				Blockbench.import({ type: 'JSON', extensions: ['json'], readtype: 'text' }, (files: Filesystem.FileResult[]) => {
					const self = this as any
					try {
						const imported = parsePresetFile(String(files[0]?.content ?? ''))
						const merged = mergePresets(self.presets.map((p: Easing) => ({ name: p.name, curve: tidyCurve(p.curve) })), imported)
						self.presets = merged.presets.map(editable)
						self.index = self.presets.length ? 0 : -1
						Blockbench.showQuickMessage(`${merged.added} 個を追加、${merged.replaced} 個を上書きした`, 2500)
					} catch (error) {
						Blockbench.showMessageBox({ title: 'プリセットの読み込み', message: `読み込めなかった：${(error as Error).message}` })
					}
				})
			},
		},
		template: `
<div style="display: flex; gap: 16px; min-height: 340px;">
	<div style="width: 230px; display: flex; flex-direction: column; gap: 8px;">
		<ul style="flex: 1; max-height: 300px; overflow-y: auto; margin: 0; padding: 0; list-style: none;">
			<li v-for="(preset, i) in presets" :key="i" @click="index = i"
				:style="{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 6px', cursor: 'pointer', background: i === index ? 'var(--color-selected)' : 'none' }">
				<img :src="icon(preset.curve)" width="24" height="24" alt="">
				<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ preset.name.trim() || '${UNNAMED}' }}</span>
			</li>
			<li v-if="!presets.length" style="padding: 6px; opacity: 0.7;">保存したプリセットはまだない</li>
		</ul>
		<div style="display: flex; flex-wrap: wrap; gap: 4px;">
			<button @click="addBezier">ベジェを追加</button>
			<button @click="addFunction">関数を追加</button>
			<button @click="fromSelection" title="選んだキーフレームから始まる bezier 区間の形を取り込む">選択区間から取り込む</button>
			<button @click="remove" :disabled="!current">削除</button>
			<button @click="exportFile" :disabled="!presets.length">書き出し</button>
			<button @click="importFile">読み込み</button>
		</div>
	</div>
	<div v-if="current" style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
		<label style="display: flex; gap: 8px; align-items: center;">名前
			<input type="text" v-model="current.name" class="dark_bordered" style="flex: 1;">
		</label>
		<div style="display: flex; gap: 12px;">
			<svg ref="plot" viewBox="0 0 240 240" width="240" height="240" style="background: var(--color-back); touch-action: none; flex-shrink: 0;"
				@pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag">
				<rect :x="x(0)" :y="y(1)" :width="x(1) - x(0)" :height="y(0) - y(1)" fill="none" stroke="var(--color-border)"></rect>
				<path :d="curvePath" fill="none" stroke="var(--color-accent)" stroke-width="2"></path>
				<template v-if="current.curve.type === 'bezier'">
					<line :x1="x(0)" :y1="y(0)" :x2="x(current.curve.x1)" :y2="y(current.curve.y1)" stroke="var(--color-subtle_text)"></line>
					<line :x1="x(1)" :y1="y(1)" :x2="x(current.curve.x2)" :y2="y(current.curve.y2)" stroke="var(--color-subtle_text)"></line>
					<circle :cx="x(current.curve.x1)" :cy="y(current.curve.y1)" r="7" fill="var(--color-accent)" style="cursor: grab;" @pointerdown="startDrag(1, $event)"></circle>
					<circle :cx="x(current.curve.x2)" :cy="y(current.curve.y2)" r="7" fill="var(--color-accent)" style="cursor: grab;" @pointerdown="startDrag(2, $event)"></circle>
				</template>
			</svg>
			<div v-if="current.curve.type === 'bezier'" style="display: grid; grid-template-columns: auto 80px; gap: 6px; align-content: start;">
				<template v-for="key in ['x1', 'y1', 'x2', 'y2']">
					<span :key="key + 'l'">{{ key }}</span>
					<input :key="key" type="number" step="0.01" class="dark_bordered" :value="current.curve[key]" @change="setBezier(key, $event.target.value)">
				</template>
			</div>
			<div v-else style="display: grid; grid-template-columns: auto 110px; gap: 6px; align-content: start;">
				<span>関数</span>
				<select v-model="current.curve.family" class="dark_bordered"><option v-for="f in families" :key="f" :value="f">{{ f }}</option></select>
				<span>向き</span>
				<select v-model="current.curve.mode" class="dark_bordered"><option v-for="m in modes" :key="m" :value="m">{{ modeLabel[m] }}</option></select>
				<template v-if="current.curve.family === 'back'">
					<span>行き過ぎの量</span>
					<input type="number" step="0.1" class="dark_bordered" placeholder="${DEFAULT_OVERSHOOT}" :value="current.curve.overshoot" @change="setParam('overshoot', $event.target.value)">
				</template>
				<template v-if="current.curve.family === 'elastic'">
					<span>振幅</span>
					<input type="number" step="0.1" min="1" class="dark_bordered" placeholder="${DEFAULT_AMPLITUDE}" :value="current.curve.amplitude" @change="setParam('amplitude', $event.target.value)">
					<span>周期</span>
					<input type="number" step="0.05" min="0.01" class="dark_bordered" :placeholder="defaultPeriod(current.curve.mode)" :value="current.curve.period" @change="setParam('period', $event.target.value)">
				</template>
			</div>
		</div>
		<div style="position: relative; height: 34px; margin: 0 12px;" title="上は線形、下はこのイージング">
			<div style="position: absolute; left: 0; right: 0; top: 16px; border-top: 1px dashed var(--color-border);"></div>
			<div :style="{ position: 'absolute', top: '2px', left: linearLeft, width: '10px', height: '10px', marginLeft: '-5px', borderRadius: '50%', background: 'var(--color-subtle_text)' }"></div>
			<div :style="{ position: 'absolute', top: '20px', left: easedLeft, width: '12px', height: '12px', marginLeft: '-6px', borderRadius: '50%', background: 'var(--color-accent)' }"></div>
		</div>
		<div><button @click="applyToSelection">選択中のキーフレームに当てる</button></div>
	</div>
	<div v-else style="flex: 1; opacity: 0.7; padding-top: 8px;">左で追加するか、JSON を読み込む</div>
</div>`,
	} as Vue.Component
}

function openPresetDialog(): void {
	dialog?.delete()
	dialog = new Dialog({
		id: 'rigel_easing_presets',
		title: 'イージングのプリセット',
		width: 720,
		component: presetDialogComponent(),
		singleButton: true,
	})
	dialog.show()
}

const keyframeMenu = () => (BBKeyframe.prototype as unknown as { menu: Menu }).menu

export function registerEasingUi(): void {
	keyframeMenu().addAction(menuItem, '#settings')
}

export function unregisterEasingUi(): void {
	keyframeMenu().removeAction(MENU_ID)
	dialog?.delete()
	dialog = undefined
}
