import { FORMAT_ID } from '../format'

const NBT_KEY = 'rigel_nbt'

let property: Deletable | undefined

export function registerBoneSettings(): void {
	property = new Property(Group, 'string', NBT_KEY, { condition: { formats: [FORMAT_ID] }, exposed: false })
}

export function unregisterBoneSettings(): void {
	property?.delete()
	property = undefined
}

export function readBoneNbt(group: Group): string {
	const value = (group as unknown as Record<string, unknown>)[NBT_KEY]
	return typeof value === 'string' ? value : ''
}

export function writeBoneNbt(group: Group, nbt: string): void {
	;(group as unknown as Record<string, unknown>)[NBT_KEY] = nbt
}
