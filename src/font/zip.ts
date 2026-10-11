// A reader for the parts of the ZIP format that resource packs and the vanilla jar use: stored and deflated entries.

export interface ZipArchive {
	/** Names of the file entries; directories are left out. */
	names: string[]
	has(name: string): boolean
	read(name: string): Promise<Uint8Array>
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const MAX_COMMENT_LENGTH = 0xffff

interface Entry {
	flags: number
	method: number
	compressedSize: number
	size: number
	headerOffset: number
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function openZip(bytes: Uint8Array): ZipArchive {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	let end = -1
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - MAX_COMMENT_LENGTH); i--) {
		if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
			end = i
			break
		}
	}
	if (end < 0) throw new Error('ZIP として読めません（末尾の目録が見つかりません）')
	const count = view.getUint16(end + 10, true)
	let offset = view.getUint32(end + 16, true)
	if (count === 0xffff || offset === 0xffffffff) throw new Error('ZIP64 には対応していません')

	const decoder = new TextDecoder()
	const entries = new Map<string, Entry>()
	for (let i = 0; i < count; i++) {
		if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) throw new Error('ZIP の目録が壊れています')
		const nameLength = view.getUint16(offset + 28, true)
		const extraLength = view.getUint16(offset + 30, true)
		const commentLength = view.getUint16(offset + 32, true)
		const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
		if (!name.endsWith('/')) {
			entries.set(name, {
				flags: view.getUint16(offset + 8, true),
				method: view.getUint16(offset + 10, true),
				compressedSize: view.getUint32(offset + 20, true),
				size: view.getUint32(offset + 24, true),
				headerOffset: view.getUint32(offset + 42, true),
			})
		}
		offset += 46 + nameLength + extraLength + commentLength
	}

	return {
		names: [...entries.keys()],
		has: (name) => entries.has(name),
		async read(name) {
			const entry = entries.get(name)
			if (!entry) throw new Error(`ZIP に ${name} がありません`)
			if (entry.flags & 1) throw new Error(`${name} は暗号化されています`)
			const header = entry.headerOffset
			if (view.getUint32(header, true) !== LOCAL_FILE_HEADER) throw new Error(`${name} のヘッダーが壊れています`)
			const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true)
			const data = bytes.subarray(start, start + entry.compressedSize)
			if (entry.method === 0) return data
			if (entry.method !== 8) throw new Error(`${name} の圧縮方式 ${entry.method} には対応していません`)
			const inflated = await inflateRaw(data)
			if (inflated.length !== entry.size) throw new Error(`${name} を展開した大きさが一致しません`)
			return inflated
		},
	}
}
