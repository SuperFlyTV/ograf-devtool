import { ResourceProvider } from './ResourceProvider.js'
import { issueTracker } from './IssueTracker.js'

export class LayerHandler {
	constructor(containerElement, id, zIndex, shadowDomMode = 'closed') {
		this.id = id
		this.currentGraphic = null
		this.realtime = false

		this.element = document.createElement('div')
		this.element.setAttribute('drawable', '')
		this.element.style.position = 'absolute'
		this.element.style.top = '0px'
		this.element.style.left = '0px'
		this.element.style.width = '100%'
		this.element.style.height = '100%'

		this.element.style.zIndex = zIndex

		if (shadowDomMode === 'none') {
			this.shadowRoot = this.element
		} else {
			// Create shadow DOM root (used to isolate styles):
			this.shadowRoot = this.element.attachShadow({ mode: shadowDomMode })
		}

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

		this.lastGoToTime = undefined

		const { elementName, customControllers } = await ResourceProvider.loadGraphicModule(graphicPath)

		// Add element to DOM:
		const element = document.createElement(elementName)
		element.setAttribute('drawable', '')
		element.style.display = 'block'
		element.style.width = '100%'
		element.style.height = '100%'
		this.shadowRoot.appendChild(element)

		this.currentGraphic = {
			element,
			elementName,
			graphicPath,
		}
		this.customControllers = customControllers || []

		// const baseUrl = graphicResourcePath(graphicPath)
		// 	// Remove last "/":
		// 	.replace(/\/$/, '')

		console.log('Loading graphic element...', data)

		// Load the element:
		await element.load({
			// baseUrl: baseUrl, // `${this.graphicCache.serverApiUrl}/serverApi/v1/graphics/graphic/${id}/${version}`, // /resources/:localPath
			renderType: settings.realtime ? 'realtime' : 'non-realtime',
			data: data,
			renderCharacteristics: {
				resolution: {
					width: settings.width,
					height: settings.height,
				},
				// frameRate: 60,

				// Vendor-specific:
				_environment: 'OGraf DevTool',
			},
		})
	}
	async clearGraphic() {
		console.log('Clearing graphic...')
		this.lastGoToTime = undefined
		this.pendingGoToTime = undefined
		this.isSeeking = false
		this.currentSeekPromise = null
		if (!this.currentGraphic) return
		try {
			await this.currentGraphic.element.dispose({})
		} catch (err) {
			console.error('Error disposing GraphicInstance:', err)
		} finally {
			this.shadowRoot.innerHTML = ''
			this.currentGraphic = null
			this.customControllers = []
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
		if (!this.currentGraphic) return
		if (this.lastGoToTime === timestamp && this.pendingGoToTime === undefined) return

		// If a seek is currently in flight, record this timestamp as the pending seek (discarding any previous intermediate pending seek)
		if (this.isSeeking) {
			this.pendingGoToTime = timestamp
			return this.currentSeekPromise
		}

		this.isSeeking = true
		let targetTimestamp = timestamp

		this.currentSeekPromise = (async () => {
			while (targetTimestamp !== undefined) {
				if (this.currentGraphic && this.lastGoToTime !== targetTimestamp) {
					this.lastGoToTime = targetTimestamp
					console.log(`Going to time: ${targetTimestamp}`)
					await this._handleError('goToTime', () =>
						this.currentGraphic?.element?.goToTime({ timestamp: targetTimestamp })
					)
				}
				targetTimestamp = this.pendingGoToTime
				this.pendingGoToTime = undefined
			}
		})().finally(() => {
			this.isSeeking = false
			this.currentSeekPromise = null
		})

		return this.currentSeekPromise
	}
	async setActionsSchedule(schedule) {
		const actionsOnly = Array.isArray(schedule) ? schedule.filter((item) => item.action?.type !== 'initialData') : []
		return this._handleError('setActionsSchedule', () => {
			console.log('setActionsSchedule', actionsOnly)
			return this.currentGraphic.element.setActionsSchedule({ schedule: actionsOnly })
		})
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
