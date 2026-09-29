import domtoimage from 'dom-to-image-more'

/**
 * Check if the browser supports html-in-canvas (Canvas layoutsubtree and drawElementImage).
 * Available in Chromium browsers with chrome://flags/#canvas-draw-element enabled.
 * @returns {boolean}
 */
export function isHtmlInCanvasSupported() {
	if (typeof window === 'undefined' || typeof document === 'undefined') return false
	try {
		const testCanvas = document.createElement('canvas')
		const ctx = testCanvas.getContext('2d')
		return typeof ctx?.drawElementImage === 'function'
	} catch (_e) {
		return false
	}
}

/**
 * Create an off-screen (or visible debug) container for rendering graphics.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {'html-in-canvas'|'dom-to-image'} [opts.renderMethod='html-in-canvas']
 * @param {boolean} [opts.debug=false]
 * @param {HTMLElement|null} [opts.debugContainer=null]
 * @returns {{
 *   renderMethod: 'html-in-canvas'|'dom-to-image',
 *   container: HTMLElement,
 *   canvasElement: HTMLCanvasElement|null,
 *   contentElement: HTMLElement,
 *   debug: boolean,
 *   cleanup: () => void
 * }}
 */
export function createOffscreenRenderContainer({
	width,
	height,
	renderMethod = 'html-in-canvas',
	debug = false,
	debugContainer = null,
}) {
	const useHtmlInCanvas = renderMethod === 'html-in-canvas' && isHtmlInCanvasSupported()

	if (useHtmlInCanvas) {
		const canvas = document.createElement('canvas')
		canvas.setAttribute('layoutsubtree', '')
		canvas.setAttribute('content', 'drawable')
		try {
			canvas.layoutSubtree = true
		} catch (_) {}

		canvas.width = width
		canvas.height = height

		if (debug) {
			if (debugContainer) {
				canvas.style.width = '100%'
				canvas.style.height = '100%'
				canvas.style.maxHeight = '300px'
				canvas.style.objectFit = 'contain'
				canvas.style.display = 'block'
				canvas.style.position = 'relative'
				debugContainer.innerHTML = ''
				debugContainer.appendChild(canvas)
			} else {
				canvas.style.position = 'fixed'
				canvas.style.bottom = '16px'
				canvas.style.right = '16px'
				canvas.style.width = '480px'
				canvas.style.height = '270px'
				canvas.style.zIndex = '999999'
				canvas.style.border = '3px solid #ff5722'
				canvas.style.boxShadow = '0 6px 16px rgba(0,0,0,0.5)'
				canvas.style.backgroundColor = 'rgba(255,255,255,0.95)'
				canvas.style.pointerEvents = 'auto'
				document.body.appendChild(canvas)
			}
		} else {
			canvas.style.position = 'fixed'
			canvas.style.top = '0px'
			canvas.style.left = '0px'
			canvas.style.width = `${width}px`
			canvas.style.height = `${height}px`
			canvas.style.overflow = 'hidden'
			canvas.style.pointerEvents = 'none'
			canvas.style.zIndex = '-99999'
			canvas.style.opacity = '1'
			document.body.appendChild(canvas)
		}

		const resetStyle = document.createElement('style')
		resetStyle.textContent = `
			canvas[layoutsubtree], canvas[content="drawable"] {
				all: initial;
				box-sizing: border-box;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
				line-height: normal;
				color: #000000;
			}
			canvas[layoutsubtree] *, canvas[content="drawable"] * {
				margin: 0;
				padding: 0;
				box-sizing: border-box;
				line-height: normal;
				font-weight: normal;
			}
			canvas[layoutsubtree] p, canvas[content="drawable"] p,
			canvas[layoutsubtree] h1, canvas[content="drawable"] h1,
			canvas[layoutsubtree] h2, canvas[content="drawable"] h2,
			canvas[layoutsubtree] h3, canvas[content="drawable"] h3,
			canvas[layoutsubtree] h4, canvas[content="drawable"] h4,
			canvas[layoutsubtree] h5, canvas[content="drawable"] h5,
			canvas[layoutsubtree] h6, canvas[content="drawable"] h6 {
				margin: 0;
				padding: 0;
				font-weight: inherit;
				font-size: inherit;
				line-height: inherit;
				color: inherit;
			}
			canvas[layoutsubtree] svg, canvas[content="drawable"] svg,
			canvas[layoutsubtree] img, canvas[content="drawable"] img {
				vertical-align: baseline;
			}
			canvas[layoutsubtree] a, canvas[content="drawable"] a {
				color: inherit;
				text-decoration: none;
			}
			canvas[layoutsubtree] table, canvas[content="drawable"] table {
				border-collapse: separate;
				border-spacing: 0;
			}
		`
		canvas.appendChild(resetStyle)

		return {
			renderMethod: 'html-in-canvas',
			container: canvas,
			canvasElement: canvas,
			debug,
			cleanup: () => {
				canvas.remove()
			},
		}
	} else {
		const container = document.createElement('div')
		if (debug) {
			if (debugContainer) {
				container.style.width = '100%'
				container.style.height = '100%'
				container.style.maxHeight = '300px'
				container.style.overflow = 'hidden'
				container.style.position = 'relative'
				debugContainer.innerHTML = ''
				debugContainer.appendChild(container)
			} else {
				container.style.position = 'fixed'
				container.style.bottom = '16px'
				container.style.right = '16px'
				container.style.width = '480px'
				container.style.height = '270px'
				container.style.zIndex = '999999'
				container.style.border = '3px solid #ff5722'
				container.style.overflow = 'hidden'
				document.body.appendChild(container)
			}
		} else {
			container.style.position = 'fixed'
			container.style.top = '0px'
			container.style.left = `-${width + 200}px`
			container.style.width = `${width}px`
			container.style.height = `${height}px`
			container.style.overflow = 'hidden'
			container.style.pointerEvents = 'none'
			document.body.appendChild(container)
		}

		return {
			renderMethod: 'dom-to-image',
			container,
			canvasElement: null,
			debug,
			cleanup: () => {
				container.remove()
			},
		}
	}
}

/**
 * Capture a frame from an offscreen render container.
 *
 * @param {object} containerInfo Object returned by createOffscreenRenderContainer
 * @param {number} width
 * @param {number} height
 * @param {string|null} bgcolor
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function captureContainerFrame(containerInfo, width, height, bgcolor = null) {
	if (containerInfo.renderMethod === 'html-in-canvas' && containerInfo.canvasElement) {
		const canvas = containerInfo.canvasElement
		const ctx = canvas.getContext('2d')
		if (typeof ctx.reset === 'function') {
			ctx.reset()
		} else {
			ctx.clearRect(0, 0, width, height)
		}

		if (bgcolor) {
			ctx.fillStyle = bgcolor
			ctx.fillRect(0, 0, width, height)
		}

		// Direct drawable child of the canvas is the graphic element
		const targetElement = canvas.querySelector('[drawable]') || canvas.lastElementChild
		if (targetElement) {
			try {
				const t = ctx.drawElementImage(targetElement, 0, 0)
				if (t && targetElement.style) {
					targetElement.style.transform = t.toString()
				}
				if (containerInfo.debug) {
					const sample = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data
					console.log('[DEBUG HTML-in-Canvas capture]', {
						transform: t,
						centerPixelRGBA: Array.from(sample),
						targetElement,
					})
				}
			} catch (err) {
				console.warn('drawElementImage failed, falling back to dom-to-image:', err)
				return domtoimage.toCanvas(targetElement, {
					width,
					height,
					bgcolor: bgcolor ?? null,
				})
			}
		}

		return canvas
	} else {
		return domtoimage.toCanvas(containerInfo.container, {
			width,
			height,
			bgcolor: bgcolor ?? null,
		})
	}
}

/**
 * Capture a DOM element to an HTMLCanvasElement at the given resolution.
 *
 * @param {HTMLElement} element   The DOM element to capture.
 * @param {number}      width     Output canvas width in pixels.
 * @param {number}      height    Output canvas height in pixels.
 * @param {string|null} bgcolor
 *   - `null`        → transparent background (PNG alpha / VP9 alpha channel)
 *   - `'#rrggbb'`   → solid colour fill before compositing
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function captureFrameToCanvas(element, width, height, bgcolor) {
	if (element instanceof HTMLCanvasElement && typeof element.getContext('2d')?.drawElementImage === 'function') {
		const ctx = element.getContext('2d')
		if (typeof ctx.reset === 'function') ctx.reset()
		else ctx.clearRect(0, 0, width, height)

		if (bgcolor) {
			ctx.fillStyle = bgcolor
			ctx.fillRect(0, 0, width, height)
		}

		const child = element.firstElementChild || element
		const t = ctx.drawElementImage(child, 0, 0)
		if (t && child.style) child.style.transform = t.toString()
		return element
	}

	return domtoimage.toCanvas(element, {
		width,
		height,
		bgcolor: bgcolor ?? null,
	})
}

/**
 * Resolve the `bgcolor` argument from a background setting object.
 *
 * The background setting used across the app is:
 *   { type: 'transparent' }          → null   (transparent)
 *   { type: 'color', value: '#hex' } → '#hex' (solid colour)
 *
 * For backwards-compatibility a plain boolean `true` (legacy "include background")
 * maps to black, and `false` / `null` maps to transparent.
 *
 * @param {{ type: 'transparent' } | { type: 'color', value: string } | boolean | null} bg
 * @returns {string|null}
 */
export function resolveBgcolor(bg) {
	if (!bg) return null
	if (bg === true) return '#000000'
	if (typeof bg === 'object') {
		if (bg.type === 'transparent') return null
		if (bg.type === 'color') return bg.value || '#000000'
	}
	return null
}
