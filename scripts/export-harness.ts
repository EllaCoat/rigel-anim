// Runs inside the development Blockbench: export-check.ts bundles this file and injects it as __rigelExport.
import { collectRig } from '../src/export/collect'

async function open(model: unknown, name: string) {
	if (!Formats.rigel) throw new Error('the rigel format is not registered; run `bun scripts/dev-bb.ts install`')
	for (const project of [...ModelProject.all]) {
		project.saved = true
		await project.close(true)
	}
	Codecs.project.load(model, { name, path: name, no_file: true } as any)
	return { bones: Group.all.length, animations: Project!.animations.length, textures: Texture.all.length }
}

// The rig source with typed arrays as plain arrays and PNGs as base64, so it survives returnByValue.
function collect() {
	const source = collectRig()
	const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
	return {
		bones: source.bones,
		textures: source.textures.map((t) => ({ ...t, png: base64(t.png) })),
		rest: Array.from(source.rest),
		animations: source.animations.map((a) => ({ ...a, matrices: Array.from(a.matrices) })),
	}
}

;(window as any).__rigelExport = { open, collect }
