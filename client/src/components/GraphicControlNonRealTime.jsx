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

	const initialData = manifest.schema ? getDefaultDataFromSchema(manifest.schema) : {}
	const [data, setData] = React.useState(initialData)
	const onDataSave = (d) => {
		setData(JSON.parse(JSON.stringify(d)))
	}

	const [skipAnimation, setSkipAnimation] = React.useState(false)
	const [gotoStep, setGotoStep] = React.useState(1)
	const [deltaStep, setDeltaStep] = React.useState(1)

	const supportsNonRealTime = manifest.supportsNonRealTime
	const duration = settings.duration || 5000

	const currentPlayTime = playTimeRef?.current || 0

	if (currentPlayTime === 0 && rendererRef.current) {
		rendererRef.current.setData(data)
	}

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
			if (!params.skipAnimation) delete params.skipAnimation
			let newEvents = [
				{
					timestamp,
					action: JSON.parse(
						JSON.stringify({
							type,
							params,
						})
					),
				},
			]

			// If adding a playAction to an empty timeline schedule, also add an updateAction at time 0 with current data
			if (type === 'playAction' && schedule.length === 0) {
				const updateEvent = {
					timestamp: 0,
					action: {
						type: 'updateAction',
						params: { data: JSON.parse(JSON.stringify(data)) },
					},
				}
				newEvents = [updateEvent, ...newEvents]
			}

			const newSchedule = [...schedule, ...newEvents].sort((a, b) => a.timestamp - b.timestamp)
			setActionsSchedule(newSchedule)
		},
		[schedule, setActionsSchedule, data]
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
											issueTracker.clear()
											rendererRef.current
												.loadGraphic(settings)
												.then(async () => {
													await sendSetActionsSchedule()
													sentSetPlayTime()
												})
												.catch(issueTracker.addError)
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
									<h6>Data Schema</h6>
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
