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
	const settings = JSON.parse(JSON.stringify(settingsContext.settings))
	const onChange = settingsContext.onChange

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
				await rendererRef.current.loadGraphic(settings, newInitialData)
				await sendSetActionsSchedule()
				await sentSetPlayTime()
			} catch (err) {
				issueTracker.addError(err)
			}
		},
		[rendererRef, settings, sendSetActionsSchedule, sentSetPlayTime]
	)

	// Sync local data state and reload graphic when the initialData in schedule changes (e.g. from timeline editor or storage)
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

	const supportsNonRealTime = manifest.supportsNonRealTime
	const duration = settings.duration || 5000

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

	const updatePlayTime = React.useCallback(
		(time) => {
			time = parseInt(time, 10)
			if (Number.isNaN(time)) time = 0

			const quantizedTime = settings.quantizeFps > 0 ? time - (time % (1000 / settings.quantizeFps)) : time

			if (setPlayTime) {
				setPlayTime(quantizedTime)
			}
		},
		[settings, setPlayTime]
	)

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
				const existingIndex = newSchedule.findIndex((item) => item.timestamp === timestamp && item.action?.type === 'updateAction')
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
		<div>
			<Accordion
				defaultActiveKey={settings.viewControlAccordion}
				alwaysOpen
				onSelect={(selection) => {
					onChange({ ...settings, viewControlAccordion: selection })
				}}
			>
				<Accordion.Item eventKey="0">
					<Accordion.Header>Graphic Control (Non-Realtime)</Accordion.Header>
					<Accordion.Body>
						{supportsNonRealTime ? (
							<>
								<div className="mb-3 d-flex gap-2">
									<Button
										variant="primary"
										onClick={() => {
											const initialEv = schedule.find(
												(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
											)
											const dataToLoad = initialEv?.action?.params?.data ?? data
											reloadGraphicWithInitialData(dataToLoad)
										}}
									>
										Load Graphic
									</Button>
									<Button
										variant="outline-danger"
										onClick={() => {
											rendererRef.current.clearGraphic().catch(issueTracker.addError)
										}}
									>
										Clear Graphic
									</Button>
								</div>

								<div className="graphics-manifest-schema mb-3 border p-2 rounded bg-light">
									<h6>Initial Data</h6>
									{manifest.schema && <OGrafForm schema={manifest.schema} data={data} setData={onDataSave} />}
								</div>

								<div className="mb-3">
									<Form.Check
										type="switch"
										id="skip-animation-switch"
										label="skipAnimation flag on actions"
										onChange={(e) => setSkipAnimation(e.target.checked)}
										checked={skipAnimation}
									/>
								</div>

								<div className="mb-3 border p-2 rounded">
									<h6>Add Event at Current Playhead</h6>
									<div className="d-flex flex-wrap gap-2 mb-2">
										<ButtonGroup size="sm">
											<Button
												variant="success"
												onClick={() => {
													addToSchedule(currentPlayTime, 'updateAction', { data })
												}}
											>
												➕ Add Update
											</Button>
											<Button
												variant="primary"
												onClick={() => {
													addToSchedule(currentPlayTime, 'playAction', { skipAnimation })
												}}
											>
												➕ Add Play
											</Button>
											<Button
												variant="danger"
												onClick={() => {
													addToSchedule(currentPlayTime, 'stopAction', { skipAnimation })
												}}
											>
												➕ Add Stop
											</Button>
										</ButtonGroup>
									</div>

									<ButtonToolbar className="mb-2">
										<InputGroup size="sm" className="me-2 mb-1">
											<Form.Control
												type="number"
												placeholder="Step"
												value={gotoStep}
												onChange={(e) => setGotoStep(parseInt(e.target.value, 10) || 0)}
												style={{ width: '4em' }}
											/>
											<Button
												variant="outline-primary"
												onClick={() => {
													addToSchedule(currentPlayTime, 'playAction', { goto: gotoStep, skipAnimation })
												}}
											>
												Goto Step
											</Button>
										</InputGroup>

										<InputGroup size="sm" className="me-2 mb-1">
											<Form.Control
												type="number"
												placeholder="Step"
												value={deltaStep}
												onChange={(e) => setDeltaStep(parseInt(e.target.value, 10) || 0)}
												style={{ width: '4em' }}
											/>
											<Button
												variant="outline-primary"
												onClick={() => {
													addToSchedule(currentPlayTime, 'playAction', { delta: deltaStep, skipAnimation })
												}}
											>
												Delta Step
											</Button>
										</InputGroup>
									</ButtonToolbar>

									<div>
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
								</div>
							</>
						) : (
							<div className="alert alert-warning">This graphic does not support non-real-time rendering.</div>
						)}
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}

function GraphicsActions({ manifest, rendererRef, onAction }) {
	return (
		<>
			<div className="graphics-actions flex-wrap">
				{Object.values(manifest.customActions || {}).map((action) => {
					return <GraphicAction key={action.id} rendererRef={rendererRef} action={action} onAction={onAction} />
				})}
			</div>
			<div className="text-muted fs-7 mt-1">
				<i>Click an action button above to add it to the schedule at the playhead time.</i>
			</div>
		</>
	)
}
