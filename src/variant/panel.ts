import { readDisplay } from '../display/settings'
import { isRigelProject } from '../easing/keyframes'
import { variantNameProblem } from '../export/build'
import { FORMAT_ID } from '../format'
import { DEFAULT_VARIANT_ID, freeName, newVariant, readVariants, writeVariants, type StoredVariant } from './settings'
import { allBones, boneRows, boneTree, checkOf, onlyUnder, setApplied, type BoneNode, type Check, type GroupSource } from './tree'
import { choose, chosenId, refreshView, shownId } from './view'

const PANEL_ID = 'rigel_variants'
const CHECK_ICON: Record<Check, string> = { all: 'check_box', some: 'indeterminate_check_box', none: 'check_box_outline_blank' }

const ui = (globalThis as unknown as { Vue: { observable<T extends object>(object: T): T } }).Vue.observable({ rev: 0 })
// Groups folded in the Bone tree.
const folded = new Set<string>()

let panel: Panel | undefined
let style: Deletable | undefined
let listeners: Deletable[] = []

function redraw(): void {
	ui.rev++
}

const variantsOf = (): StoredVariant[] => (Project ? readVariants(Project) : [])
const currentOf = (variants: StoredVariant[]): StoredVariant | undefined => variants.find((v) => v.uuid === chosenId())

function toSource(group: Group): GroupSource {
	return {
		uuid: group.uuid,
		name: group.name,
		display: !!readDisplay(group),
		hasCubes: group.children.some((c) => c instanceof Cube),
		children: group.children.filter((c): c is Group => c instanceof Group).map(toSource),
	}
}

const currentTree = (): BoneNode[] => boneTree(Outliner.root.filter((n): n is Group => n instanceof Group).map(toSource))

function findNode(nodes: BoneNode[], uuid: string): BoneNode | undefined {
	for (const n of nodes) {
		const found = n.uuid === uuid ? n : findNode(n.children, uuid)
		if (found) return found
	}
	return undefined
}

interface Row {
	id: string
	name: string
	selected: boolean
	shown: boolean
}

interface BoneLine {
	uuid: string
	name: string
	depth: number
	check: Check
	bone: boolean
	foldable: boolean
	open: boolean
}

interface Current {
	name: string
	problem: string
	onApply: string
	pairs: [string, string][]
	bones: BoneLine[]
}

interface PanelModel {
	rows: Row[]
	current?: Current
	textures: { uuid: string; name: string }[]
}

function currentModel(): PanelModel {
	const variants = variantsOf()
	const current = currentOf(variants)
	const shown = shownId()
	const rows: Row[] = [
		{ id: DEFAULT_VARIANT_ID, name: DEFAULT_VARIANT_ID, selected: !current, shown: shown === DEFAULT_VARIANT_ID },
		...variants.map((v) => ({ id: v.uuid, name: v.name || '(名前なし)', selected: v === current, shown: v.uuid === shown })),
	]
	const model: PanelModel = { rows, textures: Texture.all.map((t) => ({ uuid: t.uuid, name: t.name })) }
	if (current) {
		const excluded = new Set(current.excluded)
		model.current = {
			name: current.name,
			problem: variantNameProblem(current.name, new Set(variants.filter((v) => v !== current).map((v) => v.name))) ?? '',
			onApply: current.onApply,
			pairs: current.textures,
			bones: boneRows(currentTree(), excluded, folded).map((r) => ({
				uuid: r.node.uuid,
				name: r.node.name,
				depth: r.depth,
				check: r.check,
				bone: r.node.bone,
				foldable: r.node.children.length > 0,
				open: r.open,
			})),
		}
	}
	return model
}

// Every change of the variants is one undo step. `change` edits the variants it is given.
function edit(label: string, change: (variants: StoredVariant[]) => void): void {
	if (!Project) return
	Undo.initEdit({ rigel_variants: true })
	const variants = readVariants(Project)
	change(variants)
	writeVariants(Project, variants)
	Undo.finishEdit(label)
	refreshView()
}

function editCurrent(label: string, change: (variant: StoredVariant) => void): void {
	const id = chosenId()
	edit(label, (variants) => {
		const variant = variants.find((v) => v.uuid === id)
		if (variant) change(variant)
	})
}

function add(): void {
	const variant = newVariant(freeName('variant', variantsOf()))
	edit('Add variant', (variants) => variants.push(variant))
	choose(variant.uuid)
}

function duplicate(): void {
	const source = currentOf(variantsOf())
	if (!source) return
	const copy: StoredVariant = { ...structuredClone(source), uuid: crypto.randomUUID(), name: freeName(source.name, variantsOf()) }
	edit('Duplicate variant', (variants) => variants.splice(variants.findIndex((v) => v.uuid === source.uuid) + 1, 0, copy))
	choose(copy.uuid)
}

function remove(): void {
	const id = chosenId()
	if (id === DEFAULT_VARIANT_ID) return
	edit('Delete variant', (variants) => variants.splice(0, variants.length, ...variants.filter((v) => v.uuid !== id)))
}

function rename(value: string): void {
	const name = value.trim()
	if (name !== currentOf(variantsOf())?.name) editCurrent('Rename variant', (v) => (v.name = name))
}

function setOnApply(value: string): void {
	const onApply = value.trim()
	if (onApply !== currentOf(variantsOf())?.onApply) editCurrent('Edit variant function', (v) => (v.onApply = onApply))
}

function setPair(index: number, side: 0 | 1, uuid: string): void {
	editCurrent('Edit variant texture', (v) => {
		const pair = v.textures[index]
		if (pair) pair[side] = uuid
	})
}

function addPair(): void {
	editCurrent('Add variant texture', (v) => v.textures.push(['', '']))
}

function removePair(index: number): void {
	editCurrent('Remove variant texture', (v) => v.textures.splice(index, 1))
}

function toggleBone(uuid: string): void {
	const node = findNode(currentTree(), uuid)
	if (!node) return
	editCurrent('Edit variant bones', (v) => (v.excluded = setApplied(node, v.excluded, checkOf(node, new Set(v.excluded)) !== 'all')))
}

function applyAll(): void {
	editCurrent('Apply variant to all bones', (v) => (v.excluded = []))
}

function applyNone(): void {
	editCurrent('Apply variant to no bones', (v) => (v.excluded = allBones(currentTree())))
}

function applySelected(): void {
	const selected = new Set(Group.multi_selected.map((g) => g.uuid))
	if (selected.size === 0) {
		Blockbench.showQuickMessage('アウトライナーで Group を選んでください。', 2000)
		return
	}
	editCurrent('Apply variant to selected bones', (v) => (v.excluded = onlyUnder(currentTree(), selected)))
}

function fold(uuid: string): void {
	if (!folded.delete(uuid)) folded.add(uuid)
	redraw()
}

const CSS = `
.rigel-variants { padding: 6px 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.rigel-variants .rv-bar { display: flex; align-items: center; gap: 2px; }
.rigel-variants .rv-bar .tool.disabled { opacity: 0.35; pointer-events: none; }
.rigel-variants ul { list-style: none; margin: 0; padding: 0; }
.rigel-variants .rv-list li { display: flex; align-items: center; justify-content: space-between; padding: 2px 8px; cursor: pointer; }
.rigel-variants .rv-list li:hover { background: var(--color-button); }
.rigel-variants .rv-list li.selected { background: var(--color-selected); }
.rigel-variants .rv-list li.selected .rv-name { color: var(--color-light); }
.rigel-variants .rv-eye { font-size: 16px; color: var(--color-accent); }
.rigel-variants .rv-field { display: flex; align-items: center; gap: 8px; }
.rigel-variants .rv-field label { flex: none; min-width: 6em; color: var(--color-subtle_text); }
.rigel-variants .rv-field input { flex: 1; min-width: 0; }
.rigel-variants .rv-head { margin-top: 4px; color: var(--color-subtle_text); }
.rigel-variants button { min-height: 0; height: 24px; padding: 0 10px; }
.rigel-variants .rv-buttons { display: flex; gap: 4px; }
.rigel-variants .rv-pair { display: flex; align-items: center; gap: 4px; }
.rigel-variants .rv-pair select { flex: 1; min-width: 0; }
.rigel-variants .rv-problem { color: var(--color-error); }
.rigel-variants .rv-note { margin: 0; color: var(--color-subtle_text); }
.rigel-variants .rv-tree { max-height: 300px; overflow-y: auto; }
.rigel-variants .rv-bone { display: flex; align-items: center; gap: 2px; cursor: pointer; }
.rigel-variants .rv-bone:hover { background: var(--color-button); }
.rigel-variants .rv-bone .material-icons { font-size: 18px; }
.rigel-variants .rv-bone .rv-fold { width: 18px; flex: none; }
.rigel-variants .rv-bone.group span { color: var(--color-subtle_text); }
`

const TEMPLATE = `
<div class="rigel-variants">
	<div class="rv-bar">
		<div class="tool" title="variant を追加" @click="add()"><i class="material-icons">add</i></div>
		<div class="tool" :class="{ disabled: !m.current }" title="複製" @click="duplicate()"><i class="material-icons">content_copy</i></div>
		<div class="tool" :class="{ disabled: !m.current }" title="削除" @click="remove()"><i class="material-icons">delete</i></div>
	</div>
	<ul class="rv-list">
		<li v-for="row in m.rows" :key="row.id" :class="{ selected: row.selected }" @click="choose(row.id)">
			<span class="rv-name">{{ row.name }}</span>
			<i v-if="row.shown" class="material-icons rv-eye" title="ビューポートに表示中">visibility</i>
		</li>
	</ul>
	<template v-if="m.current">
		<div class="rv-field"><label>名前</label><input type="text" class="dark_bordered" :value="m.current.name" @change="rename($event.target.value)"></div>
		<div v-if="m.current.problem" class="rv-problem">{{ m.current.problem }}</div>
		<div class="rv-field"><label>適用時の関数</label><input type="text" class="dark_bordered" :value="m.current.onApply" placeholder="namespace:path（任意）" @change="setOnApply($event.target.value)"></div>
		<div class="rv-head">テクスチャの差し替え</div>
		<div v-for="(pair, i) in m.current.pairs" :key="i" class="rv-pair">
			<select class="dark_bordered" @change="setPair(i, 0, $event.target.value)"><option value="" :selected="!pair[0]">（元）</option><option v-for="t in m.textures" :key="t.uuid" :value="t.uuid" :selected="t.uuid === pair[0]">{{ t.name }}</option></select>
			<i class="material-icons">arrow_forward</i>
			<select class="dark_bordered" @change="setPair(i, 1, $event.target.value)"><option value="" :selected="!pair[1]">（先）</option><option v-for="t in m.textures" :key="t.uuid" :value="t.uuid" :selected="t.uuid === pair[1]">{{ t.name }}</option></select>
			<div class="tool" title="この組を外す" @click="removePair(i)"><i class="material-icons">close</i></div>
		</div>
		<div><button @click="addPair()">組を追加</button></div>
		<div class="rv-head">適用する Bone</div>
		<div class="rv-buttons">
			<button @click="applyAll()" title="すべての Bone に適用します">全部</button>
			<button @click="applyNone()" title="どの Bone にも適用しません">無し</button>
			<button @click="applySelected()" title="アウトライナーで選んでいる Group と、その子孫の Bone だけに適用します">選択中だけ</button>
		</div>
		<div class="rv-tree">
			<div v-for="line in m.current.bones" :key="line.uuid" class="rv-bone" :class="{ group: !line.bone }" :style="{ paddingLeft: line.depth * 14 + 'px' }">
				<i v-if="line.foldable" class="material-icons rv-fold" @click.stop="fold(line.uuid)">{{ line.open ? 'expand_more' : 'chevron_right' }}</i><i v-else class="rv-fold"></i>
				<i class="material-icons" @click="toggleBone(line.uuid)">{{ icon(line.check) }}</i>
				<span @click="toggleBone(line.uuid)">{{ line.name }}</span>
			</div>
		</div>
		<p class="rv-note">外した Bone は、この variant を適用しても今のモデルのまま残ります。</p>
	</template>
	<p v-else class="rv-note">元のモデルです。variant を選ぶと、ビューポートがその見た目になります。</p>
</div>`

export function registerVariantPanel(): void {
	style = Blockbench.addCSS(CSS)
	panel = new Panel(PANEL_ID, {
		name: 'Variants',
		icon: 'palette',
		growable: true,
		resizable: true,
		expand_button: true,
		condition: { formats: [FORMAT_ID], modes: ['edit', 'paint', 'animate'] },
		default_position: { slot: 'right_bar', float_position: [0, 0], float_size: [340, 480], height: 360, folded: false, sidebar_index: 10 },
		component: {
			name: 'panel-rigel-variants',
			computed: {
				m(): PanelModel {
					// Read for the dependency: the model comes from the project, which Vue does not watch.
					void ui.rev
					return isRigelProject() ? currentModel() : { rows: [], textures: [] }
				},
			},
			methods: { add, duplicate, remove, rename, setOnApply, setPair, addPair, removePair, toggleBone, applyAll, applyNone, applySelected, fold, choose, icon: (check: Check) => CHECK_ICON[check] },
			template: TEMPLATE,
		} as Vue.Component,
	})
	listeners = ['select_project', 'select_mode', 'finished_edit', 'undo', 'redo', 'add_texture'].map((name) => Blockbench.on(name as 'undo', redraw))
	listeners.push(Codecs.project!.on('parsed', redraw))
}

export function unregisterVariantPanel(): void {
	for (const l of listeners) l.delete()
	listeners = []
	panel?.delete()
	panel = undefined
	style?.delete()
	style = undefined
}

export { redraw as redrawVariantPanel }
