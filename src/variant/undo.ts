import { readVariants, writeVariants, type StoredVariant } from './settings'

declare global {
	interface UndoAspects {
		// Saves the project's variants.
		rigel_variants?: boolean
	}
}

type Saved = { rigel_variants?: StoredVariant[] }

let listeners: Deletable[] = []

// Edits of the variants go through Undo.initEdit({ rigel_variants: true }), which keeps the variants as they are
// before and after, and puts them back on undo and redo.
export function registerVariantUndo(restored: () => void): void {
	listeners = [
		Blockbench.on('create_undo_save', ({ save, aspects }) => {
			if (aspects.rigel_variants && Project) (save as Saved).rigel_variants = structuredClone(readVariants(Project))
		}),
		Blockbench.on('load_undo_save', ({ save }) => {
			const variants = (save as Saved).rigel_variants
			if (!variants || !Project) return
			writeVariants(Project, structuredClone(variants))
			restored()
		}),
	]
}

export function unregisterVariantUndo(): void {
	for (const l of listeners) l.delete()
	listeners = []
}
