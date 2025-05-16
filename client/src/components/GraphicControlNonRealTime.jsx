import * as React from 'react'
import { Button, Accordion, ButtonGroup, InputGroup, Form, ButtonToolbar } from 'react-bootstrap'
import { issueTracker } from '../renderer/IssueTracker.js'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { GraphicAction } from './GraphicAction.jsx'
import { GDDGUI } from '../lib/GDD/gdd-gui.jsx'
import { getDefaultDataFromSchema } from '../lib/GDD/gdd/data.js'

export function GraphicControlNonRealTime({
	rendererRef,
	manifest,
	setPlayTime,
	schedule,
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

	const [playTimeLocal, setPlayTimeLocal] = React.useState(0)
	const [playTimeLocalStr, setPlayTimeLocalStr] = React.useState(playTimeLocal)

	const duration = settings.duration

	if (playTimeLocal === 0) {
		rendererRef.current.setData(data)
	}

	const updatePlayTime = React.useCallback(
		(time) => {
			time = parseInt(time)
			if (Number.isNaN(time)) time = 0

			const quantizedTime = settings.quantizeFps > 0 ? time - (time % (1000 / settings.quantizeFps)) : time

			if (quantizedTime !== playTimeLocal) {
				setPlayTime(quantizedTime)
				setPlayTimeLocal(quantizedTime)
				setPlayTimeLocalStr(quantizedTime)
			}
		},
		[settings]
	)
	const addToSchedule = React.useCallback(
		(timestamp, type, params) => {
			if (!params.skipAnimation) delete params.skipAnimation
			console.log('addToSchedule', timestamp, type, params)
			const newSchedule = [
				...schedule,
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
			setActionsSchedule(newSchedule)
		},
		[schedule]
	)
	const clearSchedule = React.useCallback(() => {
		setActionsSchedule([])
	}, [schedule])

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
					<Accordion.Header>Graphic Control</Accordion.Header>
					<Accordion.Body>
						{supportsNonRealTime ? (
							<>
								<div>
									<Button
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
										onClick={() => {
											rendererRef.current.clearGraphic().catch(issueTracker.addError)
										}}
									>
										Clear Graphic
									</Button>
								</div>
								<div className="graphics-manifest-schema">
									<div>{manifest.schema && <GDDGUI schema={manifest.schema} data={data} setData={onDataSave} />}</div>
								</div>
								<div>
									<Form.Check
										type="switch"
										label="skipAnimation"
										onChange={(e) => setSkipAnimation(e.target.checked)}
										checked={skipAnimation}
									/>
								</div>
								<div>
									<ButtonGroup>
										<Button
											onClick={() => {
												addToSchedule(playTimeLocal, 'updateAction', {
													data,
												})
											}}
										>
											Update
										</Button>
										<Button
											onClick={() => {
												addToSchedule(playTimeLocal, 'playAction', { skipAnimation })
											}}
										>
											Play
										</Button>
										<Button
											onClick={() => {
												addToSchedule(playTimeLocal, 'stopAction', { skipAnimation })
											}}
										>
											Stop
										</Button>
									</ButtonGroup>
								</div>
								<div>
									<ButtonToolbar aria-label="Toolbar with button groups">
										<InputGroup className="me-2">
											<Form.Control
												type="number"
												placeholder="Step"
												value={gotoStep}
												onChange={(e) => setGotoStep(parseInt(e.target.value, 10) || 0)}
												style={{
													width: '4em',
												}}
											/>
											<Button
												onClick={() => {
													addToSchedule(playTimeLocal, 'playAction', { goto: gotoStep, skipAnimation })
												}}
											>
												Goto Step
											</Button>
										</InputGroup>

										<InputGroup className="me-2">
											<Form.Control
												type="number"
												placeholder="Step"
												value={deltaStep}
												onChange={(e) => setDeltaStep(parseInt(e.target.value, 10) || 0)}
												style={{
													width: '4em',
												}}
											/>
											<Button
												onClick={() => {
													addToSchedule(playTimeLocal, 'playAction', { delta: deltaStep, skipAnimation })
												}}
											>
												Delta Step
											</Button>
										</InputGroup>
									</ButtonToolbar>
								</div>
								<div>
									<GraphicsActions
										rendererRef={rendererRef}
										manifest={manifest}
										onAction={(actionId, payload, _event) => {
											addToSchedule(playTimeLocal, 'customAction', {
												id: actionId,
												payload: payload,
											})
										}}
									/>
								</div>
								<div>
									<Form.Group className="mb-3">
										<Form.Label>Point in Time</Form.Label>
										<Form.Range
											min={0}
											max={duration}
											value={playTimeLocal}
											onChange={(e) => {
												updatePlayTime(e.target.value)
											}}
										/>
										<Form.Control
											type="number"
											value={playTimeLocalStr}
											onChange={(e) => {
												setPlayTimeLocalStr(e.target.value)
											}}
											onBlur={(e) => {
												updatePlayTime(e.target.value)
											}}
										/>
									</Form.Group>
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
			<div className="graphics-actions">
				{Object.values(manifest.customActions || {}).map((action) => {
					return <GraphicAction key={action.id} rendererRef={rendererRef} action={action} onAction={onAction} />
				})}
			</div>
			<div>
				<i>Click on an action to add it to the schedule of invoked actions.</i>
			</div>
		</>
	)
}
