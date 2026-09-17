const SW_VERSION = '__BUILD_VERSION__' // Generated at build time

let requestId = 0
const requestMap = new Map()

// Origins added at runtime (e.g. a remote Graphics server the user has selected):
const extraAllowedOrigins = new Set()

// GitHub's raw content server serves most text-like files as "text/plain", which breaks e.g. JS module loading:
const MIME_TYPES_BY_EXTENSION = {
	js: 'text/javascript',
	mjs: 'text/javascript',
	cjs: 'text/javascript',
	json: 'application/json',
	css: 'text/css',
	html: 'text/html',
	svg: 'image/svg+xml',
	wasm: 'application/wasm',
}
function getMimeTypeForUrl(url) {
	const ext = new URL(url).pathname.split('.').pop().toLowerCase()
	return MIME_TYPES_BY_EXTENSION[ext]
}

// The remote base url currently selected by the user (see RemoteHandler.js), used to resolve "REMOTE/..." requests:
let remoteBaseUrl = null

// A github.com "blob" url (as browsed on github.com) is rewritten to its raw.githubusercontent.com equivalent:
function rewriteGithubBlobUrl(url) {
	const m = url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\/([^/]+)\/([^?]+)(\?.*)?$/)
	if (!m) return url
	const [, repoBase, ref, filePath, query] = m
	const rawBase = repoBase.replace('https://github.com/', 'https://raw.githubusercontent.com/')
	return `${rawBase}/${ref}/${filePath}${query || ''}`
}

// Fetches a url, applying the GitHub raw-content rewrite/mime-fix, and reporting fetch errors to the main thread.
function fetchAndFixup(targetUrl, requestInit) {
	const fetchUrl = rewriteGithubBlobUrl(targetUrl)
	return fetch(fetchUrl, requestInit)
		.then((response) => {
			// GitHub's raw content server always serves text-like files as "text/plain":
			if (new URL(fetchUrl).hostname === 'raw.githubusercontent.com') {
				const mimeType = getMimeTypeForUrl(fetchUrl)
				if (mimeType && response.headers.get('content-type')?.startsWith('text/plain')) {
					const headers = new Headers(response.headers)
					headers.set('Content-Type', mimeType)
					return new Response(response.body, {
						status: response.status,
						statusText: response.statusText,
						headers,
					})
				}
			}
			return response
		})
		.catch((error) => {
			broadcastToParent.postMessage({
				type: 'fetch-error',
				url: targetUrl,
				message: `${error}`,
			})
			return new Response(null, {
				status: 500,
				statusText: `${error}`,
			})
		})
}

// Joins a relative path onto the selected remote base url, preserving the "://" of the base url's scheme.
function joinRemoteUrl(base, relativePath) {
	return base.replace(/\/+$/, '') + relativePath
}

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
	} else if (msg && msg.type === 'add-allowed-origin') {
		extraAllowedOrigins.add(msg.origin)
	} else if (msg && msg.type === 'set-remote-base-url') {
		remoteBaseUrl = msg.baseUrl
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
	{
		const m = url.match(/(REMOTE)(\/.*)/i)
		if (m) {
			console.debug('fetch intercepting (remote)', event.request.url)
			if (!remoteBaseUrl) {
				event.respondWith(new Response(null, { status: 500, statusText: 'No remote base url has been set' }))
				return
			}
			const targetUrl = joinRemoteUrl(remoteBaseUrl, decodeURIComponent(m[2]))
			event.respondWith(
				fetchAndFixup(targetUrl, {
					cache: 'no-store',
					method: event.request.method,
					headers: event.request.headers,
				})
			)
			return
		}
	}
	// else:
	{
		console.debug('fetch (letting through)', event.request.url)
		event.respondWith(
			fetchAndFixup(newUrl, {
				cache: 'no-store',
				method: event.request.method,
				headers: event.request.headers,
			})
		)
		// check if the url is in the same origin as the service worker:

		const allowedOrigins = [
			self.location.origin,
			'https://json-schema.org',
			'chrome-extension://',
			...extraAllowedOrigins,
		]

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
