// Blockbench's Vue, which the type definitions declare as a global that modules cannot use as a value.
export const vue = (globalThis as unknown as { Vue: { observable<T extends object>(object: T): T; set<T extends object>(object: T, key: string, value: unknown): void } }).Vue
