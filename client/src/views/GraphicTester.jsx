import * as React from 'react'
import { Table, Button, ButtonGroup, Form, Accordion, Row, Col } from 'react-bootstrap'
import { graphicResourcePath, usePromise } from '../lib/lib.js'
import { Renderer } from '../renderer/Renderer.js'
import { fileHandler } from '../FileHandler.js'
import { issueTracker } from '../renderer/IssueTracker.js'

import { GraphicSettings } from '../components/GraphicSettings.jsx'
import { GraphicIssues } from '../components/GraphicIssues.jsx'
import { GraphicControlRealTime } from '../components/GraphicControlRealTime.jsx'
import { GraphicControlNonRealTime } from '../components/GraphicControlNonRealTime.jsx'
import { GraphicCapabilities } from '../components/GraphicCapabilities.jsx'
import { GraphicTimeline } from '../components/GraphicTimeline.jsx'

import { SettingsContext, getDefaultSettings } from '../contexts/SettingsContext.js'

export function GraphicTester({ graphic, onExit }) {
	const [settings, setSettings] = React.useState(getDefaultSettings())

	const onSettingsChange = React.useCallback((newSettings) => {
		setSettings(newSettings)
		localStorage.setItem('settings', JSON.stringify(newSettings))
	}, [])

	const [graphicManifest, setGraphicManifest] = React.useState(null)

	const [errorMessage, setErrorMessage] = React.useState('')

	const previewContainerRef = React.useRef(null)
	const [scale, setScale] = React.useState(1)

	const canvasRef = React.useRef(null)
	const rendererRef = React.useRef(null)

	const updateScale = React.useCallback(() => {
		if (previewContainerRef.current) {
			console.log('settings.width', settings.width)
			const containerWidth = previewContainerRef.current.clientWidth
			const widthScale = containerWidth / settings.width

			const containerHeight = previewContainerRef.current.clientHeight
			const heightScale = containerHeight / settings.height

			setScale(heightScale < widthScale ? heightScale : widthScale)
		}
	}, [settings])

	const onError = React.useCallback((e) => {
		setErrorMessage(`${e.message || e}`)
		console.error(e)
	}, [])

	React.useLayoutEffect(() => {
		if (!rendererRef.current) {
			if (canvasRef.current) {
				rendererRef.current = new Renderer(canvasRef.current)
				rendererRef.current.setGraphic(graphic)
			}
		}
	}, [])

	React.useLayoutEffect(() => {
		updateScale()

		// Add a delayed updateScale call to ensure proper dimensions
		const timeoutId = setTimeout(() => {
			updateScale()
		}, 100)

		// Clean up timeout if component unmounts
		return () => clearTimeout(timeoutId)
	}, [updateScale])

	React.useLayoutEffect(() => {
		updateScale()
		window.addEventListener('resize', updateScale)
		return () => {
			window.removeEventListener('resize', updateScale)
		}
	}, [updateScale])

	React.useEffect(() => {
		rendererRef.current.setGraphic(graphic)
	}, [graphic])

	React.useEffect(() => {
		const listener = fileHandler.listenToFileChanges(() => {
			// on File change
			triggerReloadGraphic()
		})
		return () => {
			listener.stop()
		}
	}, [])
	const [issues, setIssues] = React.useState([])
	React.useEffect(() => {
		setIssues(issueTracker.issues)
		const listener = issueTracker.listenToChanges(() => {
			setIssues([...issueTracker.issues])
		})
		return () => {
			listener.stop()
		}
	}, [])

	const settingsRef = React.useRef(settings)
	React.useEffect(() => {
		settingsRef.current = settings
		triggerReloadGraphic()
	}, [settings])

	const [isReloading, setIsReloading] = React.useState(false)
	React.useEffect(() => {
		if (isReloading) {
			const timeout = setTimeout(() => setIsReloading(false), 100)
			return () => clearTimeout(timeout)
		}
	}, [isReloading])

	const reloadGraphic = React.useCallback(async () => {
		await rendererRef.current.clearGraphic()
		issueTracker.clear()
		await reloadGraphicManifest()
		await rendererRef.current.loadGraphic(settingsRef.current).catch(issueTracker.add)

		setIsReloading(true)
	}, [])

	const reloadGraphicManifest = React.useCallback(async () => {
		const url = graphicResourcePath(graphic.path, 'manifest.json')
		const r = await fetch(url)
		const manifest = await r.json()
		setGraphicManifest((prevValue) => {
			if (JSON.stringify(prevValue) !== JSON.stringify(manifest)) {
				return manifest
			} else return prevValue
		})
	}, [graphic.path])

	const triggerReloadGraphicRef = React.useRef({})
	const triggerReloadGraphic = React.useCallback(() => {
		const timeSinceLastCall = Date.now() - (triggerReloadGraphicRef.current.lastCall || 0)
		if (timeSinceLastCall < 10) return
		triggerReloadGraphicRef.current.lastCall = Date.now()

		if (triggerReloadGraphicRef.current.reloadInterval) clearTimeout(triggerReloadGraphicRef.current.reloadInterval)

		reloadGraphic()
			.then(async () => {
				if (settingsRef.current.realtime) {
					let i = 0
					for (const action of scheduleRef.current) {
						i++
						// If auto-reload is disabled, just execute all actions in 100ms intervals:
						const delay = triggerReloadGraphicRef.current.autoReloadEnable ? action.timestamp : i * 100

						setTimeout(() => {
							// if (!triggerReloadGraphicRef.current.activeAutoReload) return

							rendererRef.current.invokeGraphicAction(action.action.type, action.action.params).catch(issueTracker.add)
						}, delay)
					}
					if (triggerReloadGraphicRef.current.activeAutoReload) {
						triggerReloadGraphicRef.current.reloadInterval = setTimeout(() => {
							triggerReloadGraphicRef.current.reloadInterval = 0

							if (triggerReloadGraphicRef.current.activeAutoReload && triggerReloadGraphicRef.current.autoReloadEnable)
								triggerReloadGraphic()
						}, triggerReloadGraphicRef.current.duration)
					}
				} else {
					// non-realtime
					await rendererRef.current.setActionsSchedule(scheduleRef.current).catch(issueTracker.add)
					rendererRef.current.gotoTime(playTimeRef.current).catch(issueTracker.add)
				}
			})
			.catch(onError)
	}, [])

	React.useEffect(() => {
		triggerReloadGraphicRef.current.autoReloadEnable = settings.autoReloadEnable
		triggerReloadGraphicRef.current.duration = settings.duration

		if (triggerReloadGraphicRef.current.autoReloadEnable) {
			triggerReloadGraphicRef.current.activeAutoReload = true

			const initTimeout = setTimeout(() => {
				triggerReloadGraphic()
			}, 100)
			return () => {
				clearTimeout(initTimeout)
				triggerReloadGraphicRef.current.activeAutoReload = false
				if (triggerReloadGraphicRef.current.reloadInterval) clearTimeout(triggerReloadGraphicRef.current.reloadInterval)
			}
		} else {
			triggerReloadGraphicRef.current.activeAutoReload = false
		}
	}, [settings])

	const playTimeRef = React.useRef(0)
	const setPlayTime = React.useCallback((time) => {
		rendererRef.current.gotoTime(time).catch(issueTracker.add)
		playTimeRef.current = time
	}, [])
	const sentSetPlayTime = React.useCallback(async () => {
		await rendererRef.current.gotoTime(playTimeRef.current).catch(issueTracker.add)
	}, [])

	const scheduleRef = React.useRef([])
	const [schedule, setSchedule] = React.useState([])
	const setActionsSchedule = React.useCallback(
		(schedule) => {
			scheduleRef.current = JSON.parse(JSON.stringify(schedule))
			setSchedule(scheduleRef.current)
			if (settings.realtime) {
				if (!settings.autoReloadEnable) {
					triggerReloadGraphic()
				}
			} else {
				rendererRef.current.setActionsSchedule(scheduleRef.current).catch(issueTracker.add)
			}
		},
		[settings]
	)
	const sendSetActionsSchedule = React.useCallback(async () => {
		if (settings.realtime) {
			// nothing?
		} else {
			await rendererRef.current.setActionsSchedule(scheduleRef.current).catch(issueTracker.add)
		}
	}, [settings])

	// Load the graphic manifest:
	React.useEffect(() => {
		if (!graphicManifest) reloadGraphicManifest().catch(onError)
	}, [])
	console.log('isReloading', isReloading)

	return (
		<SettingsContext.Provider value={{ settings, onChange: onSettingsChange }}>
			<div className="full-wrap">
				<div className="container-md sidebar">
					<div className="graphic-tester card">
						<div className="card-body">
							<div>
								<Button onClick={onExit}>👈Go back</Button>
							</div>

							<div className="settings">
								<GraphicSettings />
							</div>
							{graphicManifest ? (
								<>
									<div className="capabilities">{<GraphicCapabilities manifest={graphicManifest} />}</div>
									<div className="control">
										{settings.realtime ? (
											<GraphicControlRealTime
												rendererRef={rendererRef}
												schedule={schedule}
												setActionsSchedule={setActionsSchedule}
												manifest={graphicManifest}
											/>
										) : (
											<GraphicControlNonRealTime
												rendererRef={rendererRef}
												schedule={schedule}
												setActionsSchedule={setActionsSchedule}
												sendSetActionsSchedule={sendSetActionsSchedule}
												sentSetPlayTime={sentSetPlayTime}
												manifest={graphicManifest}
												setPlayTime={setPlayTime}
											/>
										)}
										<div>
											{schedule.length ? (
												<Button onClick={() => setActionsSchedule([])}>Reset saved actions</Button>
											) : null}
										</div>
									</div>
									<div className="issues">
										<div className="card">
											{!isReloading ? <GraphicIssues manifest={graphicManifest} graphic={graphic} /> : null}
										</div>
									</div>
								</>
							) : (
								<div>Loading manifest...</div>
							)}
						</div>
					</div>
				</div>
				<div className="container-fluid">
					<div className="graphic-tester-render card">
						<div className="card-body">
							<div>
								<GraphicTimeline
									rendererRef={rendererRef}
									schedule={schedule}
									playTimeRef={playTimeRef}
									onRemoveScheduledAction={(index) => {
										schedule.splice(index, 1)
										setActionsSchedule([...schedule])
									}}
								/>
							</div>
							<div>
								{errorMessage && (
									<div className="alert alert-danger" role="alert">
										Error: {errorMessage}
									</div>
								)}
							</div>
							<div>
								{issues.length ? (
									<div className="alert alert-danger" role="alert">
										Graphic Errors:
										<ul>
											{issues.map((issue, index) => (
												<li key={index}>
													<pre>{issue}</pre>
												</li>
											))}
										</ul>
									</div>
								) : null}
							</div>
							<div className="reset-styles">
								<div className="graphic-canvas-wrapper">
									<div
										ref={previewContainerRef}
										style={{
											width: '100%',
											position: 'absolute',
											aspectRatio: `${settings.width}/${settings.height}`,
											overflow: 'hidden',
											transition: '0.2s all ease-out',
											height: '100%',
										}}
									>
										<div
											style={{
												transform: `scale(${scale})`,
												transformOrigin: 'top left',
												width: settings.width,
												height: settings.height,
											}}
										>
											<div
												ref={canvasRef}
												className="graphic-canvas"
												style={{
													position: 'relative',
													display: 'block',
													border: 'none',
												}}
											></div>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</SettingsContext.Provider>
	)
}
