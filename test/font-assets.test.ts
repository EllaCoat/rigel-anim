import { describe, expect, test } from 'bun:test'
import { loadFontLibrary } from '../src/font/library'
import { openZip } from '../src/font/zip'
import { bytesOf, decodeImage, image, installation, layout, loadGame, MINECRAFT_DIR, vanilla, zipOf, type Files } from './font-support'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const widthOf = (library: Awaited<ReturnType<typeof loadGame>>, content: string, overrides = {}) => layout(library, content, overrides).width
const json = JSON.stringify

describe('zip', () => {
	test.each([0, 8] as const)('reads entries stored with method %d', async (method) => {
		const archive = openZip(zipOf({ 'a.txt': 'hello', 'dir/b.json': '{"x":1}', 'empty.txt': '' }, method))
		expect(archive.names).toEqual(['a.txt', 'dir/b.json', 'empty.txt'])
		expect(text(await archive.read('a.txt'))).toBe('hello')
		expect(text(await archive.read('dir/b.json'))).toBe('{"x":1}')
		expect(text(await archive.read('empty.txt'))).toBe('')
	})

	test('finds the central directory behind an archive comment', async () => {
		const archive = openZip(zipOf({ 'a.txt': 'hello' }, 8, 'made by a test'))
		expect(text(await archive.read('a.txt'))).toBe('hello')
	})

	test('reads entries larger than a chunk of the deflate stream', async () => {
		const big = 'unifont '.repeat(50_000)
		const archive = openZip(zipOf({ 'big.hex': big }))
		expect(text(await archive.read('big.hex'))).toBe(big)
	})

	test('rejects data that is not a zip and entries that are not in it', async () => {
		expect(() => openZip(bytesOf('not a zip file at all, just text'))).toThrow()
		await expect(openZip(zipOf({ 'a.txt': 'x' })).read('b.txt')).rejects.toThrow('b.txt')
	})
})

describe('vanilla assets', () => {
	// ClientPackSource: VanillaPackResourcesBuilder puts the asset index before the jar
	test('the asset index wins over the jar for the same path', async () => {
		const library = await loadGame(vanilla())
		expect(widthOf(library, 'あ')).toBe(9)
	})

	test('a path only the jar has is read from the jar', async () => {
		const library = await loadGame(vanilla())
		expect(widthOf(library, 'AB')).toBe(6)
	})

	test('without the asset index the jar is enough and a warning says what is missing', async () => {
		const { fs } = installation(vanilla())
		const result = await loadFontLibrary({ fs: { ...fs, existsSync: (path) => !path.includes('/indexes/') && fs.existsSync(path) }, sources: { minecraftDir: MINECRAFT_DIR, resourcePacks: [] }, decodeImage })
		if ('error' in result) throw new Error(result.error)
		expect(result.library.warnings.join()).toContain('アセット索引')
		expect(widthOf(result.library, 'AB')).toBe(6)
		expect(widthOf(result.library, 'あ')).toBe(6)
	})

	test('a missing .minecraft or jar is an error with the reason, not a library', async () => {
		const { fs } = installation(vanilla())
		const missingDir = await loadFontLibrary({ fs, sources: { minecraftDir: '/nowhere/.minecraft', resourcePacks: [] }, decodeImage })
		expect(missingDir).toEqual({ error: expect.stringContaining('/nowhere/.minecraft') })
		const noJar = await loadFontLibrary({ fs: { ...fs, existsSync: (path) => !path.endsWith('.jar') && fs.existsSync(path) }, sources: { minecraftDir: MINECRAFT_DIR, resourcePacks: [] }, decodeImage })
		expect(noJar).toEqual({ error: expect.stringContaining('1.20.4.jar') })
	})
})

describe('providers', () => {
	test('bitmap advance is the width of the last opaque column plus one', async () => {
		const library = await loadGame(vanilla())
		// BitmapProvider: (int)(0.5 + actualWidth * scale) + 1; A uses 3 columns, B 1, C none
		expect([...'ABC'].map((letter) => widthOf(library, letter))).toEqual([4, 2, 1])
	})

	test('bitmap scale is the font height over the cell height', async () => {
		// 32x32 cell shown 8 high: scale 0.25; 16 opaque columns -> (int)(0.5 + 4) + 1
		const cell = Array.from({ length: 32 }, (_, y) => (y === 0 ? `${'.'.repeat(15)}#${'.'.repeat(16)}` : '.'.repeat(32)))
		const library = await loadGame({
			...vanilla(),
			packs: { '/packs/hd': { 'minecraft/font/default.json': json({ providers: [{ type: 'bitmap', file: 'minecraft:font/hd.png', ascent: 7, chars: ['H'] }] }), 'minecraft/textures/font/hd.png': image(...cell) } },
		})
		expect(widthOf(library, 'H')).toBe(5)
	})

	test('unihex advance is the pixel width halved plus one, from the glyph bits or the size_overrides', async () => {
		const library = await loadGame(vanilla())
		// UnihexProvider.Glyph: width / 2 + 1 (integer division). a: columns 1-6 of 8; b: 2-9 of 16; c: 24 and d: 32 wide
		expect([...'abcd'].map((letter) => widthOf(library, letter))).toEqual([4, 5, 13, 17])
		// a blank glyph spans bitWidth + 1 columns
		expect(widthOf(library, ' ')).toBe(5)
		// U+3042 has bits in columns 1-15 (8), but its range in size_overrides says 0-15 (9); U+3044 is covered the same way
		expect(widthOf(library, 'あ')).toBe(9)
		expect(widthOf(library, 'い')).toBe(9)
	})

	test('a codepoint in several .hex files takes the last one', async () => {
		const library = await loadGame(vanilla())
		// first.hex: columns 0-1 (width 2, advance 2); second.hex: columns 0-3 (width 4, advance 3)
		expect(widthOf(library, 'e')).toBe(3)
	})

	test('space advances, including zero, and glyphs nobody defines are the 6-wide missing glyph', async () => {
		const library = await loadGame(vanilla())
		expect([' ', '‌', 'Z'].map((letter) => widthOf(library, letter))).toEqual([4, 0, 6])
	})

	test('a zero in the chars of a bitmap leaves that cell out', async () => {
		const library = await loadGame({
			...vanilla(),
			packs: { '/packs/p': { 'minecraft/font/default.json': json({ providers: [{ type: 'bitmap', file: 'minecraft:font/test.png', ascent: 7, chars: ['\u0000X\u0000'] }] }) } },
		})
		// X is the middle cell (one opaque column at its left edge): advance 2; U+0000 is no glyph at all
		expect([widthOf(library, 'X'), widthOf(library, '\u0000')]).toEqual([2, 6])
	})
})

describe('fonts', () => {
	test('a reference puts the other font at its place: the earlier provider wins', async () => {
		const pack: Files = {
			'test/font/first.json': json({ providers: [{ type: 'reference', id: 'minecraft:default' }, { type: 'space', advances: { A: 10 } }] }),
			'test/font/last.json': json({ providers: [{ type: 'space', advances: { A: 10 } }, { type: 'reference', id: 'minecraft:default' }] }),
		}
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p': pack } })
		const inFont = (font: string) => widthOf(library, json({ text: 'A', font }))
		expect([inFont('test:first'), inFont('test:last')]).toEqual([4, 10])
	})

	test('the font of a style that does not exist draws the missing glyph', async () => {
		const library = await loadGame(vanilla())
		expect(widthOf(library, json({ text: 'AB', font: 'test:nothing' }))).toBe(12)
	})

	// FontManager.loadResourceStack and FontSet.reload: every pack contributes, the highest pack's providers come first
	test('providers of resource packs are stacked over the vanilla ones, later packs first', async () => {
		const define = (advances: object) => ({ 'minecraft/font/default.json': json({ providers: [{ type: 'space', advances }] }) })
		const packs = { '/packs/one': define({ A: 7, B: 7 }), '/packs/two': define({ A: 9 }) }
		const library = await loadGame({ ...vanilla(), packs })
		expect([widthOf(library, 'A'), widthOf(library, 'B'), widthOf(library, 'C')]).toEqual([9, 7, 1])
		const reversed = await loadGame({ ...vanilla(), packs }, ['/packs/two', '/packs/one'])
		expect(widthOf(reversed, 'A')).toBe(7)
	})

	test('a pack can be a folder or a zip', async () => {
		const files = { 'assets/minecraft/font/default.json': json({ providers: [{ type: 'space', advances: { A: 9 } }] }) }
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p.zip': zipOf(files, 0) } })
		expect(widthOf(library, 'A')).toBe(9)
	})

	test('ttf and legacy_unicode providers are skipped with a warning and the font still loads', async () => {
		const providers = [{ type: 'ttf', file: 'minecraft:font/x.ttf', size: 8, oversample: 2 }, { type: 'legacy_unicode', sizes: 'minecraft:font/glyph_sizes.bin', template: 'x' }, { type: 'space', advances: { A: 9 } }]
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p': { 'minecraft/font/default.json': json({ providers }) } } })
		expect(widthOf(library, 'A')).toBe(9)
		expect(library.warnings.filter((warning) => warning.includes('ttf') || warning.includes('legacy_unicode'))).toHaveLength(2)
	})

	// 1.20.4 has no provider filter (the font options came later), so the key is not looked at
	test('the filter key of a provider is ignored', async () => {
		const providers = [{ type: 'space', advances: { A: 11 }, filter: { uniform: true, jp: false } }]
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p': { 'minecraft/font/default.json': json({ providers }) } } })
		expect(widthOf(library, 'A')).toBe(11)
	})

	test('a provider that cannot be loaded is skipped with a warning, the rest of the font stays', async () => {
		const providers = [
			{ type: 'bitmap', file: 'minecraft:font/missing.png', ascent: 7, chars: ['Q'] },
			{ type: 'bitmap', file: 'minecraft:font/test.png', ascent: 9, chars: ['Q'] },
			{ type: 'laser' },
			{ type: 'space', advances: { A: 9 } },
		]
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p': { 'minecraft/font/default.json': json({ providers }) } } })
		expect(widthOf(library, 'A')).toBe(9)
		expect(library.warnings.join('\n')).toContain('missing.png')
		expect(library.warnings.join('\n')).toContain('ascent 9')
		expect(library.warnings.join('\n')).toContain('laser')
	})

	test('references that loop or point nowhere are warned about', async () => {
		const pack: Files = {
			'test/font/a.json': json({ providers: [{ type: 'reference', id: 'test:b' }, { type: 'space', advances: { A: 3 } }] }),
			'test/font/b.json': json({ providers: [{ type: 'reference', id: 'test:a' }, { type: 'reference', id: 'test:none' }] }),
		}
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p': pack } })
		expect(widthOf(library, json({ text: 'A', font: 'test:a' }))).toBe(3)
		expect(library.warnings.join('\n')).toMatch(/test:none/)
	})

	// Minecraft.selectMainFont
	test('forceUnicodeFont in options.txt renames the default font to uniform', async () => {
		const library = await loadGame({ ...vanilla(), options: 'forceUnicodeFont:true\n' })
		expect([widthOf(library, 'A'), widthOf(library, 'a')]).toEqual([6, 4])
	})

	test('a font file that starts with a byte order mark is read', async () => {
		const bom = String.fromCharCode(0xfeff)
		const library = await loadGame({ ...vanilla(), packs: { '/packs/p': { 'minecraft/font/default.json': bom + json({ providers: [{ type: 'space', advances: { A: 9 } }] }) } } })
		expect(widthOf(library, 'A')).toBe(9)
	})

	test('a resource pack that is not there is skipped with a warning', async () => {
		const library = await loadGame(vanilla(), ['/packs/gone'])
		expect(library.warnings.join()).toContain('/packs/gone')
		expect(widthOf(library, 'AB')).toBe(6)
	})
})
