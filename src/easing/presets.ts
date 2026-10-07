// Easing presets saved on this computer, and the JSON file used to share them.
import { isEasing, type Easing } from './curves'

const STORAGE_KEY = 'rigel.easing_presets'
const FILE_FORMAT = 'rigel-easing-presets'
const FILE_VERSION = 1

export function loadPresets(storage: Pick<Storage, 'getItem'> = localStorage): Easing[] {
	try {
		const data = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
		return Array.isArray(data) ? data.filter(isEasing) : []
	} catch {
		return []
	}
}

export function savePresets(presets: Easing[], storage: Pick<Storage, 'setItem'> = localStorage): void {
	storage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function presetFile(presets: Easing[]): string {
	return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, presets }, null, '\t')
}

/** Reads a preset file; throws with a message for the user when it is not one. */
export function parsePresetFile(text: string): Easing[] {
	let data: unknown
	try {
		data = JSON.parse(text)
	} catch {
		throw new Error('JSON として読めないファイルです。')
	}
	const file = data as { format?: unknown; version?: unknown; presets?: unknown }
	if (file?.format !== FILE_FORMAT || !Array.isArray(file.presets)) throw new Error('Rigel のイージングプリセットのファイルではありません。')
	if (typeof file.version !== 'number' || file.version > FILE_VERSION) throw new Error('新しい版の Rigel で書き出されたファイルです。')
	const presets = file.presets.filter(isEasing)
	if (presets.length !== file.presets.length) throw new Error(`${file.presets.length - presets.length} 個のプリセットの形を読み込めません。`)
	return presets
}

/** Adds imported presets; a preset with the same name is replaced. */
export function mergePresets(current: Easing[], imported: Easing[]): { presets: Easing[]; added: number; replaced: number } {
	const presets = [...current]
	let added = 0
	let replaced = 0
	for (const preset of imported) {
		const at = presets.findIndex((p) => p.name === preset.name)
		if (at >= 0) {
			presets[at] = preset
			replaced++
		} else {
			presets.push(preset)
			added++
		}
	}
	return { presets, added, replaced }
}
