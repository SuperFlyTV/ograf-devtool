import * as React from 'react'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { Button, ButtonGroup, Modal, Form, Badge, Dropdown, DropdownButton } from 'react-bootstrap'
import { OGrafForm } from '../lib/GDD/ograf-form.jsx'

export function GraphicTimeline({
	rendererRef,
	playTimeRef,
	schedule = [],
	setActionsSchedule,
	setPlayTime,
	manifest,
	onOpenExportVideo,
}) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext?.settings || {}
	const duration = settings.duration || 5000
	const fps = settings.quantizeFps > 0 ? settings.quantizeFps : 30
	const frameStepMs = 1000 / fps

	const [statusMessage, setStatusMessage] = React.useState(null)
	const [isPlaying, setIsPlaying] = React.useState(false)
	const [editingIndex, setEditingIndex] = React.useState(null)
	const [dragIndex, setDragIndex] = React.useState(null)
	const [isScrubbing, setIsScrubbing] = React.useState(false)

	const isDraggingEventRef = React.useRef(false)
	const dragStartPosRef = React.useRef({ x: 0, y: 0 })
	const timelineTrackRef = React.useRef(null)

	// Monitor graphic state from Renderer
	React.useEffect(() => {
		let active = true
		let clearTimer = null
		let lastState = ''

		const triggerNextFrame = () => {
			if (!active) return
			window.requestAnimationFrame(() => {
				if (!active) return
				triggerNextFrame()
				if (!rendererRef?.current) return
				const graphicState = rendererRef.current.graphicState

				if (graphicState !== lastState) {
					lastState = graphicState
					if (clearTimer) clearTimeout(clearTimer)

					if (graphicState === 'pre-load') {
						setStatusMessage({ text: 'Loading graphic...', variant: 'warning' })
					} else if (graphicState === 'post-load') {
						setStatusMessage({ text: 'Graphic Loaded', variant: 'success' })
						clearTimer = setTimeout(() => setStatusMessage(null), 3000)
					} else if (graphicState === 'pre-clear') {
						setStatusMessage({ text: 'Clearing graphic...', variant: 'warning' })
					} else if (graphicState === 'post-clear') {
						setStatusMessage({ text: 'Graphic Cleared', variant: 'secondary' })
						clearTimer = setTimeout(() => setStatusMessage(null), 3000)
					} else if (graphicState === 'error') {
						setStatusMessage({ text: 'Graphic Error', variant: 'danger' })
					} else {
						setStatusMessage(null)
					}
				}
			})
		}
		triggerNextFrame()
		return () => {
			active = false
			if (clearTimer) clearTimeout(clearTimer)
		}
	}, [rendererRef])

	// Playback Animation Loop in non-realtime preview
	React.useEffect(() => {
		if (!isPlaying) return
		let active = true
		let lastTime = performance.now()

		const animate = (now) => {
			if (!active) return
			const delta = now - lastTime
			lastTime = now

			let currentTime = (playTimeRef?.current || 0) + delta
			if (currentTime >= duration) {
				currentTime = duration
				setIsPlaying(false)
			}
			if (setPlayTime) setPlayTime(Math.round(currentTime))
			if (currentTime < duration) {
				requestAnimationFrame(animate)
			}
		}

		const animId = requestAnimationFrame(animate)
		return () => {
			active = false
			cancelAnimationFrame(animId)
		}
	}, [isPlaying, duration, playTimeRef, setPlayTime])

	const currentPlayTime = playTimeRef?.current || 0
	const playheadPercent = Math.min(100, Math.max(0, (currentPlayTime / duration) * 100))

	// Mouse Drag Playhead Scrubbing handler
	const updatePlayTimeFromMouse = React.useCallback(
		(clientX) => {
			if (!timelineTrackRef.current) return
			const rect = timelineTrackRef.current.getBoundingClientRect()
			const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
			let targetTime = Math.round(ratio * duration)
			if (settings.quantizeFps > 0) {
				targetTime = Math.round(targetTime / frameStepMs) * frameStepMs
			}
			if (setPlayTime) setPlayTime(targetTime)
		},
		[duration, frameStepMs, settings.quantizeFps, setPlayTime]
	)

	const handleMouseDownTrack = (e) => {
		if (dragIndex !== null) return
		setIsScrubbing(true)
		updatePlayTimeFromMouse(e.clientX)
	}

	React.useEffect(() => {
		if (!isScrubbing) return

		const handleMouseMove = (e) => {
			updatePlayTimeFromMouse(e.clientX)
		}

		const handleMouseUp = () => {
			setIsScrubbing(false)
		}

		window.addEventListener('mousemove', handleMouseMove)
		window.addEventListener('mouseup', handleMouseUp)
		return () => {
			window.removeEventListener('mousemove', handleMouseMove)
			window.removeEventListener('mouseup', handleMouseUp)
		}
	}, [isScrubbing, updatePlayTimeFromMouse])

	// Dragging Event Marker along timeline
	const handleMouseDownEvent = (index, e) => {
		e.stopPropagation()
		isDraggingEventRef.current = false
		dragStartPosRef.current = { x: e.clientX, y: e.clientY }
		setDragIndex(index)
	}

	React.useEffect(() => {
		if (dragIndex === null) return

		const handleMouseMove = (e) => {
			if (!timelineTrackRef.current) return
			if (Math.abs(e.clientX - dragStartPosRef.current.x) > 3) {
				isDraggingEventRef.current = true
			}
			const rect = timelineTrackRef.current.getBoundingClientRect()
			const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
			let targetTime = Math.round(ratio * duration)
			if (settings.quantizeFps > 0) {
				targetTime = Math.round(targetTime / frameStepMs) * frameStepMs
			}

			const updated = [...schedule]
			updated[dragIndex] = {
				...updated[dragIndex],
				timestamp: targetTime,
			}
			if (setActionsSchedule) setActionsSchedule(updated)
		}

		const handleMouseUp = () => {
			setDragIndex(null)
		}

		window.addEventListener('mousemove', handleMouseMove)
		window.addEventListener('mouseup', handleMouseUp)
		return () => {
			window.removeEventListener('mousemove', handleMouseMove)
			window.removeEventListener('mouseup', handleMouseUp)
		}
	}, [dragIndex, duration, frameStepMs, schedule, setActionsSchedule, settings.quantizeFps])

	// Event Handlers
	const handleRemoveEvent = (index, e) => {
		if (e) e.stopPropagation()
		const updated = schedule.filter((_, i) => i !== index)
		if (setActionsSchedule) setActionsSchedule(updated)
	}

	const handleAddEvent = (type, params = {}) => {
		const newEvent = {
			timestamp: currentPlayTime,
			action: { type, params },
		}
		const updated = [...schedule, newEvent].sort((a, b) => a.timestamp - b.timestamp)
		if (setActionsSchedule) setActionsSchedule(updated)
	}

	// Frame Stepping
	const handleStepFrame = (direction) => {
		let nextTime = currentPlayTime + direction * frameStepMs
		nextTime = Math.max(0, Math.min(duration, Math.round(nextTime)))
		if (setPlayTime) setPlayTime(nextTime)
	}

	// Format milliseconds to MM:SS.ms display
	const formatTime = (ms) => {
		const totalSeconds = ms / 1000
		const mins = Math.floor(totalSeconds / 60)
		const secs = Math.floor(totalSeconds % 60)
		const millis = Math.floor(ms % 1000)
		return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
	}

	// Time ruler tick marks (1 second ticks)
	const durationSec = Math.ceil(duration / 1000)
	const rulerTicks = []
	for (let i = 0; i <= durationSec; i++) {
		rulerTicks.push(i * 1000)
	}

	// Helper to calculate visual label text and estimated end percentage of an event marker badge
	const getEventLabel = React.useCallback((item) => {
		const actionType = item.action?.type || 'action'
		if (actionType === 'playAction') {
			return item.action.params?.goto
				? `Play (Step ${item.action.params.goto})`
				: item.action.params?.delta
				? `Play (Δ ${item.action.params.delta})`
				: 'Play'
		} else if (actionType === 'updateAction') {
			return 'Update'
		} else if (actionType === 'stopAction') {
			return 'Stop'
		} else if (actionType === 'customAction') {
			return `${item.action.params?.id || 'Custom'}`
		}
		return actionType
	}, [])

	const getEventEndPercent = React.useCallback(
		(item) => {
			const labelText = `${getEventLabel(item)} ${item.timestamp}ms`
			const estimatedPx = labelText.length * 7.5 + 35
			const trackWidthPx = timelineTrackRef.current?.clientWidth || 800
			const widthPercent = (estimatedPx / trackWidthPx) * 100
			const startPercent = (item.timestamp / duration) * 100
			return startPercent + widthPercent
		},
		[duration, getEventLabel]
	)

	// Group events into horizontal lanes based on exact visual label overlap
	const sortedSchedule = schedule
		.map((item, originalIndex) => ({ ...item, originalIndex }))
		.sort((a, b) => a.timestamp - b.timestamp)

	const lanes = []
	sortedSchedule.forEach((item) => {
		const itemStartPercent = (item.timestamp / duration) * 100
		let placed = false

		for (let l = 0; l < lanes.length; l++) {
			const lastItemInLane = lanes[l][lanes[l].length - 1]
			const lastItemEndPercent = getEventEndPercent(lastItemInLane)

			// If current item start time is at or after the previous item's label end (plus small margin), place in same lane
			if (itemStartPercent >= lastItemEndPercent + 0.5) {
				lanes[l].push(item)
				placed = true
				break
			}
		}

		if (!placed) {
			lanes.push([item])
		}
	})
	if (lanes.length === 0) lanes.push([])

	return (
		<div className="graphic-timeline-container mb-3">
			{/* Toolbar Header */}
			<div className="timeline-toolbar d-flex flex-wrap align-items-center justify-content-between p-2 bg-light border rounded-top">
				<div className="d-flex align-items-center gap-2">
					<ButtonGroup size="sm">
						<Button
							variant={isPlaying ? 'warning' : 'primary'}
							onClick={() => {
								if (!isPlaying && currentPlayTime >= duration) {
									if (setPlayTime) setPlayTime(0)
								}
								setIsPlaying(!isPlaying)
							}}
							title={isPlaying ? 'Pause' : 'Play Timeline Preview'}
						>
							{isPlaying ? '⏸️ Pause' : '▶️ Play'}
						</Button>
						<Button variant="outline-secondary" onClick={() => handleStepFrame(-1)} title="Step -1 Frame">
							⏪ -1 Frame
						</Button>
						<Button variant="outline-secondary" onClick={() => handleStepFrame(1)} title="Step +1 Frame">
							⏩ +1 Frame
						</Button>
					</ButtonGroup>

					<div className="time-display font-monospace fw-bold ms-2 me-2">
						{formatTime(currentPlayTime)} / {formatTime(duration)}{' '}
						<span className="text-muted fs-7">({Math.floor(currentPlayTime / frameStepMs)}f)</span>
					</div>

					{statusMessage && <Badge bg={statusMessage.variant}>{statusMessage.text}</Badge>}
				</div>

				<div className="d-flex align-items-center gap-2 mt-2 mt-sm-0">
					{onOpenExportVideo && (
						<Button variant="success" size="sm" onClick={onOpenExportVideo}>
							🎥 Export Video
						</Button>
					)}
				</div>
			</div>

			{/* Timeline Ruler & Track Box */}
			<div
				className="timeline-track-wrapper border border-top-0 rounded-bottom p-2 bg-white position-relative select-none"
				ref={timelineTrackRef}
				onMouseDown={handleMouseDownTrack}
				style={{ cursor: isScrubbing ? 'ew-resize' : 'pointer', minHeight: `${60 + lanes.length * 20}px` }}
			>
				{/* Time Ruler */}
				<div className="timeline-ruler position-relative border-bottom mb-2" style={{ height: '24px' }}>
					{rulerTicks.map((tickMs) => {
						const posPercent = (tickMs / duration) * 100
						if (posPercent > 100) return null
						return (
							<div
								key={tickMs}
								className="timeline-ruler-tick position-absolute"
								style={{ left: `${posPercent}%`, top: 0, bottom: 0 }}
							>
								<div className="tick-line border-start h-50"></div>
								<div className="tick-label text-muted" style={{ fontSize: '0.7rem', transform: 'translateX(-50%)' }}>
									{tickMs / 1000}s
								</div>
							</div>
						)
					})}
				</div>

				{/* Playhead Pin & Vertical Line */}
				<div
					className="timeline-playhead position-absolute"
					style={{
						left: `${playheadPercent}%`,
						top: 0,
						bottom: 0,
						zIndex: 10,
						pointerEvents: 'none',
					}}
				>
					<div
						className="playhead-head bg-danger position-absolute"
						style={{
							width: '12px',
							height: '14px',
							top: 0,
							left: '-6px',
							clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)',
						}}
					></div>
					<div
						className="playhead-line bg-danger position-absolute"
						style={{ width: '2px', top: '14px', bottom: 0, left: '-1px' }}
					></div>
				</div>

				{/* Compact & Slightly Overlapping Event Track Lanes */}
				<div className="timeline-lanes position-relative">
					{lanes.map((laneItems, laneIndex) => (
						<div
							key={laneIndex}
							className="timeline-lane position-relative rounded"
							style={{
								height: '24px',
								marginTop: laneIndex > 0 ? '-3px' : '0px',
								backgroundColor: 'rgba(0,0,0,0.02)',
								borderTop: '1px dashed rgba(0,0,0,0.08)',
							}}
						>
							{laneItems.map((item) => {
								const leftPercent = (item.timestamp / duration) * 100
								const actionType = item.action?.type || 'action'
								let actionLabel = actionType

								if (actionType === 'playAction') {
									actionLabel = item.action.params?.goto
										? `Play (Step ${item.action.params.goto})`
										: item.action.params?.delta
										? `Play (Δ ${item.action.params.delta})`
										: 'Play'
								} else if (actionType === 'updateAction') {
									actionLabel = 'Update'
								} else if (actionType === 'stopAction') {
									actionLabel = 'Stop'
								} else if (actionType === 'customAction') {
									actionLabel = `${item.action.params?.id || 'Custom'}`
								}

								const colorBg =
									actionType === 'playAction'
										? '#0d6efd'
										: actionType === 'updateAction'
										? '#198754'
										: actionType === 'stopAction'
										? '#dc3545'
										: '#6f42c1'

								const isDraggingThis = dragIndex === item.originalIndex

								return (
									<div
										key={item.originalIndex}
										className={`timeline-event-pin position-absolute d-flex align-items-center ${
											isDraggingThis ? 'dragging' : ''
										}`}
										style={{
											left: `${leftPercent}%`,
											top: '1px',
											zIndex: isDraggingThis ? 8 : 5,
										}}
										onMouseDown={(e) => handleMouseDownEvent(item.originalIndex, e)}
										onClick={(e) => {
											e.stopPropagation()
											if (isDraggingEventRef.current) return
											setEditingIndex(item.originalIndex)
										}}
									>
										{/* Left Drag Handle & Starting Point Needle */}
										<div
											className="event-drag-handle shadow-sm d-flex align-items-center justify-content-center px-1"
											style={{
												width: '12px',
												height: '22px',
												backgroundColor: colorBg,
												filter: 'brightness(0.85)',
												borderRadius: '2px 0 0 2px',
												cursor: isDraggingThis ? 'grabbing' : 'grab',
												flexShrink: 0,
												userSelect: 'none',
											}}
											title={`Drag to reposition event (${item.timestamp}ms)`}
										>
											<span style={{ fontSize: '0.65rem', color: '#fff', lineHeight: 1, opacity: 0.9 }}>⋮</span>
										</div>

										{/* Event Flag Badge Body Extending to the Right */}
										<div
											className="event-flag-badge shadow-sm d-flex align-items-center px-2"
											style={{
												backgroundColor: colorBg,
												color: '#fff',
												fontSize: '0.75rem',
												height: '22px',
												borderRadius: '0 8px 8px 0',
												whiteSpace: 'nowrap',
												cursor: isDraggingThis ? 'grabbing' : 'pointer',
											}}
											title={`Click to edit event details (${item.timestamp}ms)`}
										>
											<span className="fw-bold me-1">{actionLabel}</span>
											<span className="text-white-50 ms-1" style={{ fontSize: '0.65rem' }}>
												{item.timestamp}ms
											</span>
											<span
												className="btn-close btn-close-white ms-1"
												style={{ width: '0.45em', height: '0.45em', cursor: 'pointer' }}
												onMouseDown={(e) => e.stopPropagation()}
												onClick={(e) => handleRemoveEvent(item.originalIndex, e)}
												title="Remove Event"
											></span>
										</div>
									</div>
								)
							})}
						</div>
					))}
				</div>
			</div>

			{/* Edit Event Modal */}
			{editingIndex !== null && schedule[editingIndex] && (
				<EventEditModal
					show={editingIndex !== null}
					event={schedule[editingIndex]}
					duration={duration}
					manifest={manifest}
					onHide={() => setEditingIndex(null)}
					onSave={(updatedEvent) => {
						const updated = [...schedule]
						updated[editingIndex] = updatedEvent
						updated.sort((a, b) => a.timestamp - b.timestamp)
						if (setActionsSchedule) setActionsSchedule(updated)
						setEditingIndex(null)
					}}
				/>
			)}
		</div>
	)
}

function EventEditModal({ show, event, duration, manifest, onHide, onSave }) {
	const [timestamp, setTimestamp] = React.useState(event.timestamp)
	const [type, setType] = React.useState(event.action?.type || 'playAction')
	const [skipAnimation, setSkipAnimation] = React.useState(!!event.action?.params?.skipAnimation)
	const [gotoStep, setGotoStep] = React.useState(event.action?.params?.goto || '')
	const [deltaStep, setDeltaStep] = React.useState(event.action?.params?.delta || '')
	const [customId, setCustomId] = React.useState(event.action?.params?.id || '')
	const [updateData, setUpdateData] = React.useState(event.action?.params?.data || {})
	const [payloadJson, setPayloadJson] = React.useState(
		JSON.stringify(event.action?.params?.payload || event.action?.params?.data || {}, null, 2)
	)
	const [jsonError, setJsonError] = React.useState('')

	const handleFormSave = () => {
		let parsedPayload = {}
		if (type === 'customAction' || (type === 'updateAction' && !manifest?.schema)) {
			if (payloadJson.trim()) {
				try {
					parsedPayload = JSON.parse(payloadJson)
				} catch (err) {
					setJsonError('Invalid JSON format: ' + err.message)
					return
				}
			}
		}

		const params = {}
		if (skipAnimation) params.skipAnimation = true

		if (type === 'playAction') {
			if (gotoStep !== '') params.goto = Number(gotoStep)
			if (deltaStep !== '') params.delta = Number(deltaStep)
		} else if (type === 'updateAction') {
			params.data = manifest?.schema ? updateData : parsedPayload
		} else if (type === 'customAction') {
			params.id = customId
			params.payload = parsedPayload
		}

		onSave({
			timestamp: Number(timestamp),
			action: {
				type,
				params,
			},
		})
	}

	return (
		<Modal show={show} onHide={onHide} centered size={type === 'updateAction' && manifest?.schema ? 'lg' : 'md'}>
			<Modal.Header closeButton>
				<Modal.Title>✏️ Edit Timeline Event</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<Form>
					<Form.Group className="mb-3">
						<Form.Label>Timestamp (ms)</Form.Label>
						<Form.Control
							type="number"
							min={0}
							max={duration}
							value={timestamp}
							onChange={(e) => setTimestamp(e.target.value)}
						/>
					</Form.Group>

					<Form.Group className="mb-3">
						<Form.Label>Action Type</Form.Label>
						<Form.Select value={type} onChange={(e) => setType(e.target.value)}>
							<option value="playAction">playAction</option>
							<option value="updateAction">updateAction</option>
							<option value="stopAction">stopAction</option>
							<option value="customAction">customAction</option>
						</Form.Select>
					</Form.Group>

					{(type === 'playAction' || type === 'stopAction') && (
						<Form.Group className="mb-3">
							<Form.Check
								type="checkbox"
								label="Skip Animation"
								checked={skipAnimation}
								onChange={(e) => setSkipAnimation(e.target.checked)}
							/>
						</Form.Group>
					)}

					{type === 'playAction' && (
						<>
							<Form.Group className="mb-3">
								<Form.Label>Goto Step (Optional)</Form.Label>
								<Form.Control
									type="number"
									placeholder="e.g. 1"
									value={gotoStep}
									onChange={(e) => setGotoStep(e.target.value)}
								/>
							</Form.Group>

							<Form.Group className="mb-3">
								<Form.Label>Delta Step (Optional)</Form.Label>
								<Form.Control
									type="number"
									placeholder="e.g. 1 or -1"
									value={deltaStep}
									onChange={(e) => setDeltaStep(e.target.value)}
								/>
							</Form.Group>
						</>
					)}

					{type === 'customAction' && (
						<>
							<Form.Group className="mb-3">
								<Form.Label>Custom Action ID</Form.Label>
								<Form.Select value={customId} onChange={(e) => setCustomId(e.target.value)}>
									<option value="">Select Custom Action...</option>
									{manifest?.customActions &&
										Object.values(manifest.customActions).map((act) => (
											<option key={act.id} value={act.id}>
												{act.label || act.id} ({act.id})
											</option>
										))}
								</Form.Select>
							</Form.Group>

							<Form.Group className="mb-3">
								<Form.Label>Payload JSON</Form.Label>
								<Form.Control
									as="textarea"
									rows={4}
									className="font-monospace"
									value={payloadJson}
									onChange={(e) => {
										setPayloadJson(e.target.value)
										setJsonError('')
									}}
								/>
								{jsonError && <Form.Text className="text-danger">{jsonError}</Form.Text>}
							</Form.Group>
						</>
					)}

					{type === 'updateAction' && (
						<Form.Group className="mb-3">
							<Form.Label className="fw-bold">Update Data Schema</Form.Label>
							{manifest?.schema ? (
								<div className="border p-2 rounded bg-light">
									<OGrafForm schema={manifest.schema} data={updateData} setData={setUpdateData} />
								</div>
							) : (
								<>
									<Form.Control
										as="textarea"
										rows={5}
										className="font-monospace"
										value={payloadJson}
										onChange={(e) => {
											setPayloadJson(e.target.value)
											setJsonError('')
										}}
									/>
									{jsonError && <Form.Text className="text-danger">{jsonError}</Form.Text>}
								</>
							)}
						</Form.Group>
					)}
				</Form>
			</Modal.Body>
			<Modal.Footer>
				<Button variant="secondary" onClick={onHide}>
					Cancel
				</Button>
				<Button variant="primary" onClick={handleFormSave}>
					Save Changes
				</Button>
			</Modal.Footer>
		</Modal>
	)
}
