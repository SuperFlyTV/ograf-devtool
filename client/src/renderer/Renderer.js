import { LayerHandler } from './LayerHandler.js'
import { ResourceProvider } from './ResourceProvider.js'

export function formatGraphicCommand(actionName, arg) {
	switch (actionName) {
		case 'clearGraphic':
		case 'dispose':
			return 'graphic.dispose({})'
		case 'loadGraphic':
		case 'load': {
			const renderType = arg?.renderType || (arg?.settings?.realtime ? 'realtime' : 'non-realtime')
			const dataStr = arg?.data !== undefined ? formatPayloadPreview(arg.data) : '{}'
			return `graphic.load({ renderType: "${renderType}", data: ${dataStr} })`
		}
		case 'playAction':
			return `graphic.playAction(${formatPayloadPreview(arg || {})})`
		case 'updateAction':
			return `graphic.updateAction(${formatPayloadPreview(arg || {})})`
		case 'stopAction':
			return `graphic.stopAction(${formatPayloadPreview(arg || {})})`
		case 'customAction': {
			const id = arg?.id || arg?.actionId || 'custom'
			const payload = arg?.payload !== undefined ? formatPayloadPreview(arg.payload) : '{}'
			return `graphic.customAction({ id: "${id}", payload: ${payload} })`
		}
		case 'goToTime':
		case 'gotoTime': {
			const ts = typeof arg === 'object' && arg !== null ? (arg.timestamp ?? 0) : Number(arg)
			return `graphic.goToTime({ timestamp: ${ts} })`
		}
		case 'setActionsSchedule': {
			const sched = Array.isArray(arg?.schedule) ? arg.schedule : (Array.isArray(arg) ? arg : [])
			return `graphic.setActionsSchedule([${sched.length} action${sched.length === 1 ? '' : 's'}])`
		}
		default:
			return `graphic.${actionName}(${formatPayloadPreview(arg || {})})`
	}
}

function formatPayloadPreview(val, maxLen = 80) {
	if (val === undefined || val === null) return '{}'
	try {
		const str = JSON.stringify(val)
		if (str.length <= maxLen) return str
		return str.slice(0, maxLen - 1) + '…}'
	} catch (_) {
		return String(val)
	}
}

export class Renderer {
	constructor(containerElement, options = {}) {
		const shadowDomMode = options.shadowDomMode ?? 'none'
		// This renderer has only one layer.
		this.layer = new LayerHandler(containerElement, 'default-layer', 0, shadowDomMode)
		this.graphicState = ''
		this.data = {}
		this._listeners = new Map()
		this._commandIdCounter = 0
	}

	on(event, callback) {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, new Set())
		}
		this._listeners.get(event).add(callback)
	}

	off(event, callback) {
		const set = this._listeners.get(event)
		if (set) {
			set.delete(callback)
			if (set.size === 0) this._listeners.delete(event)
		}
	}

	emitEvent(eventType, detail) {
		const set = this._listeners.get(eventType)
		if (!set || set.size === 0) return

		let customEvent
		if (typeof CustomEvent !== 'undefined') {
			customEvent = new CustomEvent(eventType, {
				bubbles: true,
				cancelable: false,
				detail,
			})
		} else {
			customEvent = { type: eventType, detail }
		}

		for (const cb of Array.from(set)) {
			try {
				cb(customEvent)
			} catch (err) {
				console.error(`Error in event listener for ${eventType}:`, err)
			}
		}
	}

	async _runAction(actionName, arg, fn) {
		const commandId = `cmd_${++this._commandIdCounter}`
		const startTime = performance.now()
		const command = formatGraphicCommand(actionName, arg)
		this.emitEvent(`${actionName}Start`, { commandId, arg, command })
		this.emitEvent('actionStart', { actionName, commandId, arg, command })

		let result
		try {
			const res = await fn()
			result = res && typeof res === 'object' && 'value' in res ? res.value : res
			return res
		} catch (err) {
			result = { error: err.message || String(err) }
			throw err
		} finally {
			const duration = Math.round(performance.now() - startTime)
			this.emitEvent(`${actionName}End`, { commandId, arg, result, duration, command })
			this.emitEvent(actionName, { commandId, arg, result, duration, command })
			this.emitEvent('action', { actionName, commandId, arg, result, duration, command })
		}
	}

	setGraphic(graphic) {
		this.graphic = graphic
	}
	setData(data) {
		this.data = data
	}

	/** Instantiate a Graphic on a RenderTarget. Returns when the load has finished. */
	async loadGraphic(settings, data) {
		if (data !== undefined) this.data = data
		if (this.graphicState === 'pre-load') {
			// Already in the process of loading, wait or return
			return
		}

		const mainFile = this.graphic?.manifest?.main || this.graphic?.main || 'graphic.mjs'
		const folderPath = this.graphic?.folderPath || this.graphic?.path || ''
		const graphicPath = ResourceProvider.graphicPath(folderPath, mainFile)

		return this._runAction('loadGraphic', { settings, data: this.data, graphicPath }, async () => {
			try {
				this.graphicState = 'pre-load'
				this.loadGraphicStartTime = Date.now()
				await this.layer.loadGraphic(settings, graphicPath, this.data)
				this.graphicState = 'post-load'
				this.loadGraphicEndTime = Date.now()
				return this.getCustomControllers()
			} catch (e) {
				this.graphicState = 'error'
				console.error(e)
				throw e
			}
		})
	}
	getCustomControllers() {
		return this.layer.customControllers || []
	}
	getGraphicElement() {
		return this.layer.currentGraphic?.element || null
	}
	getGraphicContainer() {
		return this.layer.element || null
	}
	/** Clear/unloads a GraphicInstance on a RenderTarget */
	async clearGraphic() {
		return this._runAction('clearGraphic', {}, async () => {
			try {
				this.graphicState = 'pre-clear'
				this.clearGraphicStartTime = Date.now()
				await this.layer.clearGraphic()
				this.graphicState = 'post-clear'
				this.clearGraphicEndTime = Date.now()
			} catch (e) {
				this.graphicState = 'error'
				console.error(e)
				throw e
			}
		})
	}

	async updateAction(params = {}) {
		const actionParams = { ...params }
		if (!actionParams.skipAnimation) delete actionParams.skipAnimation
		return this._runAction('updateAction', actionParams, () => this.layer.updateAction(actionParams))
	}
	async playAction(params = {}) {
		const actionParams = { ...params }
		if (!actionParams.skipAnimation) delete actionParams.skipAnimation
		return this._runAction('playAction', actionParams, () => this.layer.playAction(actionParams))
	}
	async stopAction(params = {}) {
		const actionParams = { ...params }
		if (!actionParams.skipAnimation) delete actionParams.skipAnimation
		return this._runAction('stopAction', actionParams, () => this.layer.stopAction(actionParams))
	}

	/** Generic dispatcher for graphic actions */
	async invokeGraphicAction(type, params = {}) {
		console.log(`Invoking graphic action: ${type}`, params, new Error().stack)
		if (type === 'updateAction') {
			return this.updateAction(params)
		} else if (type === 'playAction') {
			return this.playAction(params)
		} else if (type === 'stopAction') {
			return this.stopAction(params)
		} else if (type === 'customAction') {
			return this.customAction(params.id, params.payload)
		} else if (this[type] && typeof this[type] === 'function') {
			return this[type](params)
		}
	}

	/** Invokes an action on a graphicInstance. Actions are defined by the Graphic's manifest */
	async customAction(actionId, payload) {
		let arg
		let actId
		let pld
		if (typeof actionId === 'object' && actionId !== null && 'id' in actionId) {
			actId = actionId.id
			pld = actionId.payload
			arg = actionId
		} else {
			actId = actionId
			pld = payload
			arg = { id: actionId, payload }
		}
		return this._runAction('customAction', arg, () => this.layer.customAction(actId, pld))
	}

	/** Non-realtime graphics only. Go to a specific frame. */
	async gotoTime(timestamp) {
		const arg =
			typeof timestamp === 'object' && timestamp !== null && 'timestamp' in timestamp
				? timestamp
				: { timestamp: Number(timestamp) }
		return this._runAction('goToTime', arg, () => this.layer.goToTime(arg.timestamp))
	}
	async goToTime(timestamp) {
		return this.gotoTime(timestamp)
	}

	/** Non-realtime graphics only. Set a schedule of action invokes. */
	async setActionsSchedule(schedule) {
		const arg = Array.isArray(schedule) ? { schedule } : schedule || { schedule: [] }
		return this._runAction('setActionsSchedule', arg, () => this.layer.setActionsSchedule(arg.schedule || arg))
	}
}
