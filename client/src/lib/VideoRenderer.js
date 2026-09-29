import { Renderer } from '../renderer/Renderer.js'
import { ResourceProvider } from '../renderer/ResourceProvider.js'
import { createOffscreenRenderContainer, captureContainerFrame } from './frameCapture.js'

/**
 * Render a graphic timeline frame-by-frame into an array of HTMLCanvasElements
 * (or stream them to a callback), using an isolated off-screen Renderer instance.
 *
 * Works for both realtime and non-realtime graphics:
 *   - For non-realtime: loads with renderType "non-realtime", calls setActionsSchedule,
 *     then seeks each frame with gotoTime.
 *   - For realtime: loads with renderType "realtime", calls setActionsSchedule,
 *     then calls gotoTime (which drives the graphic state frame-accurately).
 *
 * Supports both "html-in-canvas" (native Chrome layoutsubtree) and "dom-to-image" methods.
 * Supports cancellation via AbortSignal.
 *
 * @param {object}   opts
 * @param {object}   opts.graphic          Graphic entry (folderPath, manifest, …)
 * @param {object}   opts.settings         Renderer / playback settings
 *   { width, height, duration, quantizeFps, realtime }
 * @param {Array}    opts.schedule         Actions schedule (array of { timestamp, action } entries)
 * @param {object}   opts.data             Graphic data to inject (passed to renderer.setData)
 * @param {number}   opts.fps              Frames per second for the render loop
 * @param {number}   [opts.width]          Output width in pixels (defaults to settings.width || 1920)
 * @param {number}   [opts.height]         Output height in pixels (defaults to settings.height || 1080)
 * @param {string|null} opts.bgcolor       Background colour: null = transparent, '#rrggbb' = solid
 * @param {'html-in-canvas'|'dom-to-image'} [opts.renderMethod='html-in-canvas'] Render flow to use
 * @param {boolean}  [opts.debug=false]    Whether to display debug visual output
 * @param {HTMLElement|null} [opts.debugContainer=null] Container for mounting debug canvas
 * @param {AbortSignal} [opts.signal]      AbortSignal to cancel rendering
 * @param {Function} [opts.onProgress]     (frameIndex, totalFrames, timestampMs) => void  — called before each capture
 * @param {Function} opts.onFrame          async (canvas: HTMLCanvasElement, frameIndex: number, timestampMs: number) => void
 *                                         Called with the captured frame canvas after each seek+capture.
 *                                         Awaited before the next frame begins, so the caller controls pacing.
 * @returns {Promise<void>}                Resolves when all frames have been captured and onFrame has settled.
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

	// ── Off-screen / Debug container ────────────────────────────────────────────
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
		if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')

		let initialData = {}
		// if there is an update at 0, apply it to the initial data:
		const initialUpdate = schedule.find((item) => item.timestamp === 0)
		if (initialUpdate) {
			Object.assign(initialData, initialUpdate.action?.params?.data || initialUpdate.data || {})
		}

		if (containerInfo.renderMethod === 'html-in-canvas') {
			// ── Direct mount into canvas with Shadow DOM style encapsulation ─────
			// Mount the custom web component directly as the immediate child of <canvas layoutsubtree>
			const graphicPath = ResourceProvider.graphicPath(graphic.folderPath, graphic.manifest.main)
			const elementName = await ResourceProvider.loadGraphic(graphicPath)

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
				renderType: 'non-realtime',
				data: initialData,
				renderCharacteristics: {
					resolution: { width, height },
					_environment: 'OGraf DevTool',
				},
			})

			// If the graphic populated its light DOM (and didn't create its own shadowRoot),
			// adopt its children into an open ShadowRoot on graphicElement for total style encapsulation:
			if (!graphicElement.shadowRoot && graphicElement.childNodes.length > 0) {
				const shadow = graphicElement.attachShadow({ mode: 'open' })
				while (graphicElement.firstChild) {
					shadow.appendChild(graphicElement.firstChild)
				}
			}

			if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')

			if (schedule && schedule.length > 0 && typeof graphicElement.setActionsSchedule === 'function') {
				const actionSchedule = schedule.filter((item) => item.action?.type !== 'initialData')
				await graphicElement.setActionsSchedule({ schedule: actionSchedule })
			}

			if (typeof graphicElement.goToTime === 'function') {
				await graphicElement.goToTime({ timestamp: 0 })
			}
		} else {
			// ── Renderer with DOM-to-Image ───────────────────────────────────────
			renderer = new Renderer(containerInfo.container, { shadowDomMode: 'open' })
			renderer.setGraphic(graphic)
			renderer.setData(initialData)

			await renderer.loadGraphic(
				{
					realtime: false,
					width,
					height,
				},
				initialData
			)

			if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')

			if (schedule && schedule.length > 0) {
				await renderer.setActionsSchedule(schedule)
			}

			await renderer.gotoTime(0)
		}

		// Allow initial DOM & style/layout update
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

		// ── Frame loop ────────────────────────────────────────────────────────
		for (let i = 0; i < totalFrames; i++) {
			if (signal?.aborted) {
				throw new DOMException('Export cancelled', 'AbortError')
			}

			const currentTime = Math.min(i * frameDurationMs, duration)

			onProgress?.(i, totalFrames, currentTime)

			// Seek graphic to this timestamp
			if (graphicElement && typeof graphicElement.goToTime === 'function') {
				await graphicElement.goToTime({ timestamp: currentTime })
			} else if (renderer) {
				await renderer.gotoTime(currentTime)
			}

			// Allow browser rendering engine to layout and paint the frame
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

			// Capture the frame canvas
			const frameCanvas = await captureContainerFrame(containerInfo, width, height, bgcolor)

			if (signal?.aborted) {
				throw new DOMException('Export cancelled', 'AbortError')
			}

			// Hand off the canvas to the caller (e.g. to push a video frame)
			await onFrame?.(frameCanvas, i, currentTime)
		}

		// ── Clean up graphic instance ────────────────────────────────────────
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
		}
	} finally {
		containerInfo.cleanup()
	}
}
