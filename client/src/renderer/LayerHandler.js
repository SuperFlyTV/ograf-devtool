import { ResourceProvider } from './ResourceProvider.js'
import { issueTracker } from './IssueTracker.js'

export class LayerHandler {
	constructor(containerElement, id, zIndex) {
		this.id = id
		this.currentGraphic = null

		this.element = document.createElement('div')
		this.element.style.position = 'absolute'
		this.element.style.top = 0
		this.element.style.left = 0
		this.element.style.right = 0
		this.element.style.bottom = 0

		this.element.style.zIndex = zIndex

		// Create shadow DOM root (used to isolate styles):
		this.shadowRoot = this.element.attachShadow({ mode: 'closed' })

		containerElement.appendChild(this.element)
	}
	getStatus() {
		return {} // RenderTargetStatus, TBD
	}
	listGraphicInstances() {
		return [] // TODO
	}

	async loadGraphic(settings, graphicPath, data) {
		// Clear any existing GraphicInstance:

		if (this.currentGraphic) {
			this.clearGraphic()
		}

		const elementName = await ResourceProvider.loadGraphic(graphicPath)

		// Add element to DOM:
		const element = document.createElement(elementName)
		this.shadowRoot.appendChild(element)

		this.currentGraphic = {
			element,
			elementName,
			graphicPath,
		}

		// const baseUrl = graphicResourcePath(graphicPath)
		// 	// Remove last "/":
		// 	.replace(/\/$/, '')

		// Load the element:
		await element.load({
			// baseUrl: baseUrl, // `${this.graphicCache.serverApiUrl}/serverApi/v1/graphics/graphic/${id}/${version}`, // /resources/:localPath
			renderType: settings.realtime ? 'realtime' : 'non-realtime',
			data: data,
		})
	}
	async clearGraphic() {
		if (!this.currentGraphic) return
		try {
			await this.currentGraphic.element.dispose({})
		} catch (err) {
			console.error('Error disposing GraphicInstance:', err)
		} finally {
			this.shadowRoot.innerHTML = ''
			this.currentGraphic = null
		}
	}

	async updateAction(params) {
		return this._handleError('updateAction', () => this.currentGraphic.element.updateAction(params))
	}
	async playAction(params) {
		return this._handleError('playAction', () => this.currentGraphic.element.playAction(params))
	}
	async stopAction(params) {
		return this._handleError('stopAction', () => this.currentGraphic.element.stopAction(params))
	}

	async customAction(actionId, payload) {
		return this._handleError('customAction', () =>
			this.currentGraphic.element.customAction({
				id: actionId,
				payload: payload,
			})
		)
	}

	async goToTime(timestamp) {
		return this._handleError('goToTime', () => this.currentGraphic.element.goToTime({ timestamp }))
	}
	async setActionsSchedule(schedule) {
		return this._handleError('setActionsSchedule', () => this.currentGraphic.element.setActionsSchedule({ schedule }))
	}

	async _handleError(methodName, cb) {
		if (!this.currentGraphic) return

		// Catch any uncaught errors that may happen:
		const orgConsoleError = console.error
		console.error = (...args) => {
			issueTracker.addError(
				`Uncaught error in Graphic when calling ${methodName}(): ${args.map((a) => `${a}`).join(', ')}`,
				true
			)
			orgConsoleError(...args)
		}
		try {
			const r = { value: await cb() }

			return r
		} catch (err) {
			issueTracker.addError(`Error in Graphic when calling ${methodName}(): ${err}`)
			console.error(err)
			return
		} finally {
			// Restore console.error:
			console.error = orgConsoleError
		}
	}
}
