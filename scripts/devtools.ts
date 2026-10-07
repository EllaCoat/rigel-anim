// DevTools client for the development Blockbench started by dev-bb.ts.
export const PORT = Number(process.env.BB_DEV_PORT ?? 9467)

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

export function devBlockbench(command: 'launch' | 'stop'): void {
	const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/dev-bb.ts`, command], { stdio: ['ignore', 'inherit', 'inherit'] })
	if (result.exitCode !== 0) throw new Error(`dev-bb.ts ${command} failed`)
}
