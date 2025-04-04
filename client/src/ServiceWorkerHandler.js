import { register } from 'register-service-worker'
import { issueTracker } from './renderer/IssueTracker'
import { SW_VERSION } from './lib/sw-version.js'

class ServiceWorkerHandler {
	constructor() {
		this.previousMessageReplyId = -1

		this.broadcastFromSW = new BroadcastChannel('intercept-channel-main')
		this.broadcastToSW = new BroadcastChannel('intercept-channel-sw')

		this.messageId = 0
		this.waitingReplies = new Map()

		this.broadcastFromSW.onmessage = (event) => {
			const msg = event.data

			const id = msg.id
			if (msg.type === 'fetch') {
				this.fileHandler
					.readFile(msg.url)
					.then((result) => {
						this.broadcastToSW.postMessage({
							reply: id,
							result: result,
						})
					})
					.catch((error) => {
						if (`${error}`.includes('File not found')) {
							this.broadcastToSW.postMessage({
								reply: id,
								result: 'NotFoundError',
							})
							issueTracker.addError(`File "${msg.url}" was requested by the Graphic, but not found on disk.`)
						} else if (`${error}`.includes('NotAllowedError')) {
							// Not allowed access to the files anymore
							console.error('Not allowed access to the files anymore')
						} else {
							console.error('readFile error', error)

							this.broadcastToSW.postMessage({
								reply: id,
								error: error,
							})
						}
					})
			} else if (msg.type === 'fetch-from-outside') {
				issueTracker.addWarning(
					`Friendly notice: The external resource "${msg.url}" was fetched by the Graphic. This is allowed, but can be an issue in production in case of network connectivity issues.`
				)
			} else if (msg.type === 'fetch-error') {
				issueTracker.addError(`There was an error when graphic fetched "${msg.url}": ${msg.message}`)
			} else if (msg.reply !== undefined) {
				const waiting = this.waitingReplies.get(msg.reply)
				if (waiting) {
					if (msg.error) waiting.reject(msg.error)
					else waiting.resolve(msg.result)
				} else {
					console.error('no waiting reply for', msg)
				}
			} else {
				console.error('unknown message', msg)
			}
		}
	}
	async init(fileHandler) {
		console.log('Initializing Service Worker...')
		let registeredNewServiceWorker = false
		if (!this.pServiceWorker) {
			// single run thing:
			this.pServiceWorker = Promise.resolve().then(async () => {
				this.fileHandler = fileHandler

				const FILE_NAME = '/service-worker.js'

				// const registrations = await navigator.serviceWorker.getRegistrations()

				// const alreadyRegistered = registrations.find((r) => r.active && r.active.scriptURL.includes(FILE_NAME))
				// if (alreadyRegistered) {
				// 	return alreadyRegistered
				// }

				registeredNewServiceWorker = true
				return new Promise((resolve, reject) => {
					console.log('Registering Service Worker...')

					register(FILE_NAME, {
						registrationOptions: { scope: '/' },
						ready(registration) {
							resolve(registration)
						},
						registered(registration) {
							console.debug('Service worker has been registered.', registration)
						},
						cached(registration) {
							console.debug('Content has been cached for offline use.'.registration)
						},
						updatefound() {
							console.debug('New content is downloading.')
						},
						updated() {
							console.debug('New content is available; please refresh.')
						},
						offline() {
							console.debug('No internet connection found. App is running in offline mode.')
						},
						error(error) {
							console.error('Error during service worker registration:', error)
							reject(error)
						},
					})
				})
			})
		}

		const serviceWorker = await this.pServiceWorker
		console.log('Service Worker registered')

		console.log('serviceWorker', serviceWorker)

		// check that the service worker is the correct version
		const swVersion = await new Promise((resolve, reject) => {
			const id = this.messageId++
			this.broadcastToSW.postMessage({
				type: 'request-version',
				id: id,
			})
			this.waitingReplies.set(id, { resolve, reject })
			setTimeout(() => {
				reject(
					new Error(
						'Timeout while checking the service worker version. You might need to clear the browser cache and do a hard reload of the page.'
					)
				)
			}, 1000)
		})

		console.log('Service Worker version: ' + swVersion)

		if (swVersion !== SW_VERSION) {
			// Try to reload the serviceWorker

			// Avoid infinite reload loop:
			const swId = `update-service-worker-${swVersion}`
			if (!localStorage.getItem(swId)) {
				localStorage.setItem(swId, '1')

				const registrations = await navigator.serviceWorker.getRegistrations()
				for (const sw of registrations) {
					await sw.unregister()
				}
				location.reload()
			}
			console.error(`Service Worker version mismatch. Expected: ${SW_VERSION}, got: ${swVersion}`)
			throw new Error(
				`Service Worker version mismatch. You might need to clear the browser cache and do a hard reload of the page.`
			)
		}
		console.log('registeredNewServiceWorker', registeredNewServiceWorker)
		if (registeredNewServiceWorker) {
			// If we just registered the service worker, we'll need to reload the page for it to intercept requests properly.
			// (I don't know why, but it doesn't work otherwise)

			// Avoid infinite reload loop:
			const lastReload = localStorage.getItem('serviceWorkerReload') ?? 0
			const timeSinceLastReload = Date.now() - lastReload
			if (timeSinceLastReload > 10000) {
				localStorage.setItem('serviceWorkerReload', Date.now())
				setTimeout(() => {
					location.reload()
				}, 100)

				throw new Error(`Reloading the page to activate the service worker, hang on...`)
			}
		}

		// Also check that the service worker is intercepting requests correctly:
		const result = await fetch('https://TEST_SW/')
		if (result.status === 200) {
			const data = await result.json()
			if (data.version !== SW_VERSION) {
				console.error(`Service Worker version mismatch. Expected: ${SW_VERSION}, got: ${data.version}`)
				throw new Error(`Service Worker is outdated, please reload the page.`)
			}
		} else {
			throw new Error(`Service Worker doesn't seem to be working correctly, try reloading the page and try again.`)
		}

		return serviceWorker
	}
}
export const serviceWorkerHandler = new ServiceWorkerHandler()
