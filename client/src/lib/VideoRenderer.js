import { Renderer } from '../renderer/Renderer.js'
import { ResourceProvider } from '../renderer/ResourceProvider.js'
import { createOffscreenRenderContainer, captureContainerFrame } from './frameCapture.js'

/**
 * Creates and initializes a managed off-screen rendering session for a graphic.
 * Handles both "html-in-canvas" (native Chrome layoutsubtree) and "dom-to-image" methods,
 * Shadow DOM style encapsulation, schedule injection, seeking, and frame capture.
 *
 * @param {object}   opts
 * @param {object}   opts.graphic       Graphic entry (folderPath, manifest, …)
 * @param {number}   opts.width         Render width in pixels
 * @param {number}   opts.height        Render height in pixels
 * @param {'html-in-canvas'|'dom-to-image'} [opts.renderMethod='html-in-canvas']
 * @param {boolean}  [opts.realtime=false] Whether to run in realtime mode
 * @param {object}   [opts.initialData={}] Initial graphic data
 * @param {Array}    [opts.schedule=[]] Actions schedule
 * @param {boolean}  [opts.debug=false] Whether to render in visible debug container
 * @param {HTMLElement|null} [opts.debugContainer=null]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{
 *   seekTo: (timestampMs: number) => Promise<void>,
 *   playAndSettle: (captureDelay?: number, skipAnimation?: boolean) => Promise<void>,
 *   captureFrame: (bgcolor?: string|null) => Promise<HTMLCanvasElement>,
 *   dispose: () => Promise<void>,
 *   containerInfo: object,
 *   renderMethod: string
 * }>}
 */
export async function createGraphicRenderSession({
	graphic,
	width,
	height,
	renderMethod = 'html-in-canvas',
	realtime = false,
	initialData = {},
	schedule = [],
	debug = false,
	debugContainer = null,
	signal = null,
}) {
	if (signal?.aborted) {
		throw new DOMException('Session cancelled', 'AbortError')
	}

	const containerInfo = createOffscreenRenderContainer({
		width,
		height,
		renderMethod,
		debug,
		debugContainer,
	})

	let graphicElement = null
	let renderer = null

	try {
		if (containerInfo.renderMethod === 'html-in-canvas') {
			// Direct mount into canvas with Shadow DOM style encapsulation
			const graphicPath = ResourceProvider.graphicPath(graphic.folderPath, graphic.manifest.main)
			const elementName = await ResourceProvider.loadGraphic(graphicPath)

			if (signal?.aborted) throw new DOMException('Session cancelled', 'AbortError')

			graphicElement = document.createElement(elementName)
			graphicElement.setAttribute('drawable', '')
			graphicElement.style.position = 'absolute'
			graphicElement.style.top = '0px'
			graphicElement.style.left = '0px'
			graphicElement.style.width = `${width}px`
			graphicElement.style.height = `${height}px`
			graphicElement.style.display = 'block'
			graphicElement.style.margin = '0'
			graphicElement.style.padding = '0'
			containerInfo.canvasElement.appendChild(graphicElement)

			await graphicElement.load({
				renderType: realtime ? 'realtime' : 'non-realtime',
				data: initialData,
				renderCharacteristics: {
					resolution: { width, height },
					_environment: 'OGraf DevTool',
				},
			})

			// If graphic populated its light DOM, adopt children into an open ShadowRoot
			if (!graphicElement.shadowRoot && graphicElement.childNodes.length > 0) {
				const shadow = graphicElement.attachShadow({ mode: 'open' })
				while (graphicElement.firstChild) {
					shadow.appendChild(graphicElement.firstChild)
				}
			}

			if (signal?.aborted) throw new DOMException('Session cancelled', 'AbortError')

			if (!realtime) {
				if (schedule && schedule.length > 0 && typeof graphicElement.setActionsSchedule === 'function') {
					const actionSchedule = schedule.filter((item) => item.action?.type !== 'initialData')
					await graphicElement.setActionsSchedule({ schedule: actionSchedule })
				}
				if (typeof graphicElement.goToTime === 'function') {
					await graphicElement.goToTime({ timestamp: 0 })
				}
			}
		} else {
			// Renderer with DOM-to-Image
			renderer = new Renderer(containerInfo.container, { shadowDomMode: 'open' })
			renderer.setGraphic(graphic)
			renderer.setData(initialData)

			await renderer.loadGraphic(
				{
					realtime,
					width,
					height,
				},
				initialData
			)

			if (signal?.aborted) throw new DOMException('Session cancelled', 'AbortError')

			if (!realtime) {
				if (schedule && schedule.length > 0) {
					await renderer.setActionsSchedule(schedule)
				}
				await renderer.gotoTime(0)
			}
		}

		// Allow initial DOM & style/layout update
		await waitForNextPaint()

		const seekTo = async (timestampMs) => {
			if (signal?.aborted) throw new DOMException('Session cancelled', 'AbortError')
			if (graphicElement && typeof graphicElement.goToTime === 'function') {
				await graphicElement.goToTime({ timestamp: timestampMs })
			} else if (renderer) {
				await renderer.gotoTime(timestampMs)
			}
			await waitForNextPaint()
		}

		const playAndSettle = async (captureDelay = 1000, skipAnimation = true) => {
			if (signal?.aborted) throw new DOMException('Session cancelled', 'AbortError')
			if (graphicElement && typeof graphicElement.playAction === 'function') {
				await graphicElement.playAction({ skipAnimation: skipAnimation || undefined })
			} else if (renderer) {
				await renderer.playAction({ skipAnimation: skipAnimation || undefined })
			}
			if (captureDelay > 0) {
				await new Promise((resolve) => setTimeout(resolve, captureDelay))
			}
			await waitForNextPaint()
		}

		const captureFrame = async (bgcolor = null) => {
			if (signal?.aborted) throw new DOMException('Session cancelled', 'AbortError')
			return captureContainerFrame(containerInfo, width, height, bgcolor)
		}

		const dispose = async () => {
			try {
				if (graphicElement) {
					if (typeof graphicElement.dispose === 'function') {
						await graphicElement.dispose({})
					}
					graphicElement.remove()
				}
				if (renderer) {
					await renderer.clearGraphic()
				}
			} catch (_) {
				// Ignore disposal errors
			} finally {
				containerInfo.cleanup()
			}
		}

		return {
			seekTo,
			playAndSettle,
			captureFrame,
			dispose,
			containerInfo,
			renderMethod: containerInfo.renderMethod,
		}
	} catch (err) {
		containerInfo.cleanup()
		throw err
	}
}

/**
 * Capture a single static frame canvas from a graphic at native resolution.
 * Supports realtime settling as well as non-realtime timeline seeking.
 *
 * @param {object} opts
 * @param {object} opts.graphic
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {string|null} [opts.bgcolor=null]
 * @param {'html-in-canvas'|'dom-to-image'} [opts.renderMethod='html-in-canvas']
 * @param {boolean} [opts.realtime=false]
 * @param {number} [opts.seekTime=0]
 * @param {number} [opts.captureDelay=1000]
 * @param {boolean} [opts.skipAnimation=true]
 * @param {object} [opts.initialData={}]
 * @param {Array} [opts.schedule=[]]
 * @param {Function} [opts.onProgress]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function captureSingleGraphicFrame({
	graphic,
	width,
	height,
	bgcolor = null,
	renderMethod = 'html-in-canvas',
	realtime = false,
	seekTime = 0,
	captureDelay = 1000,
	skipAnimation = true,
	initialData = {},
	schedule = [],
	onProgress,
}) {
	onProgress?.('Initializing render session…')
	const session = await createGraphicRenderSession({
		graphic,
		width,
		height,
		renderMethod,
		realtime,
		initialData,
		schedule,
	})

	try {
		if (realtime) {
			onProgress?.('Triggering play and waiting to settle…')
			await session.playAndSettle(captureDelay, skipAnimation)
		} else {
			onProgress?.(`Seeking to ${seekTime} ms…`)
			await session.seekTo(seekTime)
		}

		onProgress?.(`Capturing frame at ${width}×${height}…`)
		return await session.captureFrame(bgcolor)
	} finally {
		await session.dispose()
	}
}

/**
 * Render a graphic timeline frame-by-frame into HTMLCanvasElements and stream to onFrame.
 *
 * @param {object}   opts
 * @param {object}   opts.graphic          Graphic entry (folderPath, manifest, …)
 * @param {object}   opts.settings         Renderer / playback settings
 * @param {Array}    opts.schedule         Actions schedule
 * @param {number}   opts.fps              Frames per second for the render loop
 * @param {number}   [opts.width]          Output width in pixels
 * @param {number}   [opts.height]         Output height in pixels
 * @param {string|null} opts.bgcolor       Background colour: null = transparent, '#rrggbb' = solid
 * @param {'html-in-canvas'|'dom-to-image'} [opts.renderMethod='html-in-canvas'] Render flow to use
 * @param {boolean}  [opts.debug=false]
 * @param {HTMLElement|null} [opts.debugContainer=null]
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onProgress]     (frameIndex, totalFrames, timestampMs) => void
 * @param {Function} opts.onFrame          async (canvas: HTMLCanvasElement, frameIndex: number, timestampMs: number) => void
 * @returns {Promise<void>}
 */
export async function renderVideoFrames({
	graphic,
	settings,
	schedule = [],
	fps = 30,
	width: customWidth,
	height: customHeight,
	bgcolor = null,
	renderMethod = 'html-in-canvas',
	debug = false,
	debugContainer = null,
	signal,
	onProgress,
	onFrame,
}) {
	const width = customWidth || settings?.width || 1920
	const height = customHeight || settings?.height || 1080
	const duration = settings?.duration || 5000
	const frameDurationMs = 1000 / fps
	const totalFrames = Math.ceil(duration / frameDurationMs) + 1

	if (signal?.aborted) {
		throw new DOMException('Export cancelled', 'AbortError')
	}

	let initialData = {}
	const initialUpdate = schedule.find((item) => item.timestamp === 0)
	if (initialUpdate) {
		Object.assign(initialData, initialUpdate.action?.params?.data || initialUpdate.data || {})
	}

	const session = await createGraphicRenderSession({
		graphic,
		width,
		height,
		renderMethod,
		realtime: false,
		initialData,
		schedule,
		debug,
		debugContainer,
		signal,
	})

	try {
		for (let i = 0; i < totalFrames; i++) {
			if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')

			const currentTime = Math.min(i * frameDurationMs, duration)
			onProgress?.(i, totalFrames, currentTime)

			await session.seekTo(currentTime)
			const frameCanvas = await session.captureFrame(bgcolor)

			if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
			await onFrame?.(frameCanvas, i, currentTime)
		}
	} finally {
		await session.dispose()
	}
}

function waitForNextPaint() {
	return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}
