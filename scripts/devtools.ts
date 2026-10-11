// DevTools client for the development Blockbench started by dev-bb.ts.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

export const PORT = Number(process.env.BB_DEV_PORT ?? 9467)
export const BB_VERSION = '5.2.1'
export const DEV_ROOT = process.env.BB_DEV_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'rigel-anim', `blockbench-${BB_VERSION}`)
// The folders the plugin reads text_display fonts from in the development Blockbench. dev-bb.ts grants both
// before launch; any other folder would open a permission dialog that blocks Blockbench until someone answers it.
export const MINECRAFT_DIR = join(process.env.APPDATA ?? '', '.minecraft')
export const FONT_PACKS = join(DEV_ROOT, 'font-packs')

async function target(): Promise<string> {
	const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
	const page = list.find((t: any) => t.type === 'page' && /index\.html/.test(t.url)) ?? list.find((t: any) => t.type === 'page')
	if (!page) throw new Error('no Blockbench page target')
	return page.webSocketDebuggerUrl
}

async function cdp(url: string, method: string, params: unknown): Promise<any> {
	const socket = new WebSocket(url)
	await new Promise((ok, fail) => {
		socket.onopen = ok
		socket.onerror = () => fail(new Error(`cannot connect to ${url}`))
	})
	try {
		return await new Promise((ok, fail) => {
			socket.onclose = () => fail(new Error('DevTools connection closed before the response'))
			socket.onmessage = (event) => {
				const message = JSON.parse(String(event.data))
				if (message.id !== 1) return
				if (message.error) fail(new Error(message.error.message))
				else ok(message.result)
			}
			socket.send(JSON.stringify({ id: 1, method, params }))
		})
	} finally {
		socket.close()
	}
}

// Evaluates the body of an async function in the renderer and returns its result by value.
export async function evaluate(code: string): Promise<any> {
	const expression = `(async () => { ${code} })()`
	const result = await cdp(await target(), 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
	return result.result.value
}

export async function blockbenchRunning(): Promise<boolean> {
	try {
		await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
		return true
	} catch {
		return false
	}
}

/**
 * Points the plugin's font settings at MINECRAFT_DIR and at copies of `packs` (resource pack folders or .zip files,
 * later ones winning). The copies go to a new folder each time, so the plugin sees changed settings and reloads.
 */
export async function useFonts(packs: string[] = []): Promise<void> {
	rmSync(FONT_PACKS, { recursive: true, force: true })
	const dir = join(FONT_PACKS, String(Date.now()))
	mkdirSync(dir, { recursive: true })
	const copies = packs.map((pack, i) => {
		const copy = join(dir, `${i}-${basename(pack)}`)
		cpSync(pack, copy, { recursive: true })
		return copy
	})
	await evaluate(`
		if (!settings.rigel_font_minecraft_dir) throw new Error('the rigel plugin is not installed; run \`bun scripts/dev-bb.ts install\`')
		settings.rigel_font_minecraft_dir.set(${JSON.stringify(MINECRAFT_DIR)})
		settings.rigel_font_resource_packs.set(${JSON.stringify(copies.join(';'))})
	`)
}

export function devBlockbench(command: 'launch' | 'stop'): void {
	const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/dev-bb.ts`, command], { stdio: ['ignore', 'inherit', 'inherit'] })
	if (result.exitCode !== 0) throw new Error(`dev-bb.ts ${command} failed`)
}
