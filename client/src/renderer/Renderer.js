import { LayerHandler } from './LayerHandler'
import { ResourceProvider } from './ResourceProvider'

export class Renderer {
	constructor(containerElement, options = {}) {
		const shadowDomMode = options.shadowDomMode ?? 'closed'
		// This renderer has only one layer.
		this.layer = new LayerHandler(containerElement, 'default-layer', 0, shadowDomMode)
		this.graphicState = ''
		this.data = {}
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

		try {
			this.graphicState = 'pre-load'
			this.loadGraphicStartTime = Date.now()
			await this.layer.loadGraphic(settings, graphicPath, this.data)
			this.graphicState = 'post-load'
			this.loadGraphicEndTime = Date.now()
		} catch (e) {
			this.graphicState = 'error'
			console.error(e)
			throw e
		}
	}
	/** Clear/unloads a GraphicInstance on a RenderTarget */
	async clearGraphic() {
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
	}

	async updateAction(params) {
		if (!params.skipAnimation) delete params.skipAnimation
		return this.layer.updateAction(params)
	}
	async playAction(params) {
		if (!params.skipAnimation) delete params.skipAnimation
		return this.layer.playAction(params)
	}
	async stopAction(params) {
		if (!params.skipAnimation) delete params.skipAnimation
		return this.layer.stopAction(params)
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
		return this.layer.customAction(actionId, payload)
	}

	/** Non-realtime graphics only. Go to a specific frame. */
	async gotoTime(timestamp) {
		return this.layer.goToTime(timestamp)
	}

	/** Non-realtime graphics only. Set a schedule of action invokes. */
	async setActionsSchedule(schedule) {
		return this.layer.setActionsSchedule(schedule)
	}
}
