class IssueTracker {
	constructor() {
		this._errors = []
		this._warnings = []
		this.listeners = []
	}
	addError = (msg, dontTrace) => {
		this._add(true, msg, dontTrace)
	}
	addWarning = (msg, dontTrace) => {
		this._add(false, msg, dontTrace)
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
		if (changed) this.onHasChanged()
	}
	get errors() {
		return this._errors.map((i) => `${i.count > 1 ? `(${i.count}) ` : ''}${i.msg}`)
	}
	get warnings() {
		return this._warnings.map((i) => `${i.count > 1 ? `(${i.count}) ` : ''}${i.msg}`)
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
