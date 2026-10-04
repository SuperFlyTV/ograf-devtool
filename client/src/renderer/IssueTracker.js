export function groupExternalResources(urls) {
	if (!urls || urls.length === 0) return []

	// Deduplicate URLs while preserving insertion order
	const uniqueUrls = Array.from(new Set(urls))

	// Group by origin + top path segment
	const groups = new Map()

	for (const urlStr of uniqueUrls) {
		let groupKey = ''
		let pattern = ''
		try {
			const u = new URL(urlStr)
			const segments = u.pathname.split('/').filter(Boolean)

			if (segments.length === 0) {
				groupKey = u.origin
				pattern = `${u.origin}/*`
			} else if (segments.length === 1) {
				if (/\.[a-zA-Z0-9]+$/.test(segments[0])) {
					groupKey = u.origin
					pattern = `${u.origin}/*`
				} else {
					groupKey = `${u.origin}/${segments[0]}`
					pattern = `${u.origin}/${segments[0]}/*`
				}
			} else {
				groupKey = `${u.origin}/${segments[0]}`
				pattern = `${u.origin}/${segments[0]}/*`
			}
		} catch (_e) {
			groupKey = 'other'
			pattern = urlStr
		}

		if (!groups.has(groupKey)) {
			groups.set(groupKey, { pattern, urls: [] })
		}
		groups.get(groupKey).urls.push(urlStr)
	}

	const messages = []
	for (const { pattern, urls: groupUrls } of groups.values()) {
		let msg = `Friendly notice: The Graphic is fetching resources from an external server. This is allowed, but can be an issue in production in case of network connectivity issues. Referenced files:`
		if (groupUrls.length <= 2) {
			for (const u of groupUrls) {
				msg += `\n* ${u}`
			}
		} else {
			msg += `\n* ${groupUrls[0]}`
			msg += `\n* ${groupUrls[1]}`
			const remaining = groupUrls.length - 2
			msg += `\nand ${remaining} other from ${pattern}`
		}
		messages.push(msg)
	}

	return messages
}

class IssueTracker {
	constructor() {
		this._errors = []
		this._warnings = []
		this._externalResources = []
		this.listeners = []
	}
	addError = (msg, dontTrace) => {
		this._add(true, msg, dontTrace)
	}
	addWarning = (msg, dontTrace) => {
		if (typeof msg === 'string') {
			const match = msg.match(/Friendly notice: The external resource "([^"]+)" was fetched by the Graphic/)
			if (match) {
				this.addExternalResource(match[1])
				return
			}
		}
		this._add(false, msg, dontTrace)
	}
	addExternalResource = (url) => {
		this._externalResources.push(url)
		this.onHasChanged()
	}
	_add = (isError, msg, dontTrace) => {
		if (!dontTrace) console.error(msg)
		let str
		if (msg instanceof Error) {
			str = `${msg}`
			if (msg.stack) str += '\n' + msg.stack
		} else if (msg instanceof Event) {
			console.log(new Error().stack)

			str = `${msg}`
		} else if (typeof msg === 'object' && msg !== null) {
			str = `${msg}`
			if (msg.stack) str += '\n' + msg.stack
		} else {
			str = `${msg}`
		}

		const array = isError ? this._errors : this._warnings

		const existing = array.find((i) => i.msg === str)
		if (!existing) {
			array.push({ msg: str, time: Date.now(), count: 1 })
		} else {
			existing.count++
		}
		this.onHasChanged()
	}
	clear = () => {
		let changed = false

		if (this._errors.length !== 0) {
			this._errors.splice(0, 99999)
			changed = true
		}
		if (this._warnings.length !== 0) {
			this._warnings.splice(0, 99999)
			changed = true
		}
		if (this._externalResources.length !== 0) {
			this._externalResources.splice(0, 99999)
			changed = true
		}
		if (changed) this.onHasChanged()
	}
	clearWarnings = () => {
		let changed = false
		if (this._warnings.length !== 0) {
			this._warnings.splice(0, 99999)
			changed = true
		}
		if (this._externalResources.length !== 0) {
			this._externalResources.splice(0, 99999)
			changed = true
		}
		if (changed) this.onHasChanged()
	}
	get errors() {
		return this._errors.map((i) => `${i.count > 1 ? `(${i.count}) ` : ''}${i.msg}`)
	}
	get warnings() {
		const regular = this._warnings.map((i) => `${i.count > 1 ? `(${i.count}) ` : ''}${i.msg}`)
		const external = this.externalWarnings
		return [...regular, ...external]
	}
	get rawWarnings() {
		return this._warnings.map((i) => `${i.count > 1 ? `(${i.count}) ` : ''}${i.msg}`)
	}
	get externalWarnings() {
		return groupExternalResources(this._externalResources)
	}
	get externalResources() {
		return [...this._externalResources]
	}
	get hasExternalResources() {
		return this._externalResources.length > 0
	}
	onHasChanged() {
		if (this.hasChangedDelay) clearTimeout(this.hasChangedDelay)

		this.hasChangedDelay = setTimeout(() => {
			this.hasChangedDelay = null
			for (const listener of this.listeners) {
				listener()
			}
		}, 1)
	}
	listenToChanges(cb) {
		this.listeners.push(cb)
		return {
			stop: () => {
				const i = this.listeners.findIndex((c) => c === cb)
				if (i === -1) throw new Error('stop: no index found for callback')
				this.listeners.splice(i, 1)
			},
		}
	}
}
export const issueTracker = new IssueTracker()

