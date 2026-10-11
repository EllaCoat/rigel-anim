import { beforeAll, describe, expect, test } from 'bun:test'
import type { FontLibrary } from '../src/font/library'
import { layout, linesOf, loadGame, vanilla } from './font-support'

const json = JSON.stringify
let library: FontLibrary
let japanese: FontLibrary

beforeAll(async () => {
	library = await loadGame({ ...vanilla(), options: 'key_key.jump:key.keyboard.space\n' })
	japanese = await loadGame({
		...vanilla(),
		index: { ...vanilla().index, 'minecraft/lang/ja_jp.json': json({ 'test.hello': 'こんにちは' }) },
		options: 'lang:ja_jp\n',
	})
})

/** Text in the font where every a-z is 5 wide and a space is 4, so that line widths are easy to count. */
const mono = (text: string, extra: object = {}) => json({ text, font: 'test:mono', ...extra })
const glyphs = (text: string, overrides = {}) => layout(library, text, overrides).lines.flatMap((line) => line.glyphs)

describe('width', () => {
	// StringSplitter.stringWidth sums Font's glyph advances; Font.width rounds the sum up
	test('a line is as wide as its advances, bold adds the bold offset of each glyph', () => {
		expect(layout(library, 'AB').width).toBe(6)
		const bold = layout(library, json({ text: 'AB', bold: true }))
		expect([bold.width, ...bold.lines[0]!.glyphs.map((glyph) => glyph.x)]).toEqual([8, 0, 5])
	})

	test('unihex glyphs add 0.5 when bold, and the width of the line is rounded up', () => {
		const bold = layout(library, json({ text: 'aa', bold: true }))
		expect(bold.lines[0]!.glyphs.map((glyph) => glyph.x)).toEqual([0, 4.5])
		expect(bold.width).toBe(9)
		expect(layout(library, json({ text: 'a', bold: true })).width).toBe(5)
	})

	test('the missing glyph is 6 wide, 7 when bold', () => {
		expect([layout(library, 'Z').width, layout(library, json({ text: 'Z', bold: true })).width]).toEqual([6, 7])
	})

	test('italic, underline and color do not change the width', () => {
		expect(layout(library, json({ text: 'AB', italic: true, underlined: true, strikethrough: true, color: 'red' })).width).toBe(6)
	})

	test('obfuscated text is drawn as the characters it has', () => {
		const result = layout(library, json({ text: 'AB', obfuscated: true }))
		expect(linesOf(result)).toEqual(['AB'])
		expect(result.width).toBe(6)
	})

	test('a character outside the BMP is one glyph and a lone surrogate is U+FFFD', () => {
		expect(glyphs('\u{1F600}').map((glyph) => glyph.codepoint)).toEqual([0x1f600])
		expect(glyphs('\ud83d').map((glyph) => glyph.codepoint)).toEqual([0xfffd])
	})

	test('no text has no lines', () => {
		const result = layout(library, '')
		expect([result.width, result.height, result.lines.length]).toEqual([0, 0, 0])
	})
})

describe('components', () => {
	test('input that is not JSON is the text itself, so are JSON numbers and booleans', () => {
		expect(linesOf(layout(library, 'Hello, A'))).toEqual(['Hello, A'])
		expect(linesOf(layout(library, '{"text":'))).toEqual(['{"text":'])
		expect(linesOf(layout(library, '12.50'))).toEqual(['12.50'])
		expect(linesOf(layout(library, 'true'))).toEqual(['true'])
	})

	test('a JSON string, an object and a list of both', () => {
		expect(linesOf(layout(library, '"AB"'))).toEqual(['AB'])
		expect(linesOf(layout(library, '{"text":"AB"}'))).toEqual(['AB'])
		expect(linesOf(layout(library, '["A","B",{"text":"C"}]'))).toEqual(['ABC'])
	})

	test('children inherit the style of the parent and can override it', () => {
		const result = layout(library, json({ text: 'A', bold: true, italic: true, color: 'gold', extra: [{ text: 'B', bold: false, color: '#102030' }, { text: 'C', extra: [{ text: 'A', underlined: true }] }] }))
		const [a, b, c, d] = result.lines[0]!.glyphs
		expect([a, b, c, d].map((glyph) => [glyph!.bold, glyph!.italic, glyph!.underlined, glyph!.color])).toEqual([
			[true, true, false, 0xffaa00],
			[false, true, false, 0x102030],
			[true, true, false, 0xffaa00],
			[true, true, true, 0xffaa00],
		])
	})

	// ComponentSerialization.createFromList: the first element is the parent of the others
	test('in a list the first element is the parent of the following ones', () => {
		const result = layout(library, json([{ text: 'A', bold: true }, 'B', { text: 'C', bold: false }]))
		expect(result.lines[0]!.glyphs.map((glyph) => glyph.bold)).toEqual([true, true, false])
	})

	test('named colors and #RRGGBB, an invalid color is ignored with a warning', () => {
		const colors = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white', '#A1b2C3']
		const result = layout(library, json(colors.map((color) => ({ text: 'A', color }))))
		expect(result.lines[0]!.glyphs.map((glyph) => glyph.color)).toEqual([0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xffaa00, 0xaaaaaa, 0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff, 0xa1b2c3])
		const bad = layout(library, json({ text: 'A', color: 'chartreuse' }))
		expect([bad.lines[0]!.glyphs[0]!.color, bad.warnings.length]).toEqual([undefined, 1])
	})

	test('font selects the font set of the glyphs, an unknown namespace falls back to minecraft', () => {
		expect(layout(library, json({ text: 'A', font: 'test:mono' })).width).toBe(6)
		expect(layout(library, json({ text: 'a', font: 'test:mono' })).width).toBe(5)
		expect(layout(library, json({ text: 'A', font: 'default' })).width).toBe(4)
	})

	test('an explicit type picks the content', () => {
		expect(linesOf(layout(library, '{"type":"text","text":"AB"}'))).toEqual(['AB'])
		expect(linesOf(layout(library, '{"type":"translatable","translate":"test.hello"}'))).toEqual(['Hello'])
	})

	test('an element with no content and an empty extra are warned about, not fatal', () => {
		const result = layout(library, json({ bold: true, extra: [] }))
		expect(result.lines.length).toBe(0)
		expect(result.warnings.length).toBe(2)
	})

	test('score, selector and nbt show what they refer to', () => {
		expect(linesOf(layout(library, '{"score":{"name":"@p","objective":"points"}}'))).toEqual(['[score:@p/points]'])
		expect(linesOf(layout(library, '{"selector":"@e[type=cow]"}'))).toEqual(['[selector:@e[type=cow]]'])
		expect(linesOf(layout(library, '{"nbt":"Items[0]","entity":"@s"}'))).toEqual(['[nbt:Items[0]]'])
	})

	test('a keybind shows the key bound in options.txt, or the translation of the binding itself', () => {
		expect(linesOf(layout(library, '{"keybind":"key.jump"}'))).toEqual(['Space'])
		expect(linesOf(layout(library, '{"keybind":"key.attack"}'))).toEqual(['Attack/Destroy'])
		expect(linesOf(layout(library, '{"keybind":"key.nothing"}'))).toEqual(['key.nothing'])
	})
})

describe('§ codes', () => {
	// StringDecomposer.iterateFormatted
	test('a code changes the style of the text after it and takes no width', () => {
		const result = layout(library, '§lA§rB')
		expect(result.lines[0]!.glyphs.map((glyph) => [glyph.bold, glyph.advance])).toEqual([
			[true, 5],
			[false, 2],
		])
	})

	test('a color code turns the other formats off', () => {
		const result = layout(library, '§lA§cB§nC')
		expect(result.lines[0]!.glyphs.map((glyph) => [glyph.bold, glyph.color, glyph.underlined])).toEqual([
			[true, undefined, false],
			[false, 0xff5555, false],
			[false, 0xff5555, true],
		])
	})

	test('an unknown code and a trailing § are dropped', () => {
		expect(linesOf(layout(library, json({ text: 'A§zB§' })))).toEqual(['AB'])
	})

	test('§r returns to the style of the component, not to the default', () => {
		const result = layout(library, json({ text: '§cA§rB', italic: true }))
		expect(result.lines[0]!.glyphs.map((glyph) => [glyph.color, glyph.italic])).toEqual([
			[0xff5555, false],
			[undefined, true],
		])
	})
})

describe('translate', () => {
	test.each([
		['plain', { translate: 'test.hello' }, 'Hello'],
		['missing key shows the key', { translate: 'test.missing' }, 'test.missing'],
		['fallback for a missing key', { translate: 'test.missing', fallback: 'Fall back' }, 'Fall back'],
		['fallback is not used for an existing key', { translate: 'test.hello', fallback: 'Fall back' }, 'Hello'],
		['%s, %2$s and %1$s', { translate: 'test.args', with: ['a', 'b'] }, 'a and b then a'],
		['%% is a percent sign', { translate: 'test.percent' }, '100% sure'],
		['%d in a language file is read as %s', { translate: 'test.number', with: [3] }, '3 items'],
		['a stray % shows the template as it is', { translate: 'test.stray' }, '50% off'],
		['an unsupported format shows the template as it is', { translate: 'test.unsupported', with: ['x'] }, '%x'],
		['too few arguments show the template as it is', { translate: 'test.two', with: ['x'] }, '%s %s'],
		['numbers and booleans are written out', { translate: 'test.two', with: [1.5, true] }, '1.5 true'],
	])('%s', (_, component, expected) => {
		expect(linesOf(layout(library, json(component)))).toEqual([expected])
	})

	test('an argument component keeps its own style over the style of the translation', () => {
		const result = layout(library, json({ translate: 'test.two', color: 'red', bold: true, with: [{ text: 'A', color: 'blue', bold: false }, 'B'] }))
		const [first, , second] = result.lines[0]!.glyphs
		expect([first!.color, first!.bold, second!.color, second!.bold]).toEqual([0x5555ff, false, 0xff5555, true])
	})

	test('the selected language is read over en_us, keys it lacks come from en_us', () => {
		expect(linesOf(layout(japanese, '{"translate":"test.hello"}'))).toEqual(['こんにちは'])
		expect(linesOf(layout(japanese, '{"translate":"test.only_english"}'))).toEqual(['English only'])
	})

	test('a language file of a resource pack namespace and of a later pack overrides', async () => {
		const packed = await loadGame({
			...vanilla(),
			packs: {
				'/packs/one': { 'mypack/lang/en_us.json': json({ 'mypack.title': 'One' }), 'minecraft/lang/en_us.json': json({ 'test.hello': 'Hi' }) },
				'/packs/two': { 'minecraft/lang/en_us.json': json({ 'test.hello': 'Hey' }) },
			},
		})
		expect(linesOf(layout(packed, json([{ translate: 'mypack.title' }, { translate: 'test.hello' }])))).toEqual(['OneHey'])
	})
})

describe('line breaks', () => {
	// StringSplitter.LineBreakFinder and splitLines, with a font whose letters are 5 wide and spaces 4
	const lines = (text: string, lineWidth: number) => linesOf(layout(library, mono(text), { lineWidth }))

	test('text that fits stays on one line, up to exactly the width', () => {
		expect(lines('aaaa', 20)).toEqual(['aaaa'])
	})

	test('a word that does not fit is broken where it overflows when it is alone on the line', () => {
		expect(lines('aaaaa', 20)).toEqual(['aaaa', 'a'])
		expect(lines('aaaaaaaaaa', 20)).toEqual(['aaaa', 'aaaa', 'aa'])
	})

	test('a line is broken at the last space and the space is dropped', () => {
		expect(lines('aa bb cc', 20)).toEqual(['aa', 'bb', 'cc'])
		expect(lines('aaaa bbbb', 20)).toEqual(['aaaa', 'bbbb'])
	})

	test('only one space is dropped at a break, others are kept', () => {
		expect(lines('aa   bb', 20)).toEqual(['aa  ', 'bb'])
	})

	test('a newline starts a line, also an empty one at the end or in a row', () => {
		expect(lines('aaa\nbb', 200)).toEqual(['aaa', 'bb'])
		expect(lines('aa\n', 200)).toEqual(['aa', ''])
		expect(lines('\n', 200)).toEqual(['', ''])
		expect(lines('a\n\nb', 200)).toEqual(['a', '', 'b'])
	})

	test('the first character stays on its line however narrow the line is, the width is at least 1', () => {
		expect(lines('aaa', 12)).toEqual(['aa', 'a'])
		expect(lines('aaa', 0)).toEqual(['a', 'a', 'a'])
		expect(lines('aaa', -5)).toEqual(['a', 'a', 'a'])
	})

	test('characters without spaces, like Japanese, are broken wherever the line is full', () => {
		expect(linesOf(layout(library, 'ああああ', { lineWidth: 20 }))).toEqual(['ああ', 'ああ'])
	})

	test('the style of the text follows it onto the next line', () => {
		const text = json({ text: 'aa bb', font: 'test:mono', extra: [{ text: ' cc', italic: true }] })
		const result = layout(library, text, { lineWidth: 20 })
		expect(linesOf(result)).toEqual(['aa', 'bb', 'cc'])
		expect(result.lines.map((line) => line.glyphs.map((glyph) => glyph.italic))).toEqual([[false, false], [false, false], [true, true]])
	})

	test('bold text breaks earlier because its glyphs are wider', () => {
		expect(linesOf(layout(library, mono('aaa', { bold: true }), { lineWidth: 20 }))).toEqual(['aaa'])
		expect(linesOf(layout(library, mono('aaa', { bold: true }), { lineWidth: 17 }))).toEqual(['aa', 'a'])
	})

	test('formatting codes are not counted in the width', () => {
		expect(lines('§caa§rbb', 20)).toEqual(['aabb'])
	})

	test('the line width is 200 pixels wide in the display by default', () => {
		const text = 'a'.repeat(41)
		expect(linesOf(layout(library, mono(text))).map((line) => line.length)).toEqual([40, 1])
	})
})

describe('alignment and extents', () => {
	const text = mono('aaaa\naa')
	const starts = (alignment: 'left' | 'center' | 'right', content = text) => layout(library, content, { alignment }).lines.map((line) => line.glyphs[0]!.x)

	// TextDisplayRenderer.renderInner: LEFT 0, RIGHT width - lineWidth, CENTER width / 2 - lineWidth / 2
	test('the start of each line follows the alignment inside the widest line', () => {
		expect([starts('left'), starts('center'), starts('right')]).toEqual([
			[0, 0],
			[0, 5],
			[0, 10],
		])
	})

	test('a center that falls on half a pixel is kept', () => {
		expect(starts('center', mono('aaa\na'))).toEqual([0, 5])
		expect(starts('center', mono('aaa\nb b'))).toEqual([0, 0.5])
	})

	test('the size is the widest line by ten pixels per line', () => {
		const result = layout(library, mono('aaa\naa\n\na'))
		expect([result.width, result.height, result.lines.map((line) => line.y)]).toEqual([15, 40, [0, 10, 20, 30]])
	})

	test('an empty line takes its 10 pixels too', () => {
		expect(layout(library, mono('a\n\n\n')).height).toBe(40)
	})
})

describe('colors', () => {
	test('the background is the given ARGB, a signed int from NBT included', () => {
		expect(layout(library, 'A', { background: 0x40000000 }).background).toBe(0x40000000)
		expect(layout(library, 'A', { background: -1 }).background).toBe(0xffffffff)
		expect(layout(library, 'A', { background: 0 }).background).toBe(0)
	})

	// Display.TextDisplay flag 4 -> Options.getBackgroundOpacity(0.25F), black with (int)(opacity * 255)
	test('the default background is black with the alpha of 25%, whatever background says', () => {
		expect(layout(library, 'A', { defaultBackground: true, background: 0xff00ff00 }).background).toBe(0x3f000000)
	})

	test('the default background follows options.txt when it is not only for chat', async () => {
		const configured = await loadGame({ ...vanilla(), options: 'backgroundForChatOnly:false\ntextBackgroundOpacity:0.5\n' })
		expect(layout(configured, 'A', { defaultBackground: true }).background).toBe(0x7f000000)
		const chatOnly = await loadGame({ ...vanilla(), options: 'backgroundForChatOnly:true\ntextBackgroundOpacity:0.5\n' })
		expect(layout(chatOnly, 'A', { defaultBackground: true }).background).toBe(0x3f000000)
	})

	// Font.adjustColor: an alpha below 4 is treated as opaque
	test.each([
		[-1, 255],
		[255, 255],
		[127, 127],
		[100, 100],
		[-128, 128],
		[4, 4],
		[3, 255],
		[0, 255],
	])('text_opacity %d is drawn with alpha %d', (opacity, alpha) => {
		expect(layout(library, 'A', { textOpacity: opacity }).textAlpha).toBe(alpha)
	})
})
