import * as React from 'react'
import { Button, Accordion, ButtonGroup, InputGroup, Form, ButtonToolbar, Badge } from 'react-bootstrap'
import { issueTracker } from '../renderer/IssueTracker.js'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { GraphicAction } from './GraphicAction.jsx'
import { OGrafForm } from '../lib/GDD/ograf-form.jsx'
import { getDefaultDataFromSchema } from 'ograf-form'

export function GraphicControlNonRealTime({
	rendererRef,
	manifest,
	setPlayTime,
	playTimeRef,
	schedule = [],
	setActionsSchedule,
	sendSetActionsSchedule,
	sentSetPlayTime,
}) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext.settings
	const onChange = settingsContext.onChange
	const settingsRef = React.useRef(settings)
	settingsRef.current = settings

	const initialDataFromSchema = React.useMemo(() => {
		return manifest?.schema ? getDefaultDataFromSchema(manifest.schema) : {}
	}, [manifest?.schema])

	const initialEvent = schedule.find(
		(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
	)
	const [data, setData] = React.useState(initialEvent?.action?.params?.data ?? initialDataFromSchema)

	const prevInitialDataRef = React.useRef(null)

	const reloadGraphicWithInitialData = React.useCallback(
		async (newInitialData) => {
			if (!rendererRef.current) return
			issueTracker.clear()
			try {
				await rendererRef.current.clearGraphic()
				rendererRef.current.setData(newInitialData)
				await rendererRef.current.loadGraphic(settingsRef.current, newInitialData)
				await sendSetActionsSchedule()
				await sentSetPlayTime()
			} catch (err) {
				issueTracker.addError(err)
			}
		},
		[rendererRef, sendSetActionsSchedule, sentSetPlayTime]
	)

	// Sync local data state and reload graphic when the initialData in schedule changes
	React.useEffect(() => {
		const ev = schedule.find(
			(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
		)
		if (ev?.action?.params?.data) {
			const newData = ev.action.params.data
			const jsonString = JSON.stringify(newData)
			if (prevInitialDataRef.current !== jsonString) {
				setData(JSON.parse(jsonString))
				const shouldReload = prevInitialDataRef.current !== null
				prevInitialDataRef.current = jsonString
				if (shouldReload) {
					reloadGraphicWithInitialData(newData)
				}
			}
		}
	}, [schedule, reloadGraphicWithInitialData])

	// Ensure there is an initialData event at timestamp 0 on the timeline
	React.useEffect(() => {
		if (!manifest) return
		const hasInitialEvent = schedule.some(
			(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
		)
		if (!hasInitialEvent) {
			const initialDataToUse = data && Object.keys(data).length > 0 ? data : initialDataFromSchema
			const updateEvent = {
				timestamp: 0,
				action: {
					type: 'initialData',
					params: { data: JSON.parse(JSON.stringify(initialDataToUse)) },
				},
			}
			const newSchedule = [updateEvent, ...schedule].sort((a, b) => a.timestamp - b.timestamp)
			setActionsSchedule(newSchedule)
		}
	}, [manifest, schedule, setActionsSchedule, data, initialDataFromSchema])

	const onDataSave = (d) => {
		const cloned = JSON.parse(JSON.stringify(d))
		setData(cloned)
		prevInitialDataRef.current = JSON.stringify(cloned)
		if (rendererRef.current) {
			rendererRef.current.setData(cloned)
		}

		// Update or insert the initialData event at timestamp 0 in the timeline schedule
		const scheduleCopy = [...schedule]
		const existingIndex = scheduleCopy.findIndex(
			(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
		)
		if (existingIndex >= 0) {
			scheduleCopy[existingIndex] = {
				timestamp: 0,
				action: {
					type: 'initialData',
					params: {
						...scheduleCopy[existingIndex].action?.params,
						data: cloned,
					},
				},
			}
		} else {
			scheduleCopy.push({
				timestamp: 0,
				action: {
					type: 'initialData',
					params: { data: cloned },
				},
			})
			scheduleCopy.sort((a, b) => a.timestamp - b.timestamp)
		}
		setActionsSchedule(scheduleCopy)
		reloadGraphicWithInitialData(cloned)
	}

	const [skipAnimation, setSkipAnimation] = React.useState(false)
	const [gotoStep, setGotoStep] = React.useState(1)
	const [deltaStep, setDeltaStep] = React.useState(1)

	const supportsNonRealTime = manifest?.supportsNonRealTime
	const currentPlayTime = playTimeRef?.current || 0

	React.useEffect(() => {
		if (rendererRef.current) {
			const initialEv = schedule.find(
				(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
			)
			const dataToSet = initialEv?.action?.params?.data ?? data
			rendererRef.current.setData(dataToSet)
		}
	}, [data, schedule, rendererRef])

	const addToSchedule = React.useCallback(
		(timestamp, type, params) => {
			const newParams = { ...params }
			if (!newParams.skipAnimation) delete newParams.skipAnimation
			const newEvent = {
				timestamp,
				action: JSON.parse(
					JSON.stringify({
						type,
						params: newParams,
					})
				),
			}

			let newSchedule = [...schedule]
			if (type === 'updateAction') {
				const existingIndex = newSchedule.findIndex(
					(item) => item.timestamp === timestamp && item.action?.type === 'updateAction'
				)
				if (existingIndex >= 0) {
					newSchedule[existingIndex] = newEvent
				} else {
					newSchedule.push(newEvent)
				}
			} else {
				newSchedule.push(newEvent)
			}

			newSchedule.sort((a, b) => a.timestamp - b.timestamp)
			setActionsSchedule(newSchedule)
		},
		[schedule, setActionsSchedule]
	)

	return (
		<div className="graphic-control-panel">
			<Accordion
				defaultActiveKey={settings.viewControlAccordion}
				alwaysOpen
				onSelect={(selection) => {
					onChange({ ...settings, viewControlAccordion: selection })
				}}
			>
				<Accordion.Item eventKey="0">
					<Accordion.Header>Graphic Control (Non-Real-Time)</Accordion.Header>
					<Accordion.Body className="p-3">
						{supportsNonRealTime ? (
							<div className="control-sections-wrapper d-flex flex-column gap-3">
								{/* Lifecycle Controls */}
								<div className="control-section-card p-2 rounded">
									<div className="d-flex flex-wrap gap-2">
										<Button
											variant="primary"
											className="px-3 fw-semibold"
											onClick={() => {
												const initialEv = schedule.find(
													(item) =>
														item.action?.type === 'initialData' ||
														(item.timestamp === 0 && item.action?.type === 'updateAction')
												)
												const dataToLoad = initialEv?.action?.params?.data ?? data
												reloadGraphicWithInitialData(dataToLoad)
											}}
										>
											Load Graphic
										</Button>
										<Button
											variant="outline-danger"
											className="px-3"
											onClick={() => {
												rendererRef.current?.clearGraphic().catch(issueTracker.addError)
											}}
										>
											Clear Graphic
										</Button>
									</div>
								</div>

								{/* Initial Data Schema Form (t = 0 ms) */}
								{manifest.schema && (
									<div className="control-section-card rounded p-3">
										<div className="d-flex justify-content-between align-items-center mb-2">
											<div className="d-flex align-items-center gap-2">
												<h6 className="section-card-title mb-0">Initial Data</h6>
												<Badge bg="secondary" className="fs-8">
													t = 0 ms
												</Badge>
											</div>
										</div>
										<div className="graphics-manifest-schema m-0">
											<OGrafForm schema={manifest.schema} data={data} setData={onDataSave} />
										</div>
									</div>
								)}

								{/* Add Event at Current Playhead */}
								<div className="control-section-card rounded p-3">
									<div className="d-flex justify-content-between align-items-center mb-3">
										<div className="d-flex align-items-center gap-2">
											<h6 className="section-card-title mb-0">Add Event at Playhead</h6>
											<Badge bg="info" className="text-dark font-monospace fs-8">
												{currentPlayTime.toLocaleString()} ms
											</Badge>
										</div>
										<Form.Check
											type="switch"
											id="nrt-skip-animation-switch"
											label={<span className="fs-7 text-slate-300">skipAnimation</span>}
											onChange={(e) => setSkipAnimation(e.target.checked)}
											checked={skipAnimation}
											className="mb-0"
										/>
									</div>

									{/* Quick Action Event Buttons */}
									<div className="mb-3">
										<ButtonGroup className="w-100">
											<Button
												variant="success"
												className="fw-semibold"
												onClick={() => {
													addToSchedule(currentPlayTime, 'updateAction', { data })
												}}
											>
												+ Add Update
											</Button>
											<Button
												variant="primary"
												className="fw-semibold"
												onClick={() => {
													addToSchedule(currentPlayTime, 'playAction', { skipAnimation })
												}}
											>
												+ Add Play
											</Button>
											<Button
												variant="danger"
												className="fw-semibold"
												onClick={() => {
													addToSchedule(currentPlayTime, 'stopAction', { skipAnimation })
												}}
											>
												+ Add Stop
											</Button>
										</ButtonGroup>
									</div>

									{/* Step Actions */}
									<ButtonToolbar aria-label="Step events toolbar" className="d-flex gap-2">
										<InputGroup size="sm" className="flex-grow-1">
											<Form.Control
												type="number"
												placeholder="Step"
												value={gotoStep}
												onChange={(e) => setGotoStep(parseInt(e.target.value, 10) || 0)}
												style={{ maxWidth: '4.5rem' }}
											/>
											<Button
												variant="outline-primary"
												onClick={() => {
													addToSchedule(currentPlayTime, 'playAction', { goto: gotoStep, skipAnimation })
												}}
											>
												+ Goto Step
											</Button>
										</InputGroup>

										<InputGroup size="sm" className="flex-grow-1">
											<Form.Control
												type="number"
												placeholder="Delta"
												value={deltaStep}
												onChange={(e) => setDeltaStep(parseInt(e.target.value, 10) || 0)}
												style={{ maxWidth: '4.5rem' }}
											/>
											<Button
												variant="outline-primary"
												onClick={() => {
													addToSchedule(currentPlayTime, 'playAction', { delta: deltaStep, skipAnimation })
												}}
											>
												+ Delta Step
											</Button>
										</InputGroup>
									</ButtonToolbar>
								</div>

								{/* Custom Actions */}
								{manifest.customActions && Object.keys(manifest.customActions).length > 0 && (
									<div className="control-section-card rounded p-3">
										<h6 className="section-card-title mb-2">Add Custom Action at Playhead</h6>
										<GraphicsActions
											rendererRef={rendererRef}
											manifest={manifest}
											onAction={(actionId, payload) => {
												addToSchedule(currentPlayTime, 'customAction', {
													id: actionId,
													payload: payload,
												})
											}}
										/>
									</div>
								)}
							</div>
						) : (
							<div className="alert alert-warning mb-0" role="alert">
								This graphic does not support non-real-time rendering.
							</div>
						)}
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}

function GraphicsActions({ manifest, rendererRef, onAction }) {
	const customActionsList = Object.values(manifest?.customActions || {})

	if (customActionsList.length === 0) return null

	return (
		<>
			<div className="graphics-actions flex-wrap mb-2">
				{customActionsList.map((action) => {
					return <GraphicAction key={action.id} rendererRef={rendererRef} action={action} onAction={onAction} />
				})}
			</div>
			<div className="helper-tip-text fs-7">
				<i>Click an action above to add it to the timeline schedule at current playhead.</i>
			</div>
		</>
	)
}
