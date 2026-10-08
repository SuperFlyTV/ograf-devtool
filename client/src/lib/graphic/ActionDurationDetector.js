import { captureFrameToCanvas } from '../frameCapture.js'
import { getDefaultDataFromSchema } from 'ograf-form'

/**
 * Generate a mutated copy of graphic data based on schema to ensure updateAction
 * triggers visual changes.
 */
export function generateMutatedData(schema, currentData = {}) {
	const result = JSON.parse(JSON.stringify(currentData || {}))

	const mutateObject = (propsDef, targetObj) => {
		if (!propsDef || typeof propsDef !== 'object') return
		for (const [key, prop] of Object.entries(propsDef)) {
			if (!prop || typeof prop !== 'object') continue

			if (prop.type === 'object' && prop.properties) {
				if (!targetObj[key] || typeof targetObj[key] !== 'object') targetObj[key] = {}
				mutateObject(prop.properties, targetObj[key])
			} else if (prop.type === 'string') {
				const currentVal = typeof targetObj[key] === 'string' ? targetObj[key] : prop.default || 'Sample'
				if (currentVal.endsWith(' (Updated)')) {
					targetObj[key] = currentVal.replace(/ \(Updated\)$/, '')
				} else {
					targetObj[key] = `${currentVal} (Updated)`
				}
			} else if (prop.type === 'number' || prop.type === 'integer') {
				const currentVal = typeof targetObj[key] === 'number' ? targetObj[key] : prop.default || 1
				const max = typeof prop.maximum === 'number' ? prop.maximum : Infinity
				const min = typeof prop.minimum === 'number' ? prop.minimum : -Infinity
				const nextVal = currentVal + 1
				targetObj[key] = nextVal > max ? (min !== -Infinity ? min : 0) : nextVal
			} else if (prop.type === 'boolean') {
				const currentVal = typeof targetObj[key] === 'boolean' ? targetObj[key] : Boolean(prop.default)
				targetObj[key] = !currentVal
			}
		}
	}

	if (schema?.properties) {
		mutateObject(schema.properties, result)
	} else if (Object.keys(result).length > 0) {
		for (const key of Object.keys(result)) {
			if (typeof result[key] === 'string') {
				result[key] = result[key].endsWith(' (Updated)')
					? result[key].replace(/ \(Updated\)$/, '')
					: `${result[key]} (Updated)`
			} else if (typeof result[key] === 'number') {
				result[key] = result[key] + 1
			} else if (typeof result[key] === 'boolean') {
				result[key] = !result[key]
			}
		}
	} else {
		result._updatedTimestamp = Date.now()
	}

	return result
}

// Reusable downscaled offscreen sampling canvas (320x180)
let _sampleCanvas = null
function getSampleCanvas(width = 320, height = 180) {
	if (!_sampleCanvas) {
		_sampleCanvas = document.createElement('canvas')
	}
	if (_sampleCanvas.width !== width || _sampleCanvas.height !== height) {
		_sampleCanvas.width = width
		_sampleCanvas.height = height
	}
	return _sampleCanvas
}

/**
 * Generate a small base64 thumbnail from a canvas.
 */
export function createThumbnailDataUrl(canvas, width = 160, height = 90) {
	if (!canvas) return null
	try {
		const thumbCanvas = document.createElement('canvas')
		thumbCanvas.width = width
		thumbCanvas.height = height
		const ctx = thumbCanvas.getContext('2d')
		if (!ctx) return null
		ctx.drawImage(canvas, 0, 0, width, height)
		return thumbCanvas.toDataURL('image/jpeg', 0.65)
	} catch (e) {
		return null
	}
}

/**
 * Capture downscaled pixel buffer from target container using captureFrameToCanvas.
 */
export async function captureFrameBuffer(targetElement, width = 320, height = 180) {
	if (!targetElement) return null

	try {
		const targetWidth = targetElement.clientWidth || targetElement.offsetWidth || 1920
		const targetHeight = targetElement.clientHeight || targetElement.offsetHeight || 1080

		const capturedCanvas = await captureFrameToCanvas(targetElement, targetWidth, targetHeight, null)
		if (!capturedCanvas) return null

		const sCanvas = getSampleCanvas(width, height)
		const sCtx = sCanvas.getContext('2d', { willReadFrequently: true })
		sCtx.clearRect(0, 0, width, height)
		sCtx.drawImage(capturedCanvas, 0, 0, width, height)
		return {
			buffer: sCtx.getImageData(0, 0, width, height),
			canvas: capturedCanvas,
		}
	} catch (err) {
		console.warn('ActionDurationDetector: frame capture warning:', err)
		return null
	}
}

/**
 * Count changed pixels between two frame buffers using RGBA Manhattan distance.
 */
export function countChangedPixels(bufA, bufB, threshold = 20) {
	if (!bufA || !bufB) return 0
	const dataA = bufA.data || bufA.buffer?.data
	const dataB = bufB.data || bufB.buffer?.data
	if (!dataA || !dataB) return 0
	const len = Math.min(dataA.length, dataB.length)
	let changed = 0

	for (let i = 0; i < len; i += 4) {
		const diff =
			Math.abs(dataA[i] - dataB[i]) +
			Math.abs(dataA[i + 1] - dataB[i + 1]) +
			Math.abs(dataA[i + 2] - dataB[i + 2]) +
			Math.abs(dataA[i + 3] - dataB[i + 3])
		if (diff > threshold) {
			changed++
		}
	}
	return changed
}

/**
 * Analyze a sequence of frame deltas to detect settling time and continuous motion.
 * When continuous motion is detected, uses a dynamic noise threshold calculated
 * from the recent samples (e.g. background loop/ticker noise floor) to check if
 * the main transition animation has actually settled above that baseline.
 *
 * @param {Array<{ time: number, delta: number }>} history
 * @param {number} quietWindowMs (e.g. 180ms)
 * @param {number} noiseThreshold (e.g. 15 changed pixels out of 57600)
 * @param {object} [options]
 * @param {number} [options.recentSamplesCount=12] Number of recent samples to gauge continuous motion baseline
 * @param {number} [options.dynamicMultiplier=1.35] Margin above median/mean continuous noise
 */
export function analyzeVelocitySettling(
	history,
	quietWindowMs = 180,
	noiseThreshold = 15,
	{ recentSamplesCount = 12, dynamicMultiplier = 1.35 } = {}
) {
	if (!history || history.length === 0) {
		return { settledTime: 0, hasMotion: false, isContinuous: false, dynamicThreshold: noiseThreshold }
	}

	// Helper to find settling point given a specific threshold
	const evaluateWithThreshold = (thresh) => {
		let firstIdx = -1
		let lastIdx = -1

		for (let i = 0; i < history.length; i++) {
			if (history[i].delta > thresh) {
				if (firstIdx === -1) firstIdx = i
				lastIdx = i
			}
		}

		if (firstIdx === -1) {
			return { settledTime: 0, hasMotion: false, isContinuous: false }
		}

		const lastMotionTime = history[lastIdx].time
		const totalHistoryDuration = history[history.length - 1].time

		if (totalHistoryDuration - lastMotionTime >= quietWindowMs) {
			return {
				settledTime: Math.round(lastMotionTime),
				hasMotion: true,
				isContinuous: false,
			}
		}

		return {
			settledTime: Math.round(lastMotionTime),
			hasMotion: true,
			isContinuous: true,
		}
	}

	// First pass: standard baseline noiseThreshold
	const initial = evaluateWithThreshold(noiseThreshold)

	// If motion settled normally or no motion was detected, return initial result
	if (!initial.isContinuous) {
		return {
			...initial,
			dynamicThreshold: noiseThreshold,
		}
	}

	// Motion appears continuous (did not settle under noiseThreshold).
	// We compute a dynamic noise threshold based on the tail samples to see if
	// an earlier distinct transition spike settled down to a continuous background baseline.
	const sampleCount = Math.min(recentSamplesCount, history.length)
	if (sampleCount < 4) {
		// Not enough history samples yet to reliably estimate background noise floor
		return {
			...initial,
			dynamicThreshold: noiseThreshold,
		}
	}

	const tailSamples = history.slice(-sampleCount).map((h) => h.delta)
	// Sort to find 75th percentile / median to be robust against occasional frame blips
	const sorted = [...tailSamples].sort((a, b) => a - b)
	const medianTail = sorted[Math.floor(sorted.length * 0.5)]
	const p75Tail = sorted[Math.floor(sorted.length * 0.75)]
	const maxTail = sorted[sorted.length - 1]

	// Dynamic threshold: comfortably above the tail noise floor
	// (e.g. 35% above p75 or max of tail, with a minimum margin above noiseThreshold)
	const dynamicThreshold = Math.max(
		noiseThreshold + 5,
		Math.round(Math.max(p75Tail * dynamicMultiplier, medianTail * 1.5, maxTail + 5))
	)

	// Re-evaluate using dynamic threshold
	const dynamicResult = evaluateWithThreshold(dynamicThreshold)

	// If with the dynamic threshold we found that a larger motion spike settled
	// before the tail quiet window, we successfully filtered out the continuous motion!
	if (dynamicResult.hasMotion && !dynamicResult.isContinuous) {
		return {
			settledTime: dynamicResult.settledTime,
			hasMotion: true,
			isContinuous: false,
			filteredContinuousMotion: true,
			dynamicThreshold,
			baselineNoise: medianTail,
		}
	}

	// Otherwise, motion is genuinely continuous across the whole duration
	return {
		settledTime: initial.settledTime,
		hasMotion: true,
		isContinuous: true,
		dynamicThreshold,
		baselineNoise: medianTail,
	}
}

/**
 * Measure an action in REAL-TIME mode by calling the action method and watching frames.
 */
export function resolveTargetElement(renderer, captureElement) {
	return renderer?.getGraphicElement() || renderer?.getGraphicContainer() || captureElement
}

/**
 * Wait for visual animation to settle in real-time mode.
 * Resolves when no pixels have changed for quietWindowMs, or when timeoutMs is reached.
 */
export async function waitForVisualSettlingRealtime(targetEl, { timeoutMs = 4000, quietWindowMs = 250, signal = null, onFrame = null } = {}) {
	if (!targetEl) return { settledTime: 0, hasMotion: false }

	let prevBuffer = await captureFrameBuffer(targetEl)
	const history = []
	const startTime = performance.now()
	let isRunning = true

	await new Promise((resolve) => {
		const checkNext = async () => {
			if (!isRunning || signal?.aborted) {
				resolve()
				return
			}
			const now = performance.now() - startTime
			if (now >= timeoutMs) {
				isRunning = false
				resolve()
				return
			}

			const currentBuffer = await captureFrameBuffer(targetEl)
			let delta = 0
			if (currentBuffer && prevBuffer) {
				delta = countChangedPixels(prevBuffer, currentBuffer)
				history.push({ time: now, delta })
				prevBuffer = currentBuffer
			}

			const isMotion = delta > 15
			const analysis = analyzeVelocitySettling(history, quietWindowMs)

			onFrame?.({
				elapsedMs: Math.round(now),
				isMotion,
				deltaPixels: delta,
				promiseResolved: true,
				promiseDuration: null,
				visualDuration: analysis.settledTime,
				canvas: currentBuffer?.canvas || prevBuffer?.canvas,
			})

			if (analysis.hasMotion && !analysis.isContinuous) {
				// Motion has occurred and then settled for quietWindowMs
				isRunning = false
				resolve()
				return
			}

			requestAnimationFrame(checkNext)
		}

		requestAnimationFrame(checkNext)
	})

	return analyzeVelocitySettling(history, quietWindowMs)
}

/**
 * In non-real-time mode, advance timeline from baselineTime until visual changes settle,
 * returning the final settled timeline position.
 */
export async function advanceUntilSettledNonRealtime(renderer, targetEl, {
	startTime = 0,
	maxSearchMs = 4000,
	stepMs = 33,
	quietWindowMs = 250,
	signal = null,
	onFrame = null,
	onTimeUpdate = null,
} = {}) {
	let currentTime = startTime
	await renderer.gotoTime(currentTime)
	onTimeUpdate?.(currentTime)

	let prevBuffer = await captureFrameBuffer(targetEl)
	const history = []

	while (currentTime < startTime + maxSearchMs) {
		if (signal?.aborted) break

		currentTime += stepMs
		await renderer.gotoTime(currentTime)
		onTimeUpdate?.(currentTime)

		const currentBuffer = await captureFrameBuffer(targetEl)
		let delta = 0
		if (currentBuffer && prevBuffer) {
			delta = countChangedPixels(prevBuffer, currentBuffer)
			history.push({ time: currentTime - startTime, delta })
			prevBuffer = currentBuffer
		}

		const isMotion = delta > 15
		const analysis = analyzeVelocitySettling(history, quietWindowMs)

		onFrame?.({
			elapsedMs: Math.round(currentTime - startTime),
			isMotion,
			deltaPixels: delta,
			promiseResolved: true,
			promiseDuration: null,
			visualDuration: analysis.settledTime,
			canvas: currentBuffer?.canvas || prevBuffer?.canvas,
		})

		if (analysis.hasMotion && !analysis.isContinuous) {
			break
		}
	}

	const analysis = analyzeVelocitySettling(history, quietWindowMs)
	const duration = analysis.settledTime || 0
	return {
		settledTimelineTime: startTime + duration,
		duration,
		analysis,
	}
}

/**
 * Ensure the graphic is in a "playing" state (visible / on screen / step 0 active) and settled
 * before executing subsequent actions (such as updateAction, customAction, or stopAction).
 */
export async function ensureGraphicPlayingState({
	renderer,
	targetEl,
	isRealtime,
	onFrame = null,
	onTimeUpdate = null,
	onLog = null,
	signal = null,
	timeoutMs = 4000,
}) {
	onLog?.({
		type: 'detect',
		message: 'Transitioning graphic to playing state (playAction) and waiting for animation to settle...',
	})

	if (isRealtime) {
		try {
			await renderer.playAction({})
		} catch (err) {
			console.warn('ensureGraphicPlayingState: playAction error:', err)
		}
		// Wait for in-animation visual changes to settle
		await waitForVisualSettlingRealtime(targetEl, {
			timeoutMs,
			quietWindowMs: 250,
			signal,
			onFrame,
		})
		onLog?.({
			type: 'detect',
			message: 'Graphic is in playing state and visually settled.',
		})
		return 0
	} else {
		// Non-real-time mode: schedule playAction at timestamp 0 and step timeline until motion settles
		const prepSchedule = [
			{
				timestamp: 0,
				action: {
					type: 'playAction',
					params: {},
				},
			},
		]
		await renderer.setActionsSchedule(prepSchedule)
		const { settledTimelineTime } = await advanceUntilSettledNonRealtime(renderer, targetEl, {
			startTime: 0,
			maxSearchMs: timeoutMs,
			stepMs: 33,
			quietWindowMs: 250,
			signal,
			onFrame,
			onTimeUpdate,
		})
		// Add small buffer (e.g. 100ms) past settling time to ensure clean separation
		const playingTimestamp = Math.max(1000, settledTimelineTime + 100)
		await renderer.gotoTime(playingTimestamp)
		onTimeUpdate?.(playingTimestamp)
		onLog?.({
			type: 'detect',
			message: `Graphic is in playing state and settled at timeline ${playingTimestamp}ms.`,
		})
		return playingTimestamp
	}
}


export async function measureActionRealtime({
	renderer,
	actionType,
	actionParams = {},
	captureElement,
	timeoutMs = 5000,
	quietWindowMs = 180,
	onFrame = null,
	onLog = null,
	signal = null,
}) {
	const targetEl = resolveTargetElement(renderer, captureElement)
	if (!targetEl) {
		throw new Error('No capture element available for measuring action')
	}

	onLog?.({ type: 'detect', actionKey: actionType, message: `Measuring ${actionType} in real-time...` })

	// Initial baseline frame
	let prevBuffer = await captureFrameBuffer(targetEl)
	if (prevBuffer?.canvas) {
		onFrame?.({
			elapsedMs: 0,
			isMotion: false,
			deltaPixels: 0,
			promiseResolved: false,
			promiseDuration: null,
			visualDuration: 0,
			canvas: prevBuffer.canvas,
		})
	}

	const history = []
	let isRunning = true
	let promiseResolved = false
	let promiseDuration = null
	let actionError = null

	const startTime = performance.now()

	// Launch action promise
	const actionPromise = (async () => {
		try {
			await renderer.invokeGraphicAction(actionType, actionParams)
			promiseDuration = Math.round(performance.now() - startTime)
			promiseResolved = true
			onLog?.({ type: 'detect', actionKey: actionType, message: `${actionType}: Promise resolved in ${promiseDuration}ms` })
			onFrame?.({
				elapsedMs: promiseDuration,
				isMotion: false,
				deltaPixels: 0,
				promiseResolved: true,
				promiseDuration,
				canvas: prevBuffer?.canvas,
			})
		} catch (err) {
			actionError = err
			promiseResolved = true
			promiseDuration = Math.round(performance.now() - startTime)
			onLog?.({ type: 'error', actionKey: actionType, message: `${actionType} error: ${err.message || err}` })
			onFrame?.({
				elapsedMs: promiseDuration,
				isMotion: false,
				deltaPixels: 0,
				promiseResolved: true,
				promiseDuration,
				canvas: prevBuffer?.canvas,
			})
		}
	})()

	// Visual sampling loop using requestAnimationFrame
	await new Promise((resolve) => {
		const checkNextFrame = async () => {
			if (!isRunning || signal?.aborted) {
				resolve()
				return
			}

			const now = performance.now() - startTime
			if (now >= timeoutMs) {
				isRunning = false
				resolve()
				return
			}

			const currentBuffer = await captureFrameBuffer(targetEl)
			let delta = 0
			if (currentBuffer && prevBuffer) {
				delta = countChangedPixels(prevBuffer, currentBuffer)
				history.push({ time: now, delta })
				prevBuffer = currentBuffer
			}

			// Check settling criteria
			const analysis = analyzeVelocitySettling(history, quietWindowMs)
			const isMotion = delta > 15

			onFrame?.({
				elapsedMs: Math.round(now),
				isMotion,
				deltaPixels: delta,
				promiseResolved,
				promiseDuration,
				visualDuration: analysis.settledTime,
				canvas: currentBuffer?.canvas || prevBuffer?.canvas,
			})

			if (analysis.hasMotion && !analysis.isContinuous && promiseResolved) {
				// Both visual changes settled and promise resolved
				isRunning = false
				resolve()
				return
			}

			requestAnimationFrame(checkNextFrame)
		}

		requestAnimationFrame(checkNextFrame)
	})

	isRunning = false
	await actionPromise

	if (actionError) {
		console.warn(`Action ${actionType} produced error:`, actionError)
	}

	const analysis = analyzeVelocitySettling(history, quietWindowMs)
	const visualDuration = analysis.settledTime

	let finalDuration = visualDuration
	let notice = null
	let earlyPromise = false

	if (analysis.isContinuous) {
		finalDuration = promiseDuration !== null && promiseDuration > 0 ? promiseDuration : visualDuration
		notice = `Continuous motion detected; duration set to ${finalDuration}ms.`
	} else if (analysis.filteredContinuousMotion) {
		notice = `Continuous background motion filtered out using dynamic threshold (${analysis.dynamicThreshold} px, baseline ${analysis.baselineNoise} px); transition settled at ${visualDuration}ms.`
	} else if (!analysis.hasMotion) {
		finalDuration = promiseDuration !== null ? promiseDuration : 0
		notice = `No visual motion detected; duration based on Promise resolution (${finalDuration}ms).`
	} else if (promiseDuration !== null && promiseDuration + 60 < visualDuration) {
		earlyPromise = true
		notice = `Action Promise resolved early (${promiseDuration}ms) before visual animation finished (${visualDuration}ms).`
		finalDuration = visualDuration
	} else if (promiseDuration !== null && promiseDuration > visualDuration + 350) {
		notice = `Action Promise resolved ${promiseDuration - visualDuration}ms after visual animation finished.`
		finalDuration = visualDuration
	}

	let thumbnail = null
	if (prevBuffer?.canvas) {
		thumbnail = createThumbnailDataUrl(prevBuffer.canvas)
	}

	onLog?.({
		type: 'detect',
		actionKey: actionType,
		message: `${actionType}: Visual motion settled at ${visualDuration}ms`,
	})
	if (notice) {
		onLog?.({
			type: earlyPromise ? 'warning' : 'detect',
			actionKey: actionType,
			message: `${actionType}: ${notice}`,
		})
	}

	return {
		duration: Math.max(0, Math.round(finalDuration)),
		visualDuration,
		promiseDuration,
		notice,
		earlyPromise,
		continuous: analysis.isContinuous,
		thumbnail,
	}
}

/**
 * Measure an action in NON-REAL-TIME mode by scheduling the action and stepping through time.
 */
export async function measureActionNonRealtime({
	renderer,
	actionType,
	actionParams = {},
	captureElement,
	baselineTime = 0,
	priorSchedule = [],
	maxSearchMs = 5000,
	stepMs = 33, // ~30 fps
	quietWindowMs = 180,
	onFrame = null,
	onTimeUpdate = null,
	onLog = null,
	signal = null,
}) {
	const targetEl = resolveTargetElement(renderer, captureElement)
	if (!targetEl) {
		throw new Error('No capture element available for measuring action')
	}

	onLog?.({ type: 'detect', actionKey: actionType, message: `Measuring ${actionType} in non-real-time mode (stepping timeline)...` })

	// Schedule the action at baselineTime, including any prior scheduled actions needed (e.g. initial playAction)
	const schedule = [
		...(Array.isArray(priorSchedule) ? priorSchedule : []),
		{
			timestamp: baselineTime,
			action: {
				type: actionType,
				params: actionParams,
			},
		},
	]

	await renderer.setActionsSchedule(schedule)
	await renderer.gotoTime(baselineTime)
	onTimeUpdate?.(baselineTime)

	let prevBuffer = await captureFrameBuffer(targetEl)
	if (prevBuffer?.canvas) {
		onFrame?.({
			elapsedMs: 0,
			isMotion: false,
			deltaPixels: 0,
			promiseResolved: true,
			promiseDuration: null,
			visualDuration: 0,
			canvas: prevBuffer.canvas,
		})
	}
	const history = []

	let currentTime = baselineTime

	while (currentTime < baselineTime + maxSearchMs) {
		if (signal?.aborted) break

		currentTime += stepMs
		await renderer.gotoTime(currentTime)
		onTimeUpdate?.(currentTime)

		const currentBuffer = await captureFrameBuffer(targetEl)
		let delta = 0
		if (currentBuffer && prevBuffer) {
			delta = countChangedPixels(prevBuffer, currentBuffer)
			history.push({ time: currentTime - baselineTime, delta })
			prevBuffer = currentBuffer
		}

		const isMotion = delta > 15
		const analysis = analyzeVelocitySettling(history, quietWindowMs)

		onFrame?.({
			elapsedMs: Math.round(currentTime - baselineTime),
			isMotion,
			deltaPixels: delta,
			promiseResolved: true,
			promiseDuration: null,
			visualDuration: analysis.settledTime,
			canvas: currentBuffer?.canvas || prevBuffer?.canvas,
		})

		if (analysis.hasMotion && !analysis.isContinuous) {
			break
		}
	}

	const analysis = analyzeVelocitySettling(history, quietWindowMs)
	let finalDuration = analysis.settledTime
	let notice = null

	if (analysis.isContinuous) {
		notice = `Continuous motion detected up to search limit (${finalDuration}ms).`
	} else if (analysis.filteredContinuousMotion) {
		notice = `Continuous background motion filtered out using dynamic threshold (${analysis.dynamicThreshold} px, baseline ${analysis.baselineNoise} px); transition settled at ${finalDuration}ms.`
	} else if (!analysis.hasMotion) {
		finalDuration = 0
		notice = 'No visual motion detected; duration is 0ms.'
	}

	let thumbnail = null
	if (prevBuffer?.canvas) {
		thumbnail = createThumbnailDataUrl(prevBuffer.canvas)
	}

	onLog?.({
		type: 'detect',
		actionKey: actionType,
		message: `${actionType}: Visual motion settled at ${finalDuration}ms`,
	})
	if (notice) {
		onLog?.({
			type: 'warning',
			actionKey: actionType,
			message: `${actionType}: ${notice}`,
		})
	}

	return {
		duration: Math.max(0, Math.round(finalDuration)),
		visualDuration: finalDuration,
		promiseDuration: null,
		notice,
		earlyPromise: false,
		continuous: analysis.isContinuous,
		thumbnail,
	}
}

/**
 * Run the full automated detection suite for all actions in a graphic.
 *
 * @param {object} opts
 * @param {object} opts.renderer
 * @param {object} opts.manifest
 * @param {object} opts.settings
 * @param {object} opts.currentData
 * @param {HTMLElement} [opts.captureElement]
 * @param {Function} [opts.onProgress] ({ step, total, currentAction, message, detectedDurations }) => void
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<object>>} Updated actionDurations array
 */
export async function runFullAutoDetection({
	renderer,
	manifest,
	settings,
	currentData = {},
	captureElement,
	onProgress,
	onFrame = null,
	onTimeUpdate = null,
	onLog = null,
	signal = null,
}) {
	const isRealtime = Boolean(settings?.realtime)
	const stepCount = typeof manifest?.stepCount === 'number' ? manifest.stepCount : 1
	const initialData = currentData && Object.keys(currentData).length > 0
		? currentData
		: (manifest?.schema ? getDefaultDataFromSchema(manifest.schema) : {})

	// Prepare list of actions to measure
	const actionsToMeasure = []

	// 1. playAction
	if (stepCount > 1) {
		for (let s = 0; s < stepCount; s++) {
			actionsToMeasure.push({
				key: `playAction-step-${s}`,
				type: 'playAction',
				step: s,
				params: { goto: s },
				label: `Play (Step ${s})`,
			})
		}
	} else {
		actionsToMeasure.push({
			key: 'playAction',
			type: 'playAction',
			params: {},
			label: 'Play',
		})
	}

	// 2. updateAction
	actionsToMeasure.push({
		key: 'updateAction',
		type: 'updateAction',
		params: { data: generateMutatedData(manifest?.schema, initialData) },
		label: 'Update',
	})

	// 3. customActions
	if (Array.isArray(manifest?.customActions)) {
		for (const ca of manifest.customActions) {
			if (!ca?.id) continue
			const defaultPayload = ca.schema ? getDefaultDataFromSchema(ca.schema) : {}
			actionsToMeasure.push({
				key: `customAction-${ca.id}`,
				type: 'customAction',
				customActionId: ca.id,
				params: { id: ca.id, payload: defaultPayload },
				label: `Custom: ${ca.name || ca.id}`,
			})
		}
	}

	// 4. stopAction
	actionsToMeasure.push({
		key: 'stopAction',
		type: 'stopAction',
		params: {},
		label: 'Stop',
	})

	const detectedResults = {}
	const total = actionsToMeasure.length

	onLog?.({
		type: 'detect',
		message: `Starting auto-detection for ${total} actions (${isRealtime ? 'real-time' : 'non-real-time'} mode)`,
	})

	// Helper to reload graphic to clean state before measuring
	const reloadClean = async () => {
		await renderer.clearGraphic()
		renderer.setData(initialData)
		await renderer.loadGraphic(settings, initialData)
	}

	for (let i = 0; i < actionsToMeasure.length; i++) {
		if (signal?.aborted) break
		const actionItem = actionsToMeasure[i]

		onLog?.({
			type: 'detect',
			actionKey: actionItem.key,
			message: `[${i + 1}/${total}] Preparing to measure ${actionItem.label}…`,
		})

		onProgress?.({
			step: i + 1,
			total,
			currentAction: actionItem.label,
			message: `Measuring ${actionItem.label}…`,
			detectedResults,
		})

		// Prepare state before measuring each action:
		let nonRealtimeBaseline = 0
		let nonRealtimePriorSchedule = []
		const targetEl = resolveTargetElement(renderer, captureElement)

		const actionFrameCallback = (info) => {
			onFrame?.({
				...info,
				actionKey: actionItem.key,
				actionLabel: actionItem.label,
			})
		}

		if (actionItem.type === 'playAction' && (actionItem.step === 0 || !actionItem.step)) {
			// playAction step 0: start fresh from post-load
			await reloadClean()
		} else if (actionItem.type === 'playAction' && actionItem.step > 0) {
			// Multi-step playAction (step > 0): must be playing at step - 1
			// If not yet in playing state, bring it to step - 1 and settle
			const prevStep = actionItem.step - 1
			if (isRealtime) {
				await reloadClean()
				for (let s = 0; s <= prevStep; s++) {
					await renderer.playAction({ goto: s })
					await waitForVisualSettlingRealtime(targetEl, { timeoutMs: 3000, signal, onFrame: actionFrameCallback })
				}
			} else {
				// Non-real-time: schedule prior steps
				await reloadClean()
				nonRealtimePriorSchedule = []
				let t = 0
				for (let s = 0; s <= prevStep; s++) {
					nonRealtimePriorSchedule.push({
						timestamp: t,
						action: { type: 'playAction', params: { goto: s } },
					})
					t += 1000
				}
				nonRealtimeBaseline = t
			}
		} else if (actionItem.type === 'updateAction' || actionItem.type === 'customAction' || actionItem.type === 'stopAction') {
			// Graphic MUST be in a "playing" state before measuring these actions!
			// Perform a play and wait for it to settle visually first.
			onLog?.({
				type: 'detect',
				actionKey: actionItem.key,
				message: `Ensuring graphic is in playing state before ${actionItem.label}…`,
			})

			await reloadClean()

			if (isRealtime) {
				await ensureGraphicPlayingState({
					renderer,
					targetEl,
					isRealtime: true,
					onFrame: actionFrameCallback,
					onLog,
					signal,
				})
			} else {
				const playingTime = await ensureGraphicPlayingState({
					renderer,
					targetEl,
					isRealtime: false,
					onFrame: actionFrameCallback,
					onTimeUpdate,
					onLog,
					signal,
				})
				nonRealtimeBaseline = playingTime
				nonRealtimePriorSchedule = [
					{
						timestamp: 0,
						action: { type: 'playAction', params: {} },
					},
				]
			}
		}

		let result
		if (isRealtime) {
			result = await measureActionRealtime({
				renderer,
				actionType: actionItem.type,
				actionParams: actionItem.params,
				captureElement,
				onFrame: actionFrameCallback,
				onLog,
				signal,
			})
		} else {
			result = await measureActionNonRealtime({
				renderer,
				actionType: actionItem.type,
				actionParams: actionItem.params,
				captureElement,
				baselineTime: nonRealtimeBaseline,
				priorSchedule: nonRealtimePriorSchedule,
				onFrame: actionFrameCallback,
				onTimeUpdate,
				onLog,
				signal,
			})
		}

		detectedResults[actionItem.key] = {
			...actionItem,
			...result,
		}

		onLog?.({
			type: 'result',
			actionKey: actionItem.key,
			message: `[${i + 1}/${total}] ${actionItem.label} result: duration = ${result.duration}ms (visual: ${result.visualDuration}ms${result.promiseDuration != null ? `, promise: ${result.promiseDuration}ms` : ''})`,
		})

		onProgress?.({
			step: i + 1,
			total,
			currentAction: actionItem.label,
			message: `Completed ${actionItem.label}: ${result.duration}ms`,
			detectedResults,
		})
	}

	onLog?.({
		type: 'result',
		message: `Auto-detection completed. All ${total} action durations measured.`,
	})

	// Build actionDurations manifest array from detectedResults
	const actionDurations = []

	// Process playAction
	if (stepCount > 1) {
		const steps = []
		let maxDuration = 0
		for (let s = 0; s < stepCount; s++) {
			const res = detectedResults[`playAction-step-${s}`]
			const dur = res ? res.duration : 0
			steps.push({ step: s, duration: dur })
			if (dur > maxDuration) maxDuration = dur
		}
		actionDurations.push({
			type: 'playAction',
			duration: maxDuration,
			steps,
		})
	} else if (detectedResults['playAction']) {
		actionDurations.push({
			type: 'playAction',
			duration: detectedResults['playAction'].duration,
		})
	}

	// Process updateAction
	if (detectedResults['updateAction']) {
		actionDurations.push({
			type: 'updateAction',
			duration: detectedResults['updateAction'].duration,
		})
	}

	// Process stopAction
	if (detectedResults['stopAction']) {
		actionDurations.push({
			type: 'stopAction',
			duration: detectedResults['stopAction'].duration,
		})
	}

	// Process customActions
	if (Array.isArray(manifest?.customActions)) {
		for (const ca of manifest.customActions) {
			const res = detectedResults[`customAction-${ca.id}`]
			if (res) {
				actionDurations.push({
					type: 'customAction',
					customActionId: ca.id,
					duration: res.duration,
				})
			}
		}
	}

	return {
		actionDurations,
		detectedResults,
	}
}
