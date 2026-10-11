import { FORMAT_ID } from '../format'

const ENTITY_KEY = 'rigel_entity'
const NBT_KEY = 'rigel_entity_nbt'

export interface LocatorEntitySettings {
	// '' when the locator keeps no entity.
	type: string
	nbt: string
}

let properties: Deletable[] = []

export function registerLocatorSettings(): void {
	const options = { condition: { formats: [FORMAT_ID] }, exposed: false, default: '' }
	properties = [new Property(Locator, 'string', ENTITY_KEY, options), new Property(Locator, 'string', NBT_KEY, options)]
}

export function unregisterLocatorSettings(): void {
	for (const p of properties) p.delete()
	properties = []
}

type Bag = Record<string, unknown>
const text = (bag: Bag, key: string) => (typeof bag[key] === 'string' ? (bag[key] as string) : '')

export function readLocatorEntity(locator: Locator): LocatorEntitySettings {
	const bag = locator as unknown as Bag
	return { type: text(bag, ENTITY_KEY).trim(), nbt: text(bag, NBT_KEY).trim() }
}

export function writeLocatorEntity(locator: Locator, settings: LocatorEntitySettings): void {
	const bag = locator as unknown as Bag
	bag[ENTITY_KEY] = settings.type.trim()
	bag[NBT_KEY] = settings.nbt.trim()
}
