import { LayerHandler } from './LayerHandler'
import { ResourceProvider } from './ResourceProvider'

export class Renderer {
	constructor(containerElement) {
		// This renderer has only one layer.
		this.layer = new LayerHandler(containerElement, 'default-layer', 0)
		this.graphicState = ''
	}

	setGraphic(graphic) {
		this.graphic = graphic
	}
	/** Instantiate a Graphic on a RenderTarget. Returns when the load has finished. */
	async loadGraphic(settings) {
		if (this.graphicState.includes('pre')) throw new Error('loadGraphic called too quick')

		const graphicPath = ResourceProvider.graphicPath(this.graphic.path, this.graphic.manifest.main)

		try {
			this.graphicState = 'pre-load'
			this.loadGraphicStartTime = Date.now()
			await this.layer.loadGraphic(settings, graphicPath)
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
		if (this.graphicState.includes('pre')) throw new Error('clearGraphic called too quick')
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
		return this.layer.updateAction(params)
	}
	async playAction(params) {
		return this.layer.playAction(params)
	}
	async stopAction(params) {
		return this.layer.stopAction(params)
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
	async setInvokeActionsSchedule(schedule) {
		return this.layer.setInvokeActionsSchedule(schedule)
	}
}
