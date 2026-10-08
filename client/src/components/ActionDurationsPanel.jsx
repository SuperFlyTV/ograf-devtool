import * as React from 'react'
import {
	Accordion,
	Button,
	ButtonGroup,
	Badge,
	Form,
	InputGroup,
	ProgressBar,
	OverlayTrigger,
	Tooltip,
	Table,
	Alert,
} from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
	faPlay,
	faStop,
	faRotateRight,
	faCheck,
	faTriangleExclamation,
	faCircleInfo,
	faFloppyDisk,
	faArrowsRotate,
	faWandMagicSparkles,
	faTerminal,
} from '@fortawesome/free-solid-svg-icons'
import {
	runFullAutoDetection,
	measureActionRealtime,
	measureActionNonRealtime,
	generateMutatedData,
	ensureGraphicPlayingState,
	resolveTargetElement,
	waitForVisualSettlingRealtime,
} from '../lib/graphic/ActionDurationDetector.js'
import { fileHandler } from '../FileHandler.js'
import { issueTracker } from '../renderer/IssueTracker.js'
import { formatGraphicCommand } from '../renderer/Renderer.js'
import { getDefaultDataFromSchema } from 'ograf-form'

/**
 * Normalizes manifest.actionDurations into a mutable working map / list.
 */
function normalizeManifestDurations(manifest) {
	const stepCount = typeof manifest?.stepCount === 'number' ? manifest.stepCount : 1
	const items = []

	// Existing duration map from manifest
	const existingList = Array.isArray(manifest?.actionDurations) ? manifest.actionDurations : []
	const playDef = existingList.find((d) => d.type === 'playAction')
	const updateDef = existingList.find((d) => d.type === 'updateAction')
	const stopDef = existingList.find((d) => d.type === 'stopAction')

	// 1. playAction (multi-step or single)
	if (stepCount > 1) {
		for (let s = 0; s < stepCount; s++) {
			const stepMatch = playDef?.steps?.find((st) => st.step === s)
			const durationVal = stepMatch?.duration ?? playDef?.duration ?? 0
			items.push({
				key: `playAction-step-${s}`,
				type: 'playAction',
				step: s,
				label: `Play (Step ${s})`,
				duration: durationVal,
			})
		}
	} else {
		items.push({
			key: 'playAction',
			type: 'playAction',
			label: 'Play',
			duration: playDef?.duration ?? 0,
		})
	}

	// 2. updateAction
	items.push({
		key: 'updateAction',
		type: 'updateAction',
		label: 'Update',
		duration: updateDef?.duration ?? 0,
	})

	// 3. customActions
	if (Array.isArray(manifest?.customActions)) {
		for (const ca of manifest.customActions) {
			if (!ca?.id) continue
			const customDef = existingList.find((d) => d.type === 'customAction' && d.customActionId === ca.id)
			items.push({
				key: `customAction-${ca.id}`,
				type: 'customAction',
				customActionId: ca.id,
				label: `Custom: ${ca.name || ca.id}`,
				duration: customDef?.duration ?? 0,
			})
		}
	}

	// 4. stopAction
	items.push({
		key: 'stopAction',
		type: 'stopAction',
		label: 'Stop',
		duration: stopDef?.duration ?? 0,
	})

	return items
}

/**
 * Reconstruct manifest actionDurations array from items list.
 */
function buildManifestActionDurations(items, stepCount = 1) {
	const result = []

	// 1. playAction
	if (stepCount > 1) {
		const stepItems = items.filter((it) => it.type === 'playAction')
		let maxDur = 0
		const steps = stepItems.map((it) => {
			const dur = typeof it.duration === 'number' ? it.duration : 0
			if (dur > maxDur) maxDur = dur
			return { step: it.step, duration: dur }
		})
		result.push({
			type: 'playAction',
			duration: maxDur,
			steps,
		})
	} else {
		const playItem = items.find((it) => it.type === 'playAction')
		if (playItem) {
			result.push({
				type: 'playAction',
				duration: typeof playItem.duration === 'number' ? playItem.duration : 0,
			})
		}
	}

	// 2. updateAction
	const updateItem = items.find((it) => it.type === 'updateAction')
	if (updateItem) {
		result.push({
			type: 'updateAction',
			duration: typeof updateItem.duration === 'number' ? updateItem.duration : 0,
		})
	}

	// 3. stopAction
	const stopItem = items.find((it) => it.type === 'stopAction')
	if (stopItem) {
		result.push({
			type: 'stopAction',
			duration: typeof stopItem.duration === 'number' ? stopItem.duration : 0,
		})
	}

	// 4. customActions
	const customItems = items.filter((it) => it.type === 'customAction')
	for (const ci of customItems) {
		result.push({
			type: 'customAction',
			customActionId: ci.customActionId,
			duration: typeof ci.duration === 'number' ? ci.duration : 0,
		})
	}

	return result
}

function drawPreviewFrame(targetCanvas, sourceCanvas) {
	if (!targetCanvas || !sourceCanvas) return
	try {
		const ctx = targetCanvas.getContext('2d')
		if (!ctx) return
		ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
		ctx.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height)
	} catch (e) {
		console.warn('drawPreviewFrame error:', e)
	}
}

function getLogBadgeInfo(type, actionName) {
	if (type === 'error') return { label: 'ERROR', bg: 'bg-danger text-light' }
	if (type === 'warning') return { label: 'WARN', bg: 'bg-warning text-dark' }
	if (type === 'result') return { label: 'RESULT', bg: 'bg-success text-light' }
	if (type === 'detect')
		return { label: 'DETECT', bg: 'bg-info bg-opacity-25 text-info border border-info border-opacity-50' }

	switch (actionName) {
		case 'clearGraphic':
			return { label: 'CLEAR', bg: 'bg-secondary text-light' }
		case 'loadGraphic':
			return { label: 'LOAD', bg: 'bg-info text-dark' }
		case 'playAction':
			return { label: 'PLAY', bg: 'bg-primary text-light' }
		case 'updateAction':
			return { label: 'UPDATE', bg: 'bg-primary bg-opacity-75 text-light' }
		case 'stopAction':
			return { label: 'STOP', bg: 'bg-danger text-light' }
		case 'customAction':
			return { label: 'CUSTOM', bg: 'bg-secondary text-light' }
		case 'goToTime':
			return { label: 'TIME', bg: 'bg-dark text-white-50 border border-secondary' }
		case 'setActionsSchedule':
			return { label: 'SCHEDULE', bg: 'bg-dark text-info border border-info' }
		default:
			return { label: actionName ? actionName.toUpperCase() : 'ACTION', bg: 'bg-secondary text-light' }
	}
}

export function ActionDurationsPanel({
	manifest,
	graphic,
	renderer,
	rendererRef,
	canvasRef,
	settings,
	onSettingsChange,
	onUpdateManifest,
	externalData = {},
	onTimeUpdate,
}) {
	const stepCount = typeof manifest?.stepCount === 'number' ? manifest.stepCount : 1

	const [items, setItems] = React.useState(() => normalizeManifestDurations(manifest))
	const [diagnostics, setDiagnostics] = React.useState({}) // map of key -> { notice, earlyPromise, visualDuration, promiseDuration }
	const [liveStatus, setLiveStatus] = React.useState(null) // { actionKey, actionLabel, elapsedMs, isMotion, deltaPixels, promiseResolved, promiseDuration }
	const [isDetectingAll, setIsDetectingAll] = React.useState(false)
	const [detectingKey, setDetectingKey] = React.useState(null)
	const [progress, setProgress] = React.useState(null) // { step, total, isRunning, currentAction, message }
	const [isSaving, setIsSaving] = React.useState(false)
	const [saveMessage, setSaveMessage] = React.useState(null)

	const [logs, setLogs] = React.useState([])
	const logContainerRef = React.useRef(null)

	const addLog = React.useCallback((entry) => {
		setLogs((prev) => [
			...prev.slice(-249),
			{
				id: Math.random().toString(36).slice(2),
				timestamp: new Date().toLocaleTimeString('en-US', {
					hour12: false,
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
					fractionalSecondDigits: 3,
				}),
				...entry,
			},
		])
	}, [])

	// Listen to all commands sent to the graphic via renderer
	React.useEffect(() => {
		const r = renderer || rendererRef?.current
		if (!r) return

		const handleAction = (event) => {
			const { actionName, arg, result, duration, command } = event.detail || {}
			const cmdText = command || formatGraphicCommand(actionName, arg)
			let message = cmdText
			if (result?.error) {
				message += ` ❌ Error: ${result.error}`
			} else if (duration != null) {
				message += ` [${duration}ms]`
			}

			addLog({
				type: result?.error ? 'error' : 'command',
				actionName,
				message,
				details: arg,
			})
		}

		r.on('action', handleAction)
		return () => {
			r.off('action', handleAction)
		}
	}, [renderer, rendererRef, addLog])

	// Auto-scroll terminal log to bottom on new entries
	React.useEffect(() => {
		if (logContainerRef.current) {
			logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
		}
	}, [logs])

	const abortControllerRef = React.useRef(null)
	const previewCanvasRef = React.useRef(null)
	const lastCanvasRef = React.useRef(null)

	// Repaint preview canvas whenever liveStatus changes if we have a cached frame
	React.useEffect(() => {
		if (previewCanvasRef.current && lastCanvasRef.current) {
			drawPreviewFrame(previewCanvasRef.current, lastCanvasRef.current)
		}
	}, [liveStatus])

	// Sync local items when manifest on disk changes externally
	React.useEffect(() => {
		setItems(normalizeManifestDurations(manifest))
	}, [manifest])

	// Check if working items differ from manifest
	const isDirty = React.useMemo(() => {
		const currentObj = buildManifestActionDurations(items, stepCount)
		const manifestObj = manifest?.actionDurations || []
		return JSON.stringify(currentObj) !== JSON.stringify(manifestObj)
	}, [items, stepCount, manifest?.actionDurations])

	// Handle duration input change
	const handleDurationChange = (key, value) => {
		let num = parseInt(value, 10)
		if (isNaN(num)) num = 0
		if (num < -1) num = -1

		setItems((prev) => prev.map((item) => (item.key === key ? { ...item, duration: num } : item)))
	}

	// Auto-detect All
	const handleDetectAll = async () => {
		const r = renderer || rendererRef?.current
		if (!r) return
		setIsDetectingAll(true)
		setProgress({ step: 0, total: items.length, isRunning: true, currentAction: 'Starting…', message: 'Initializing…' })
		setSaveMessage(null)
		lastCanvasRef.current = null

		const abortController = new AbortController()
		abortControllerRef.current = abortController

		try {
			const res = await runFullAutoDetection({
				renderer: r,
				manifest,
				settings,
				currentData: externalData,
				captureElement: canvasRef?.current,
				signal: abortController.signal,
				onTimeUpdate,
				onLog: addLog,
				onFrame: (frameInfo) => {
					setLiveStatus(frameInfo)
					if (frameInfo?.canvas) {
						lastCanvasRef.current = frameInfo.canvas
						if (previewCanvasRef.current) {
							drawPreviewFrame(previewCanvasRef.current, frameInfo.canvas)
						}
					}
				},
				onProgress: (prog) => {
					setProgress(prog)
					if (prog.detectedResults) {
						// Update working durations in real time
						setItems((prev) =>
							prev.map((item) => {
								const d = prog.detectedResults[item.key]
								return d ? { ...item, duration: d.duration } : item
							})
						)
						setDiagnostics((prev) => ({
							...prev,
							...prog.detectedResults,
						}))
					}
				},
			})

			if (!abortController.signal.aborted) {
				setItems((prev) =>
					prev.map((item) => {
						const d = res.detectedResults[item.key]
						return d ? { ...item, duration: d.duration } : item
					})
				)
				setDiagnostics(res.detectedResults || {})
				setProgress({
					step: items.length,
					total: items.length,
					isRunning: false,
					currentAction: 'Done',
					message: 'Detection complete! Review values and click Save to Manifest.',
				})
			}
		} catch (err) {
			console.error('Error during action duration detection:', err)
			issueTracker.addError(`Auto-detection failed: ${err.message || err}`)
		} finally {
			setIsDetectingAll(false)
			setLiveStatus(null)
			abortControllerRef.current = null
		}
	}

	const handleCancelDetection = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort()
			abortControllerRef.current = null
			setIsDetectingAll(false)
			setLiveStatus(null)
			setProgress(null)
		}
	}

	// Measure single action
	const handleMeasureSingle = async (item) => {
		const r = renderer || rendererRef?.current
		if (!r || detectingKey || isDetectingAll) return
		setDetectingKey(item.key)
		setSaveMessage(null)
		setLiveStatus({
			actionKey: item.key,
			actionLabel: item.label,
			elapsedMs: 0,
			isMotion: false,
			deltaPixels: 0,
			promiseResolved: false,
			promiseDuration: null,
		})

		const isRealtime = Boolean(settings?.realtime)
		const abortController = new AbortController()
		abortControllerRef.current = abortController

		try {
			// Prepare parameters for this action
			let actionParams = {}
			if (item.type === 'playAction' && typeof item.step === 'number') {
				actionParams = { goto: item.step }
			} else if (item.type === 'updateAction') {
				const initialData =
					externalData && Object.keys(externalData).length > 0
						? externalData
						: manifest?.schema
						? getDefaultDataFromSchema(manifest.schema)
						: {}
				actionParams = { data: generateMutatedData(manifest?.schema, initialData) }
			} else if (item.type === 'customAction') {
				const ca = manifest?.customActions?.find((a) => a.id === item.customActionId)
				const payload = ca?.schema ? getDefaultDataFromSchema(ca.schema) : {}
				actionParams = { id: item.customActionId, payload }
			}

			lastCanvasRef.current = null
			const onFrameCallback = (frameInfo) => {
				setLiveStatus({
					...frameInfo,
					actionKey: item.key,
					actionLabel: item.label,
				})
				if (frameInfo?.canvas) {
					lastCanvasRef.current = frameInfo.canvas
					if (previewCanvasRef.current) {
						drawPreviewFrame(previewCanvasRef.current, frameInfo.canvas)
					}
				}
			}

			// Prepare state before measuring:
			const targetEl = resolveTargetElement(r, canvasRef?.current)
			let nonRealtimeBaseline = 0
			let nonRealtimePriorSchedule = []

			const reloadClean = async () => {
				await r.clearGraphic()
				const initialData =
					externalData && Object.keys(externalData).length > 0
						? externalData
						: manifest?.schema
						? getDefaultDataFromSchema(manifest.schema)
						: {}
				r.setData(initialData)
				await r.loadGraphic(settings, initialData)
			}

			if (item.type === 'playAction' && (item.step === 0 || !item.step)) {
				// Start clean for playAction step 0
				await reloadClean()
			} else if (item.type === 'playAction' && item.step > 0) {
				// Multi-step: ensure playing up to step - 1
				await reloadClean()
				const prevStep = item.step - 1
				if (isRealtime) {
					for (let s = 0; s <= prevStep; s++) {
						await r.playAction({ goto: s })
						await waitForVisualSettlingRealtime(targetEl, { timeoutMs: 3000, signal: abortController.signal })
					}
				} else {
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
			} else if (item.type === 'updateAction' || item.type === 'customAction' || item.type === 'stopAction') {
				// Graphic MUST be in a "playing" state before measuring these actions!
				addLog({
					type: 'detect',
					actionKey: item.key,
					message: `Ensuring graphic is in playing state before measuring ${item.label}…`,
				})

				await reloadClean()

				if (isRealtime) {
					await ensureGraphicPlayingState({
						renderer: r,
						targetEl,
						isRealtime: true,
						onFrame: onFrameCallback,
						onLog: addLog,
						signal: abortController.signal,
					})
				} else {
					const playingTime = await ensureGraphicPlayingState({
						renderer: r,
						targetEl,
						isRealtime: false,
						onFrame: onFrameCallback,
						onTimeUpdate,
						onLog: addLog,
						signal: abortController.signal,
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
					renderer: r,
					actionType: item.type,
					actionParams,
					captureElement: canvasRef?.current,
					onFrame: onFrameCallback,
					onLog: addLog,
					signal: abortController.signal,
				})
			} else {
				result = await measureActionNonRealtime({
					renderer: r,
					actionType: item.type,
					actionParams,
					captureElement: canvasRef?.current,
					baselineTime: nonRealtimeBaseline,
					priorSchedule: nonRealtimePriorSchedule,
					onFrame: onFrameCallback,
					onTimeUpdate,
					onLog: addLog,
					signal: abortController.signal,
				})
			}

			if (!abortController.signal.aborted) {
				setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, duration: result.duration } : it)))
				setDiagnostics((prev) => ({
					...prev,
					[item.key]: result,
				}))
				addLog({
					type: 'result',
					actionKey: item.key,
					message: `${item.label} measured: duration = ${result.duration}ms (visual: ${result.visualDuration}ms${
						result.promiseDuration != null ? `, promise: ${result.promiseDuration}ms` : ''
					})`,
				})
			}
		} catch (err) {
			console.error(`Error measuring ${item.label}:`, err)
			issueTracker.addError(`Failed to measure ${item.label}: ${err.message || err}`)
			addLog({
				type: 'error',
				actionKey: item.key,
				message: `Failed to measure ${item.label}: ${err.message || err}`,
			})
		} finally {
			setDetectingKey(null)
			setLiveStatus(null)
			abortControllerRef.current = null
		}
	}

	// Test single action (plays it in preview)
	const handleTestAction = async (item) => {
		const r = renderer || rendererRef?.current
		if (!r) return
		try {
			issueTracker.clear()
			let actionParams = {}
			if (item.type === 'playAction') {
				actionParams = typeof item.step === 'number' ? { goto: item.step } : {}
				await r.playAction(actionParams)
			} else if (item.type === 'updateAction') {
				actionParams = { data: externalData }
				await r.updateAction(actionParams)
			} else if (item.type === 'stopAction') {
				await r.stopAction({})
			} else if (item.type === 'customAction') {
				const ca = manifest?.customActions?.find((a) => a.id === item.customActionId)
				const payload = ca?.schema ? getDefaultDataFromSchema(ca.schema) : {}
				await r.customAction(item.customActionId, payload)
			}
		} catch (err) {
			console.error(`Error testing action ${item.label}:`, err)
			issueTracker.addError(`Error executing ${item.label}: ${err.message || err}`)
			addLog({
				type: 'error',
				actionName: item.type,
				message: `Error executing ${item.label}: ${err.message || err}`,
			})
		}
	}

	// Save to Manifest
	const handleSaveManifest = async () => {
		if (!graphic) return
		setIsSaving(true)
		setSaveMessage(null)

		try {
			const updatedDurations = buildManifestActionDurations(items, stepCount)
			const updatedManifest = {
				...manifest,
				actionDurations: updatedDurations,
			}

			await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
			graphic.manifest = updatedManifest
			if (onUpdateManifest) onUpdateManifest(updatedManifest)

			setSaveMessage('Saved actionDurations to manifest!')
			addLog({
				type: 'result',
				message: `Saved actionDurations to manifest (${items.length} actions)`,
			})
			setTimeout(() => setSaveMessage(null), 3000)
		} catch (err) {
			console.error('Failed to save manifest actionDurations:', err)
			issueTracker.addError(`Failed to save manifest: ${err.message || err}`)
			addLog({
				type: 'error',
				message: `Failed to save manifest: ${err.message || err}`,
			})
		} finally {
			setIsSaving(false)
		}
	}

	// Reset to Manifest values
	const handleReset = () => {
		setItems(normalizeManifestDurations(manifest))
		setDiagnostics({})
		setSaveMessage(null)
		addLog({
			type: 'detect',
			message: 'Reset working action durations from manifest',
		})
	}

	const supportsRealTime = Boolean(manifest?.supportsRealTime)
	const supportsNonRealTime = Boolean(manifest?.supportsNonRealTime)
	const currentMode = settings?.realtime ? 'realtime' : 'non-realtime'

	return (
		<div className="action-durations-panel">
			<Accordion defaultActiveKey="0" alwaysOpen>
				<Accordion.Item eventKey="0">
					<Accordion.Header>
						<div className="d-flex align-items-center justify-content-between w-100 pe-3">
							<span className="fw-semibold">Action Durations</span>
							<div className="d-flex align-items-center gap-2">
								{isDirty && (
									<Badge bg="warning" text="dark" className="fs-8">
										Unsaved changes
									</Badge>
								)}
								<Badge bg="secondary" className="fs-8">
									{items.length} {items.length === 1 ? 'action' : 'actions'}
								</Badge>
							</div>
						</div>
					</Accordion.Header>
					<Accordion.Body className="p-3">
						{/* Mode Status & Toggle */}
						<div className="d-flex align-items-center justify-content-between mb-3 p-2 bg-dark rounded border border-secondary border-opacity-25">
							<div className="small">
								<span className="text-muted">Measuring via: </span>
								<strong className="text-light">
									{currentMode === 'realtime' ? 'Real-Time' : 'Non-Real-Time (Stepping)'}
								</strong>
							</div>
							{supportsRealTime && supportsNonRealTime && (
								<Button
									variant="outline-secondary"
									size="sm"
									className="py-0 px-2 fs-7"
									onClick={() =>
										onSettingsChange?.({
											...settings,
											realtime: !settings.realtime,
										})
									}
									title="Switch rendering mode for detection"
								>
									Switch to {currentMode === 'realtime' ? 'Non-Real-Time' : 'Real-Time'}
								</Button>
							)}
						</div>

						{/* Top Actions: Auto-detect All */}
						<div className="d-flex gap-2 mb-3">
							<Button
								variant="primary"
								size="sm"
								className="w-100 fw-semibold d-flex align-items-center justify-content-center gap-2"
								onClick={handleDetectAll}
								disabled={isDetectingAll || Boolean(detectingKey)}
							>
								{isDetectingAll ? (
									<>
										<FontAwesomeIcon icon={faArrowsRotate} spin />
										Auto-detecting…
									</>
								) : (
									<>
										<FontAwesomeIcon icon={faWandMagicSparkles} />
										Auto-Detect All Durations
									</>
								)}
							</Button>
							{isDetectingAll && (
								<Button variant="danger" size="sm" onClick={handleCancelDetection}>
									Stop
								</Button>
							)}
						</div>

						{/* Progress Bar during auto-detect */}
						{progress && (
							<div className="mb-3 p-2 rounded bg-dark border border-secondary border-opacity-25">
								<div className="d-flex justify-content-between small text-muted mb-1">
									<span>{progress.currentAction || 'Detecting…'}</span>
									<span>
										{progress.step} / {progress.total}
									</span>
								</div>
								<ProgressBar
									now={progress.total > 0 ? (progress.step / (progress.total + (progress.isRunning ? 1 : 0))) * 100 : 0}
									variant="info"
									animated={isDetectingAll}
									style={{ height: '6px' }}
								/>
								<div className="fs-8 text-light mt-1 text-truncate">{progress.message}</div>
							</div>
						)}

						{/* Live Real-time Analysis Feedback */}
						{liveStatus && (
							<div className="mb-3 p-2 rounded bg-dark border border-info border-opacity-50">
								<div className="d-flex align-items-center justify-content-between mb-2">
									<span className="fs-7 fw-bold text-info d-flex align-items-center gap-2 text-truncate">
										<FontAwesomeIcon icon={faArrowsRotate} spin />
										Analyzing: {liveStatus.actionLabel || progress?.currentAction}
									</span>
									<span className="font-monospace fs-7 text-white-50">
										{liveStatus.elapsedMs != null ? `${liveStatus.elapsedMs}ms` : ''}
									</span>
								</div>

								{/* Rendered Canvas Live Preview */}
								<div className="duration-preview-canvas-wrapper mb-2 position-relative text-center">
									<canvas
										ref={previewCanvasRef}
										width={320}
										height={180}
										className="duration-preview-canvas checkered-bg rounded border border-secondary border-opacity-50"
										style={{
											width: '100%',
											maxWidth: '320px',
											height: 'auto',
											aspectRatio: '16 / 9',
											display: 'block',
											margin: '0 auto',
											objectFit: 'contain',
											backgroundColor: '#151515',
										}}
									/>
									<div
										className="position-absolute bottom-0 start-50 translate-middle-x mb-1 px-2 py-0 rounded bg-dark bg-opacity-75 text-white-50 font-monospace fs-8"
										style={{ pointerEvents: 'none' }}
									>
										{liveStatus.elapsedMs != null ? `${liveStatus.elapsedMs}ms` : '0ms'}
									</div>
								</div>

								<div className="d-flex flex-wrap align-items-center gap-3">
									{/* Visual Motion Indicator */}
									<div className="d-flex align-items-center gap-1">
										<span className="fs-8 text-muted">Motion:</span>
										{liveStatus.isMotion ? (
											<Badge bg="success" className="d-flex align-items-center gap-1 live-pulse-badge">
												<span className="live-pulse-dot bg-light"></span>
												Detected ({liveStatus.deltaPixels}px)
											</Badge>
										) : (
											<Badge bg="secondary" className="text-white-50">
												Settled ({liveStatus.deltaPixels ?? 0}px)
											</Badge>
										)}
									</div>

									{/* Promise Status Indicator */}
									{currentMode === 'realtime' && (
										<div className="d-flex align-items-center gap-1">
											<span className="fs-8 text-muted">Promise:</span>
											{liveStatus.promiseResolved ? (
												<Badge bg="primary" className="d-flex align-items-center gap-1">
													<FontAwesomeIcon icon={faCheck} className="fs-8" />
													Resolved {liveStatus.promiseDuration != null ? `(${liveStatus.promiseDuration}ms)` : ''}
												</Badge>
											) : (
												<Badge bg="warning" text="dark" className="d-flex align-items-center gap-1">
													<FontAwesomeIcon icon={faArrowsRotate} spin className="fs-8" />
													Pending…
												</Badge>
											)}
										</div>
									)}
								</div>
							</div>
						)}

						{/* Actions Table */}
						<div className="table-responsive mb-3 border rounded border-secondary border-opacity-25">
							<Table variant="dark" hover size="sm" className="mb-0 align-middle">
								<thead>
									<tr className="fs-8 text-muted border-bottom border-secondary">
										<th style={{ width: '44%' }}>Action</th>
										<th style={{ width: '28%' }}>Duration (ms)</th>
										<th style={{ width: '28%' }} className="text-end">
											Actions
										</th>
									</tr>
								</thead>
								<tbody>
									{items.map((item) => {
										const isMeasuring =
											detectingKey === item.key || (isDetectingAll && liveStatus?.actionKey === item.key)
										const diag = diagnostics[item.key]
										const hasNotice = Boolean(diag?.notice)
										const isEarly = Boolean(diag?.earlyPromise)

										return (
											<tr key={item.key}>
												<td>
													<div className="d-flex align-items-center gap-1">
														<span className="fw-semibold fs-7 text-truncate" title={item.label}>
															{item.label}
														</span>
														{hasNotice && (
															<OverlayTrigger
																placement="top"
																overlay={<Tooltip id={`tooltip-${item.key}`}>{diag.notice}</Tooltip>}
															>
																<span className="ms-1" style={{ cursor: 'pointer' }}>
																	<FontAwesomeIcon
																		icon={isEarly ? faTriangleExclamation : faCircleInfo}
																		className={isEarly ? 'text-warning' : 'text-info'}
																	/>
																</span>
															</OverlayTrigger>
														)}
													</div>
													<div className="fs-8 text-muted">{item.type}</div>

													{/* Live measurement status badges while analyzing this action */}
													{isMeasuring && liveStatus && (
														<div className="d-flex flex-wrap align-items-center gap-1 mt-1">
															{liveStatus.isMotion ? (
																<Badge bg="success" className="fs-9 py-0 px-1 live-pulse-badge">
																	● Motion ({liveStatus.deltaPixels}px)
																</Badge>
															) : (
																<Badge bg="secondary" className="fs-9 py-0 px-1 text-white-50">
																	○ Settled
																</Badge>
															)}
															{currentMode === 'realtime' &&
																(liveStatus.promiseResolved ? (
																	<Badge bg="primary" className="fs-9 py-0 px-1">
																		✓ Promise ({liveStatus.promiseDuration}ms)
																	</Badge>
																) : (
																	<Badge bg="warning" text="dark" className="fs-9 py-0 px-1">
																		⏳ Promise…
																	</Badge>
																))}
														</div>
													)}

													{/* Post-analysis measured result details */}
													{!isMeasuring && diag && (
														<div className="mt-1 d-flex flex-column gap-1">
															<div className="d-flex flex-wrap align-items-center gap-1">
																{diag.thumbnail && (
																	<OverlayTrigger
																		placement="right"
																		overlay={
																			<Tooltip id={`thumb-tip-${item.key}`}>
																				<img
																					src={diag.thumbnail}
																					alt="Settled thumbnail"
																					className="rounded checkered-bg"
																					style={{
																						width: '160px',
																						height: '90px',
																						objectFit: 'contain',
																						display: 'block',
																					}}
																				/>
																				<div className="fs-9 mt-1 text-center font-monospace">Settled frame</div>
																			</Tooltip>
																		}
																	>
																		<img
																			src={diag.thumbnail}
																			alt="Settled state"
																			className="rounded border border-secondary border-opacity-50 checkered-bg flex-shrink-0"
																			style={{ width: '38px', height: '21px', objectFit: 'contain', cursor: 'pointer' }}
																		/>
																	</OverlayTrigger>
																)}

																{diag.continuous ? (
																	<Badge
																		bg="warning"
																		text="dark"
																		className="fs-9 py-0 px-1 font-monospace"
																		title="Motion continued until analysis timeout"
																	>
																		Visual: Continuous
																	</Badge>
																) : diag.visualDuration > 0 ? (
																	<Badge
																		bg="success"
																		className="fs-9 py-0 px-1 font-monospace"
																		title={`Visual motion settled at ${diag.visualDuration}ms`}
																	>
																		Visual: {diag.visualDuration}ms
																	</Badge>
																) : (
																	<Badge
																		bg="secondary"
																		className="fs-9 py-0 px-1 text-white-50 font-monospace"
																		title="No visual motion detected above noise threshold"
																	>
																		Visual: 0ms
																	</Badge>
																)}

																{diag.promiseDuration != null ? (
																	<Badge
																		bg={diag.earlyPromise ? 'warning' : 'success'}
																		text={diag.earlyPromise ? 'dark' : undefined}
																		className="fs-9 py-0 px-1 font-monospace"
																		title={
																			diag.earlyPromise
																				? `The Promise returned by the action resolved early (${diag.promiseDuration}ms) before visual animation finished (${diag.visualDuration}ms)`
																				: `The Promise returned by the action resolved in ${diag.promiseDuration}ms`
																		}
																	>
																		Promise: {diag.promiseDuration}ms{diag.earlyPromise ? ' (early)' : ''}
																	</Badge>
																) : (
																	currentMode !== 'realtime' && (
																		<Badge bg="secondary" className="fs-9 py-0 px-1 text-white-50 font-monospace">
																			Non-realtime
																		</Badge>
																	)
																)}
															</div>

															{diag.notice && (
																<div
																	className={`fs-9 text-truncate ${diag.earlyPromise ? 'text-warning' : 'text-info'}`}
																	title={diag.notice}
																	style={{ maxWidth: '240px' }}
																>
																	<FontAwesomeIcon
																		icon={diag.earlyPromise ? faTriangleExclamation : faCircleInfo}
																		className="me-1"
																	/>
																	{diag.notice}
																</div>
															)}
														</div>
													)}
												</td>
												<td>
													<InputGroup size="sm">
														<Form.Control
															type="number"
															min="-1"
															step="50"
															value={item.duration}
															onChange={(e) => handleDurationChange(item.key, e.target.value)}
															className="font-monospace fs-7 text-end py-1"
															title="-1 indicates dynamic/unknown duration"
														/>
													</InputGroup>
												</td>
												<td className="text-end">
													<ButtonGroup size="sm">
														<Button
															variant="outline-info"
															className="py-0 px-2"
															onClick={() => handleMeasureSingle(item)}
															disabled={isDetectingAll || Boolean(detectingKey)}
															title="Measure this action"
														>
															{isMeasuring ? (
																<FontAwesomeIcon icon={faArrowsRotate} spin />
															) : (
																<FontAwesomeIcon icon={faRotateRight} />
															)}
														</Button>
														<Button
															variant="outline-light"
															className="py-0 px-2"
															onClick={() => handleTestAction(item)}
															disabled={isDetectingAll || Boolean(detectingKey)}
															title="Test play action"
														>
															<FontAwesomeIcon icon={faPlay} />
														</Button>
													</ButtonGroup>
												</td>
											</tr>
										)
									})}
								</tbody>
							</Table>
						</div>

						{/* Notice / Save Feedback */}
						{saveMessage && (
							<Alert variant="success" className="py-2 px-3 fs-7 mb-3 d-flex align-items-center gap-2">
								<FontAwesomeIcon icon={faCheck} />
								<span>{saveMessage}</span>
							</Alert>
						)}

						<div className="mt-2 text-muted fs-8">
							Durations are in milliseconds. Use <code>-1</code> for dynamic or unknown animations.
						</div>

						{/* Bottom Save & Reset Controls */}
						<div className="d-flex gap-2">
							<Button
								variant="success"
								size="sm"
								className="w-100 fw-semibold d-flex align-items-center justify-content-center gap-2"
								onClick={handleSaveManifest}
								disabled={!isDirty || isSaving || isDetectingAll}
							>
								<FontAwesomeIcon icon={faFloppyDisk} />
								{isSaving ? 'Saving…' : 'Save to Manifest'}
							</Button>
							{isDirty && (
								<Button
									variant="outline-secondary"
									size="sm"
									onClick={handleReset}
									disabled={isSaving || isDetectingAll}
									title="Revert to saved manifest values"
								>
									Reset
								</Button>
							)}
						</div>

						{/* Action & Detection Log Terminal */}
						<div className="action-durations-log mt-3 pt-2 border-top border-secondary border-opacity-25">
							<div className="d-flex align-items-center justify-content-between mb-2">
								<div className="d-flex align-items-center gap-2">
									<span className="fs-8 fw-bold text-light text-uppercase d-flex align-items-center gap-1">
										<FontAwesomeIcon icon={faTerminal} className="text-info fs-9" />
										Action & Detection Log
									</span>
									{logs.length > 0 && (
										<Badge bg="secondary" className="fs-9 py-0 px-1 font-monospace">
											{logs.length}
										</Badge>
									)}
								</div>
								<div className="d-flex align-items-center gap-2">
									{logs.length > 0 && (
										<Button
											variant="link"
											size="sm"
											className="p-0 text-muted fs-8 text-decoration-none"
											onClick={() => setLogs([])}
											title="Clear log entries"
										>
											Clear log
										</Button>
									)}
								</div>
							</div>

							<div
								ref={logContainerRef}
								className="action-log-terminal font-monospace p-2 rounded"
								style={{
									backgroundColor: '#101216',
									border: '1px solid rgba(255, 255, 255, 0.12)',
									maxHeight: '190px',
									overflowY: 'auto',
									fontSize: '0.72rem',
									lineHeight: '1.5',
								}}
							>
								{logs.length === 0 ? (
									<div className="text-white-50 fst-italic py-1">
										No actions logged yet. Run an action or auto-detect to view real-time log.
									</div>
								) : (
									logs.map((entry) => {
										const badge = getLogBadgeInfo(entry.type, entry.actionName)
										return (
											<div key={entry.id} className="action-log-entry d-flex align-items-start gap-1 mb-1">
												<span className="text-white-50 flex-shrink-0" style={{ fontSize: '0.67rem' }}>
													{entry.timestamp}
												</span>
												<span className={`badge py-0 px-1 flex-shrink-0 ${badge.bg}`} style={{ fontSize: '0.63rem' }}>
													{badge.label}
												</span>
												<span className="text-break flex-grow-1 text-light">{entry.message}</span>
											</div>
										)
									})
								)}
							</div>
						</div>
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}
