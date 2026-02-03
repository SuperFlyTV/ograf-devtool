const SW_VERSION = '2026-02-03T14:13:28.664Z' // Updated at build time

let requestId = 0
const requestMap = new Map()

const broadcastToParent = new BroadcastChannel('intercept-channel-main')
const broadcastFromParent = new BroadcastChannel('intercept-channel-sw')
broadcastFromParent.onmessage = (event) => {
	const msg = event.data

	if (msg && msg.reply !== undefined) {
		const waiting = requestMap.get(msg.reply)
		if (waiting) {
			requestMap.delete(msg.reply)

			if (msg.error) waiting.reject(msg.error)
			else waiting.resolve(msg.result)
		} else {
			// console.error('no waiting for', msg.reply)
		}
	} else if (msg && msg.type === 'request-version') {
		broadcastToParent.postMessage({
			type: 'sw-version',
			reply: msg.id,
			result: SW_VERSION,
		})
	} else if (msg && msg.type === 'unregister') {
		// This is based on https://github.com/NekR/self-destroying-sw
		// To completely unregister a service worker, we need to unregister it and then
		// reload all clients that might be using it.

		console.log('Unregistering service worker...')
		self.registration
			.unregister()
			.then(() => {
				return self.clients.matchAll()
			})
			.then((clients) => {
				console.log(`Reloading ${clients.length} clients...`)
				clients.forEach((client) => client.navigate(client.url))
			})
	}
}
self.addEventListener('install', (_event) => {
	self.skipWaiting()
})

self.addEventListener('fetch', function (event) {
	// file from url:
	const url = event.request.url
	let newUrl = url
	{
		const m = url.match(/(TEST_SW)(\/.*)/i)
		if (m) {
			event.respondWith(
				new Response(JSON.stringify({ version: SW_VERSION }), {
					headers: {
						'Content-Type': 'application/json',
						// Prevent any caching:
						'Cache-Control': 'no-cache, no-store, must-revalidate',
						Pragma: 'no-cache',
						Expires: '0',
					},
				})
			)
			return
		}
	}
	{
		const m = url.match(/(LOCAL)(\/.*)/i)
		if (m) {
			console.debug('fetch intercepting', event.request.url)
			// intercept the request and serve the file from local disk:
			event.respondWith(
				new Promise((resolve, reject) => {
					const id = requestId++

					requestMap.set(id, { resolve, reject })

					broadcastToParent.postMessage({
						type: 'fetch',
						id: id,
						url: decodeURIComponent(m[2]),
					})
				})
					.then((result) => {
						if (result === 'NotFoundError') {
							return new Response(null, {
								status: 404,
								statusText: `File not found`,
							})
						} else {
							return new Response(result.arrayBuffer, {
								headers: {
									'Content-Type': result.type,
									// Prevent any caching:
									'Cache-Control': 'no-cache, no-store, must-revalidate',
									Pragma: 'no-cache',
									Expires: '0',
								},
							})
						}
					})
					.catch((error) => {
						return new Response(null, {
							status: 500,
							statusText: `Error when intercepting request: ${error}`,
						})
					})
			)
			return
		}
	}
	// else:
	{
		console.debug('fetch (letting through)', event.request.url)
		event.respondWith(
			fetch(newUrl, {
				cache: 'no-store',
				method: event.request.method,
				headers: event.request.headers,
			}).catch((error) => {
				broadcastToParent.postMessage({
					type: 'fetch-error',
					url: newUrl,
					message: `${error}`,
				})

				// console.error('fetch error', error)
				return new Response(null, {
					status: 500,
					statusText: `${error}`,
				})
				// if (`${error}`.includes('failed')) {
				// } else {
				// }
			})
		)
		// check if the url is in the same origin as the service worker:

		const allowedOrigins = [self.location.origin, 'https://json-schema.org']

		let ok = false
		for (const origin of allowedOrigins) {
			if (url.startsWith(origin)) {
				ok = true
				break
			}
		}
		if (!ok) {
			broadcastToParent.postMessage({
				type: 'fetch-from-outside',
				url: newUrl,
			})
		}
	}
})
