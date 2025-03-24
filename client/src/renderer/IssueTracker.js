class IssueTracker {
	constructor() {
		this._issues = []
		this.listeners = []
	}
	add = (msg, dontTrace) => {
		if (!dontTrace) console.error(msg)
		let str
		if (typeof msg === 'object' && msg !== null) {
			str = `${msg}`
			if (msg.stack) str += '\n' + msg.stack
		} else {
			str = `${msg}`
		}

		const existing = this._issues.find((i) => i.msg === str)
		if (!existing) {
			this._issues.push({ msg: str, time: Date.now(), count: 1 })
		} else {
			existing.count++
		}
		this.onHasChanged()
	}
	clear = () => {
		if (this._issues.length !== 0) {
			this._issues.splice(0, 99999)
			this.onHasChanged()
		}
	}
	get issues() {
		return this._issues.map((i) => `${i.count > 1 ? `(${i.count}) ` : ''}${i.msg}`)
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
