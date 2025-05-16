import * as React from 'react'
import { Button, Accordion, ButtonGroup, InputGroup, Form, ButtonToolbar } from 'react-bootstrap'
import { issueTracker } from '../renderer/IssueTracker.js'
import { GDDGUI } from '../lib/GDD/gdd-gui.jsx'
import { getDefaultDataFromSchema } from '../lib/GDD/gdd/data.js'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { GraphicAction } from './GraphicAction.jsx'

export function GraphicControlRealTime({ rendererRef, setActionsSchedule, manifest, schedule }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext.settings
	const onChange = settingsContext.onChange

	const initialData = manifest.schema ? getDefaultDataFromSchema(manifest.schema) : {}
	const [data, setData] = React.useState(initialData)
	const onDataSave = (d) => {
		setData(JSON.parse(JSON.stringify(d)))
	}

	rendererRef.current.setData(data)

	const [skipAnimation, setSkipAnimation] = React.useState(false)
	const [gotoStep, setGotoStep] = React.useState(1)
	const [deltaStep, setDeltaStep] = React.useState(1)

	const supportsRealTime = manifest.supportsRealTime
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
						{supportsRealTime ? (
							<>
								<div>
									<Button
										onClick={() => {
											issueTracker.clear()
											rendererRef.current.loadGraphic(settings).catch(issueTracker.addError)
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
								<div>
									<div className="graphics-manifest-schema">
										{manifest.schema && <GDDGUI schema={manifest.schema} data={data} setData={onDataSave} />}
									</div>
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
												issueTracker.clear()
												rendererRef.current.updateAction({ data }).catch(issueTracker.addError)
											}}
										>
											Update
										</Button>
										<Button
											onClick={() => {
												issueTracker.clear()
												rendererRef.current
													.playAction({
														skipAnimation,
													})
													.catch(issueTracker.addError)
											}}
										>
											Play
										</Button>
										<Button
											onClick={() => {
												issueTracker.clear()
												rendererRef.current
													.stopAction({
														skipAnimation,
													})
													.catch(issueTracker.addError)
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
													issueTracker.clear()
													rendererRef.current
														.playAction({
															goto: gotoStep,
															skipAnimation,
														})
														.catch(issueTracker.addError)
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
													issueTracker.clear()
													rendererRef.current
														.playAction({
															delta: deltaStep,
															skipAnimation,
														})
														.catch(issueTracker.addError)
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
										schedule={schedule}
										setActionsSchedule={setActionsSchedule}
										manifest={manifest}
									/>
								</div>
							</>
						) : (
							<div className="alert alert-warning">This graphic does not support real-time rendering.</div>
						)}
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}
function GraphicsActions({ manifest, rendererRef, schedule, setActionsSchedule }) {
	const customActionsList = Object.values(manifest.customActions || {})

	if (customActionsList.length === 0) return null

	return (
		<>
			<b>Custom Actions:</b>
			<div className="graphics-actions">
				{customActionsList.map((action) => {
					return (
						<GraphicAction
							key={action.id}
							rendererRef={rendererRef}
							action={action}
							onAction={(actionId, data, e) => {
								// Invoke action:
								rendererRef.current.customAction(actionId, data).catch(issueTracker.addError)
								if (e.shiftKey) {
									// Add action to schedule, to run at next auto-reload:

									schedule.push({
										timestamp: Date.now() - rendererRef.current.loadGraphicEndTime,
										invokeAction: {
											id: actionId,
											payload: JSON.parse(JSON.stringify(data)),
										},
									})
									setActionsSchedule(schedule)
								}
							}}
						/>
					)
				})}
			</div>
			<div>
				<i>Tip: Shift-clicking actions will make them auto-trigger after file changed or Auto-reload.</i>
			</div>
		</>
	)
}
