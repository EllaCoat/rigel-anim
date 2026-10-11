// Protocol-only players for bench/net.ts: they join the bench server, answer what the server waits for, and count what
// they receive. No rendering or input.
//   node client.cjs <minecraft-protocol dir> <port> <name>...
// Prints READY <name> once each has joined. A line `mark <label>` on stdin prints `MARK <label> <json>`: per player,
// the bytes read from the socket (compressed, as on the wire) and, per packet name, the count and uncompressed bytes.
const mc = require(process.argv[2])
const port = Number(process.argv[3])
const names = process.argv.slice(4)

const counts = names.map(() => ({ wire: 0, packets: {} }))
const clients = names.map((username, i) => {
	const client = mc.createClient({ host: '127.0.0.1', port, username, auth: 'offline', version: '1.20.4' })
	client.on('connect', () => client.socket.on('data', (d) => (counts[i].wire += d.length)))
	client.on('packet', (data, meta, buffer, fullBuffer) => {
		const c = (counts[i].packets[meta.name] ??= { count: 0, bytes: 0 })
		c.count++
		c.bytes += fullBuffer.length
	})
	client.on('position', (p) => client.write('teleport_confirm', { teleportId: p.teleportId }))
	// The server sends the next batch of chunks, and pairs the player with the entities in them, only after the player
	// acknowledges the last batch (PlayerChunkSender, ChunkMap.isChunkTracked).
	client.on('chunk_batch_finished', () => client.write('chunk_batch_received', { chunksPerTick: 64 }))
	client.on('login', () => console.log(`READY ${username}`))
	client.on('error', (e) => {
		console.error(`${username}: ${e.message}`)
		process.exitCode = 1
	})
	client.on('end', (reason) => console.log(`END ${username}: ${reason}`))
	return client
})

let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
	buffered += chunk
	const lines = buffered.split(/\r?\n/)
	buffered = lines.pop()
	for (const line of lines) {
		const m = /^mark (\S+)$/.exec(line.trim())
		if (m) console.log(`MARK ${m[1]} ${JSON.stringify(counts)}`)
	}
})
process.stdin.on('end', () => {
	clients.forEach((client) => client.end())
	setTimeout(() => process.exit(), 500).unref()
})
