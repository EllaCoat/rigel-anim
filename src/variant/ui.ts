import { isRigelProject } from '../easing/keyframes'
import { readDisplay } from '../display/settings'
import { readVariants, writeVariants, type StoredVariant } from './settings'

const ACTION_ID = 'rigel_variants'
const TITLE = 'variant を編集'

let action: Action | undefined
let dialog: Dialog | undefined

type Material = THREE.Material

// Swaps the materials of the cubes the variant applies to; the next face update draws the project's own textures again.
export function previewVariant(variant: StoredVariant | undefined): void {
	Canvas.updateAllFaces()
	if (!variant) return
	const byMaterial = new Map<Material, string>(Texture.all.map((t) => [t.getMaterial() as Material, t.uuid]))
	const replace = new Map(variant.textures)
	const excluded = new Set(variant.excluded)
	const swap = (m: Material) => {
		const to = replace.get(byMaterial.get(m) ?? '')
		const texture = to && Texture.all.find((t) => t.uuid === to)
		return texture ? (texture.getMaterial() as Material) : m
	}
	for (const cube of Cube.all) {
		if (cube.parent instanceof Group && excluded.has(cube.parent.uuid)) continue
		const mesh = cube.mesh as THREE.Mesh
		mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
	}
}

interface Editable {
	uuid: string
	name: string
	pairs: { from: string; to: string }[]
	excluded: string[]
	onApply: string
}

const editable = (v: StoredVariant): Editable => ({ uuid: v.uuid, name: v.name, pairs: v.textures.map(([from, to]) => ({ from, to })), excluded: [...v.excluded], onApply: v.onApply })
const stored = (v: Editable): StoredVariant => ({
	uuid: v.uuid,
	name: v.name.trim(),
	textures: v.pairs.filter((p) => p.from && p.to && p.from !== p.to).map((p): [string, string] => [p.from, p.to]),
	excluded: [...v.excluded],
	onApply: v.onApply.trim(),
})

function openVariantDialog(): void {
	const project = Project!
	const textures = Texture.all.map((t) => ({ uuid: t.uuid, name: t.name }))
	const bones = Group.all.filter((g) => !readDisplay(g) && g.children.some((c) => c instanceof Cube)).map((g) => ({ uuid: g.uuid, name: g.name }))
	let state: { variants: Editable[] } | undefined
	dialog?.delete()
	dialog = new Dialog({
		id: ACTION_ID,
		title: TITLE,
		width: 760,
		component: {
			data: () => ({ variants: readVariants(project).map(editable), index: readVariants(project).length > 0 ? 0 : -1, textures, bones }),
			mounted() {
				state = this as any
			},
			computed: {
				current(): Editable | undefined {
					return (this as any).variants[(this as any).index]
				},
			},
			watch: {
				current: {
					deep: true,
					immediate: true,
					handler(value: Editable | undefined) {
						previewVariant(value && stored(value))
					},
				},
			},
			methods: {
				add() {
					const self = this as any
					self.variants.push({ uuid: crypto.randomUUID(), name: `variant_${self.variants.length + 1}`, pairs: [{ from: '', to: '' }], excluded: [], onApply: '' })
					self.index = self.variants.length - 1
				},
				remove() {
					const self = this as any
					self.variants.splice(self.index, 1)
					self.index = Math.min(self.index, self.variants.length - 1)
				},
				addPair() {
					;(this as any).current.pairs.push({ from: '', to: '' })
				},
				removePair(i: number) {
					;(this as any).current.pairs.splice(i, 1)
				},
				applies(uuid: string) {
					return !(this as any).current.excluded.includes(uuid)
				},
				toggle(uuid: string) {
					const excluded: string[] = (this as any).current.excluded
					const at = excluded.indexOf(uuid)
					if (at >= 0) excluded.splice(at, 1)
					else excluded.push(uuid)
				},
			},
			template: `
<div style="display: flex; gap: 16px; min-height: 360px;">
	<div style="width: 200px; display: flex; flex-direction: column; gap: 8px;">
		<ul style="flex: 1; max-height: 320px; overflow-y: auto; margin: 0; padding: 0; list-style: none;">
			<li v-for="(v, i) in variants" :key="i" @click="index = i"
				:style="{ padding: '3px 6px', cursor: 'pointer', background: i === index ? 'var(--color-selected)' : 'none' }">{{ v.name || '(名前なし)' }}</li>
			<li v-if="!variants.length" style="padding: 6px; opacity: 0.7;">variant はまだありません。</li>
		</ul>
		<div style="display: flex; gap: 4px;">
			<button @click="add">追加</button>
			<button @click="remove" :disabled="!current">削除</button>
		</div>
		<p style="opacity: 0.7; font-size: 0.9em;">選んだ variant をビューポートで表示します。閉じると元に戻ります。</p>
	</div>
	<div v-if="current" style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
		<label style="display: flex; gap: 8px; align-items: center;">名前
			<input type="text" v-model="current.name" class="dark_bordered" style="flex: 1;" placeholder="blink">
		</label>
		<label style="display: flex; gap: 8px; align-items: center;">適用時の関数
			<input type="text" v-model="current.onApply" class="dark_bordered" style="flex: 1;" placeholder="namespace:path（任意）">
		</label>
		<div>
			<div style="margin-bottom: 4px;">テクスチャの差し替え</div>
			<div v-for="(pair, i) in current.pairs" :key="i" style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px;">
				<select v-model="pair.from" class="dark_bordered" style="flex: 1;"><option value="">（元）</option><option v-for="t in textures" :key="t.uuid" :value="t.uuid">{{ t.name }}</option></select>
				<span>→</span>
				<select v-model="pair.to" class="dark_bordered" style="flex: 1;"><option value="">（先）</option><option v-for="t in textures" :key="t.uuid" :value="t.uuid">{{ t.name }}</option></select>
				<button @click="removePair(i)">×</button>
			</div>
			<button @click="addPair">組を追加</button>
		</div>
		<div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
			<div style="margin-bottom: 4px;">適用する Bone（外した Bone は、この variant を適用しても今のモデルのまま）</div>
			<div style="flex: 1; max-height: 160px; overflow-y: auto; display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 12px;">
				<label v-for="b in bones" :key="b.uuid" style="display: flex; gap: 6px; align-items: center;">
					<input type="checkbox" :checked="applies(b.uuid)" @change="toggle(b.uuid)">{{ b.name }}
				</label>
			</div>
		</div>
	</div>
	<div v-else style="flex: 1; opacity: 0.7; padding-top: 8px;">左で追加してください。</div>
</div>`,
		} as Vue.Component,
		onConfirm() {
			if (state) writeVariants(project, state.variants.map(stored))
			previewVariant(undefined)
		},
		onCancel() {
			previewVariant(undefined)
		},
	})
	dialog.show()
}

export function registerVariantUi(): void {
	action = new Action(ACTION_ID, { name: TITLE, icon: 'palette', category: 'edit', condition: () => isRigelProject(), click: openVariantDialog })
	MenuBar.addAction(action, 'tools')
}

export function unregisterVariantUi(): void {
	action?.delete()
	action = undefined
	dialog?.delete()
	dialog = undefined
}
