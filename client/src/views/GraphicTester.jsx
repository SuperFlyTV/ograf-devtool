import * as React from 'react'
import { Table, Button, ButtonGroup, Form, Accordion, Row, Col, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { Link, useNavigate, useParams } from 'react-router'
import { graphicResourcePath, usePromise } from '../lib/lib.js'
import { Renderer } from '../renderer/Renderer.js'
import { fileHandler } from '../FileHandler.js'
import { issueTracker } from '../renderer/IssueTracker.js'

import { GraphicSettings } from '../components/GraphicSettings.jsx'
import { GraphicIssues } from '../components/GraphicIssues.jsx'
import { GraphicControlRealTime } from '../components/GraphicControlRealTime.jsx'
import { GraphicControlNonRealTime } from '../components/GraphicControlNonRealTime.jsx'
import { GraphicModeSelector } from '../components/GraphicModeSelector.jsx'
import { GraphicCapabilities } from '../components/GraphicCapabilities.jsx'
import { GraphicTimeline } from '../components/GraphicTimeline.jsx'
import { VideoExportModal } from '../components/VideoExportModal.jsx'
import { SettingsContext, getDefaultSettings } from '../contexts/SettingsContext.js'
import { getDefaultDataFromSchema } from 'ograf-form'

import { TopBanner } from '../components/common/TopBanner.jsx'

import backgroundFootball from '../../assets/backgrounds/football.jpg'
import backgroundFireworks from '../../assets/backgrounds/fireworks.jpg'
import backgroundInterview from '../../assets/backgrounds/interview.jpg'

const BUNDLED_BACKGROUNDS = [
	{ src: backgroundFootball, label: 'Football' },
	{ src: backgroundFireworks, label: 'Fireworks' },
	{ src: backgroundInterview, label: 'Interview' },
]

const BACKGROUND_STORAGE_KEY = 'graphicTester.background'
function loadStoredBackground() {
	try {
		const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY)
		return raw ? JSON.parse(raw) : null
	} catch (_err) {
		return null
	}
}
function storeBackground(background) {
	try {
		if (!background || background.type === 'none') {
			localStorage.removeItem(BACKGROUND_STORAGE_KEY)
			return
		}
		// Blobs/Files aren't JSON-serializable, so only persist enough to identify the background:
		const { blob: _blob, ...storable } = background
		localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(storable))
	} catch (_err) {
		// Ignore storage errors (e.g. quota exceeded / private browsing).
	}
}

export function GraphicTester({ graphicsList, graphicsFolderName, graphicsSource, onCloseFolder }) {
	const navigate = useNavigate()
	const params = useParams()
	let graphicId = params['*']
	if (graphicId) graphicId = `/${graphicId}`

	const graphic = React.useMemo(() => {
		if (!graphicId) return null

		return graphicsList?.find((g) => g.path === graphicId)
	}, [graphicsList, graphicId])

	if (!graphic) {
		return (
			<div className="workspace-page-wrapper graphic-tester-page">
				<TopBanner
					folderName={graphicsFolderName}
					graphicsSource={graphicsSource}
					onBack={() => navigate('/')}
					backLabel="Back to list"
					breadcrumbs={[{ label: 'Graphics', to: '/' }, { label: 'Not Found' }]}
				/>
				<div className="p-4 text-center">
					<p className="text-danger">No Graphic found for path: {graphicId}</p>
					<p>
						<Link to="/">
							<Button variant="outline-light">👈 Back to list</Button>
						</Link>
					</p>
				</div>
			</div>
		)
	} else {
		return (
			<GraphicTesterInner
				graphic={graphic}
				graphicsFolderName={graphicsFolderName}
				graphicsSource={graphicsSource}
				onCloseFolder={onCloseFolder}
			/>
		)
	}
}
function GraphicTesterInner({ graphic, graphicsFolderName, graphicsSource }) {
	const navigate = useNavigate()

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
	const layoutContainerRef = React.useRef(null)

	// User-controlled sidebar width with localStorage persistence (defaults to 50% of window width)
	const SIDEBAR_WIDTH_STORAGE_KEY = 'graphicTester.sidebarWidth'
	const [sidebarWidth, setSidebarWidth] = React.useState(() => {
		try {
			const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
			const parsed = saved ? parseInt(saved, 10) : null
			if (parsed && !Number.isNaN(parsed) && parsed >= 340 && parsed <= 1600) {
				return parsed
			}
		} catch (_e) {
			// ignore
		}
		if (typeof window !== 'undefined' && window.innerWidth) {
			return Math.max(360, Math.round(window.innerWidth * 0.5))
		}
		return 600
	})

	const [isDraggingSplitter, setIsDraggingSplitter] = React.useState(false)

	const handleSplitterPointerDown = React.useCallback(
		(e) => {
			e.preventDefault()
			setIsDraggingSplitter(true)

			const startX = e.clientX
			const startWidth = sidebarWidth

			const onPointerMove = (moveEvent) => {
				const deltaX = moveEvent.clientX - startX
				const containerRect = layoutContainerRef.current?.getBoundingClientRect()
				const maxAllowed = containerRect ? containerRect.width - 380 : window.innerWidth - 450
				const newWidth = Math.max(340, Math.min(Math.round(startWidth + deltaX), Math.max(400, maxAllowed)))
				setSidebarWidth(newWidth)
			}

			const onPointerUp = (upEvent) => {
				setIsDraggingSplitter(false)
				window.removeEventListener('pointermove', onPointerMove)
				window.removeEventListener('pointerup', onPointerUp)

				const deltaX = upEvent.clientX - startX
				const containerRect = layoutContainerRef.current?.getBoundingClientRect()
				const maxAllowed = containerRect ? containerRect.width - 380 : window.innerWidth - 450
				const finalWidth = Math.max(340, Math.min(Math.round(startWidth + deltaX), Math.max(400, maxAllowed)))

				try {
					localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(finalWidth))
				} catch (_e) {
					// ignore
				}
			}

			window.addEventListener('pointermove', onPointerMove)
			window.addEventListener('pointerup', onPointerUp)
		},
		[sidebarWidth]
	)

	const updateScale = React.useCallback(() => {
		if (previewContainerRef.current) {
			const containerWidth = previewContainerRef.current.clientWidth
			const widthScale = containerWidth / (settings.width || 1920)

			const containerHeight = previewContainerRef.current.clientHeight
			const heightScale = containerHeight / (settings.height || 1080)

			const targetScale =
				heightScale > 0 && widthScale > 0 ? Math.min(widthScale, heightScale) : widthScale > 0 ? widthScale : 1
			setScale(targetScale)
		}
	}, [settings.width, settings.height])

	React.useEffect(() => {
		if (!previewContainerRef.current) return
		const observer = new ResizeObserver(() => {
			updateScale()
		})
		observer.observe(previewContainerRef.current)
		updateScale()
		return () => observer.disconnect()
	}, [updateScale])

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
	}, [graphic])

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
		if (rendererRef.current && graphic) {
			rendererRef.current.setGraphic({ ...graphic, manifest: graphicManifest || graphic.manifest })
		}
	}, [graphic, graphicManifest])

	React.useEffect(() => {
		const listener = fileHandler.listenToFileChanges(() => {
			// on File change
			triggerReloadGraphic()
		})
		return () => {
			listener.stop()
		}
	}, [])
	const [errors, setErrors] = React.useState([])
	const [warnings, setWarnings] = React.useState([])
	React.useEffect(() => {
		setErrors(issueTracker.errors)
		setWarnings(issueTracker.warnings)
		const listener = issueTracker.listenToChanges(() => {
			setErrors([...issueTracker.errors])
			setWarnings([...issueTracker.warnings])
		})
		return () => {
			listener.stop()
		}
	}, [])

	const settingsRef = React.useRef(settings)
	settingsRef.current = settings

	const [isReloading, setIsReloading] = React.useState(false)
	React.useEffect(() => {
		if (isReloading) {
			const timeout = setTimeout(() => setIsReloading(false), 100)
			return () => clearTimeout(timeout)
		}
	}, [isReloading])

	const reloadGraphicManifest = React.useCallback(async () => {
		const url = graphicResourcePath(graphic.manifestUrl || graphic.path)
		const r = await fetch(url)
		const manifest = await r.json()
		setGraphicManifest((prevValue) => {
			if (JSON.stringify(prevValue) !== JSON.stringify(manifest)) {
				return manifest
			} else return prevValue
		})
		return manifest
	}, [graphic.path, graphic.manifestUrl])

	const reloadGraphic = React.useCallback(async () => {
		await rendererRef.current.clearGraphic()
		issueTracker.clear()
		const manifest = await reloadGraphicManifest()

		if (rendererRef.current) {
			rendererRef.current.setGraphic({ ...graphic, manifest })
		}

		// Extract initialData from scheduleRef or manifest schema
		const initialEv = scheduleRef.current.find(
			(item) => item.action?.type === 'initialData' || (item.timestamp === 0 && item.action?.type === 'updateAction')
		)
		let initialData = initialEv?.action?.params?.data
		if (!initialData && manifest?.schema) {
			initialData = getDefaultDataFromSchema(manifest.schema)
		}
		if (!initialData) initialData = {}

		rendererRef.current.setData(initialData)
		await rendererRef.current.loadGraphic(settingsRef.current, initialData).catch(issueTracker.addError)

		setIsReloading(true)
	}, [graphic, reloadGraphicManifest])

	const triggerReloadGraphicRef = React.useRef({})
	const triggerReloadGraphic = React.useCallback(() => {
		const timeSinceLastCall = Date.now() - (triggerReloadGraphicRef.current.lastCall || 0)
		if (timeSinceLastCall < 10) return
		triggerReloadGraphicRef.current.lastCall = Date.now()

		if (triggerReloadGraphicRef.current.reloadInterval) clearTimeout(triggerReloadGraphicRef.current.reloadInterval)

		reloadGraphic()
			.then(async () => {
				if (settingsRef.current.realtime) {
					// let i = 0
					// const actionsToRun = scheduleRef.current.filter((item) => item.action?.type !== 'initialData')
					// for (const action of actionsToRun) {
					// 	i++
					// 	// If auto-reload is disabled, just execute all actions in 100ms intervals:
					// 	const delay = triggerReloadGraphicRef.current.autoReloadEnable ? action.timestamp : i * 100

					// 	setTimeout(() => {
					// 		const actionType = action.action?.type || (action.invokeAction ? 'customAction' : null)
					// 		const actionParams = action.action?.params || action.invokeAction || {}
					// 		if (actionType && rendererRef.current) {
					// 			rendererRef.current.invokeGraphicAction(actionType, actionParams).catch(issueTracker.addError)
					// 		}
					// 	}, delay)
					// }
					if (triggerReloadGraphicRef.current.activeAutoReload) {
						triggerReloadGraphicRef.current.reloadInterval = setTimeout(() => {
							triggerReloadGraphicRef.current.reloadInterval = 0

							if (triggerReloadGraphicRef.current.activeAutoReload && triggerReloadGraphicRef.current.autoReloadEnable)
								triggerReloadGraphic()
						}, triggerReloadGraphicRef.current.duration)
					}
				} else {
					// non-realtime
					await rendererRef.current.setActionsSchedule(scheduleRef.current).catch(issueTracker.addError)
					rendererRef.current.gotoTime(playTimeRef.current).catch(issueTracker.addError)
				}
			})
			.catch(onError)
	}, [reloadGraphic, onError])

	const isMountedRef = React.useRef(false)
	const prevReloadSettingsRef = React.useRef({
		realtime: settings.realtime,
		width: settings.width,
		height: settings.height,
		duration: settings.duration,
		quantizeFps: settings.quantizeFps,
	})

	React.useEffect(() => {
		if (!isMountedRef.current) {
			isMountedRef.current = true
			triggerReloadGraphic()
			return
		}

		const prev = prevReloadSettingsRef.current
		const changed =
			prev.realtime !== settings.realtime ||
			prev.width !== settings.width ||
			prev.height !== settings.height ||
			prev.duration !== settings.duration ||
			prev.quantizeFps !== settings.quantizeFps

		if (changed) {
			prevReloadSettingsRef.current = {
				realtime: settings.realtime,
				width: settings.width,
				height: settings.height,
				duration: settings.duration,
				quantizeFps: settings.quantizeFps,
			}
			triggerReloadGraphic()
		}
	}, [
		settings.realtime,
		settings.width,
		settings.height,
		settings.duration,
		settings.quantizeFps,
		triggerReloadGraphic,
	])

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
	}, [settings.autoReloadEnable, settings.duration, triggerReloadGraphic])

	const playTimeRef = React.useRef(0)
	const [, setPlayTimeState] = React.useState(0)
	const setPlayTime = React.useCallback(async (time) => {
		if (playTimeRef.current === time) return
		playTimeRef.current = time
		setPlayTimeState(time)
		if (rendererRef.current) {
			return rendererRef.current.gotoTime(time).catch(issueTracker.addError)
		}
	}, [])
	const sentSetPlayTime = React.useCallback(async () => {
		await rendererRef.current.gotoTime(playTimeRef.current).catch(issueTracker.addError)
	}, [])

	function getScheduleStorageKeys(graphic, graphicManifest) {
		return [
			graphic?.path ? `ograf.timeline.${graphic.path}` : null,
			graphicManifest?.id ? `ograf.timeline.${graphicManifest.id}` : null,
			graphic?.id ? `ograf.timeline.${graphic.id}` : null,
		].filter(Boolean)
	}

	function loadStoredSchedule(graphic, graphicManifest) {
		const keys = getScheduleStorageKeys(graphic, graphicManifest)
		for (const key of keys) {
			try {
				const saved = localStorage.getItem(key)
				if (saved) {
					const parsed = JSON.parse(saved)
					if (Array.isArray(parsed) && parsed.length > 0) return parsed
				}
			} catch (_err) {
				// ignore
			}
		}
		return []
	}

	const scheduleRef = React.useRef([])
	const [schedule, setSchedule] = React.useState(() => {
		const stored = loadStoredSchedule(graphic, null)
		scheduleRef.current = stored
		return stored
	})

	// Load saved timeline schedule from localStorage when graphic or manifest changes
	React.useEffect(() => {
		const stored = loadStoredSchedule(graphic, graphicManifest)
		if (stored.length > 0) {
			scheduleRef.current = stored
			setSchedule(stored)
			if (!settingsRef.current.realtime && rendererRef.current) {
				rendererRef.current.setActionsSchedule(stored).catch(issueTracker.addError)
			}
		}
	}, [graphic?.path, graphicManifest?.id])

	const setActionsSchedule = React.useCallback(
		(newSchedule) => {
			const cloned = JSON.parse(JSON.stringify(newSchedule))
			scheduleRef.current = cloned
			setSchedule(cloned)

			const keys = getScheduleStorageKeys(graphic, graphicManifest)
			for (const key of keys) {
				try {
					if (cloned.length > 0) {
						localStorage.setItem(key, JSON.stringify(cloned))
					} else {
						localStorage.removeItem(key)
					}
				} catch (err) {
					console.error('Error saving timeline schedule to localStorage:', err)
				}
			}

			if (settingsRef.current.realtime) {
				if (!settingsRef.current.autoReloadEnable) {
					triggerReloadGraphic()
				}
			} else {
				rendererRef.current?.setActionsSchedule(cloned).catch(issueTracker.addError)
			}
		},
		[graphic, graphicManifest, triggerReloadGraphic]
	)
	const sendSetActionsSchedule = React.useCallback(async () => {
		if (settingsRef.current.realtime) {
			// nothing?
		} else {
			await rendererRef.current?.setActionsSchedule(scheduleRef.current).catch(issueTracker.addError)
		}
	}, [])

	// Load the graphic manifest:
	React.useEffect(() => {
		if (!graphicManifest) reloadGraphicManifest().catch(onError)
	}, [])
	// Auto-select supported mode if the manifest only supports one
	React.useEffect(() => {
		if (!graphicManifest) return
		const supportsRealTime = Boolean(graphicManifest.supportsRealTime)
		const supportsNonRealTime = Boolean(graphicManifest.supportsNonRealTime)

		if (supportsRealTime && !supportsNonRealTime && !settings.realtime) {
			onSettingsChange({ ...settings, realtime: true })
		} else if (!supportsRealTime && supportsNonRealTime && settings.realtime) {
			onSettingsChange({ ...settings, realtime: false })
		}
	}, [graphicManifest, settings.realtime, onSettingsChange])

	const [background, setBackground] = React.useState(cacheBackground)
	const [showExportModal, setShowExportModal] = React.useState(false)

	return (
		<SettingsContext.Provider value={{ settings, onChange: onSettingsChange }}>
			<div className="workspace-page-wrapper graphic-tester-page">
				<TopBanner
					folderName={graphicsFolderName}
					graphicsSource={graphicsSource}
					onBack={() => navigate('/')}
					backLabel="Back to list"
					breadcrumbs={[
						{ label: 'Graphics', to: '/' },
						{ label: graphic?.manifest?.name || graphic?.path?.replace(/^\//, '') || 'Graphic Tester' },
					]}
				/>

				<div
					ref={layoutContainerRef}
					className={`graphic-tester-content-layout ${isDraggingSplitter ? 'is-resizing' : ''}`}
				>
					{/* Left Sidebar */}
					<div className="graphic-tester-sidebar" style={{ width: `${sidebarWidth}px`, flex: `0 0 ${sidebarWidth}px` }}>
						<div className="tester-sidebar-card">
							<div className="mode-selector-top">
								<GraphicModeSelector
									manifest={graphicManifest}
									isRealtime={settings.realtime}
									onChangeMode={(isRt) => onSettingsChange({ ...settings, realtime: isRt })}
								/>
							</div>

							<div className="settings">
								<GraphicSettings />
							</div>

							{graphicManifest ? (
								<>
									<div className="capabilities">
										<GraphicCapabilities manifest={graphicManifest} />
									</div>

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
												playTimeRef={playTimeRef}
											/>
										)}

										{!settings.realtime && schedule.length ? (
											<div>
												<Button
													variant="outline-secondary"
													size="sm"
													className="mt-2 w-100"
													onClick={() => setActionsSchedule([])}
												>
													Clear scheduled actions ({schedule.length})
												</Button>
											</div>
										) : null}
									</div>

									<div className="issues">
										{!isReloading ? (
											<div className="issues-card">
												<GraphicIssues manifest={graphicManifest} graphic={graphic} />
											</div>
										) : null}

										{errors.length ? (
											<div className="alert alert-danger mt-2" role="alert">
												Graphic Errors:
												<ul className="mb-0 ps-3">
													{errors.map((issue, index) => (
														<li key={index}>{issue}</li>
													))}
												</ul>
											</div>
										) : null}

										{warnings.length ? (
											<div className="alert alert-warning mt-2" role="alert">
												Graphic Warnings:
												<ul className="mb-0 ps-3">
													{warnings.map((issue, index) => (
														<li key={index}>{issue}</li>
													))}
												</ul>
											</div>
										) : null}
									</div>
								</>
							) : (
								<div className="text-muted p-3 text-center">Loading manifest...</div>
							)}
						</div>
					</div>

					{/* Draggable Centerline Splitter */}
					<div
						className={`graphic-tester-splitter ${isDraggingSplitter ? 'dragging' : ''}`}
						onPointerDown={handleSplitterPointerDown}
						title="Drag to resize the renderer"
					>
						<div className="splitter-handle"></div>
					</div>

					{/* Right Main Render & Canvas Area */}
					<div className="graphic-tester-main">
						<div className="tester-preview-card">
							{!settings.realtime && (
								<div className="mb-3">
									<GraphicTimeline
										rendererRef={rendererRef}
										schedule={schedule}
										setActionsSchedule={setActionsSchedule}
										playTimeRef={playTimeRef}
										setPlayTime={setPlayTime}
										manifest={graphicManifest}
										onOpenExportVideo={() => setShowExportModal(true)}
									/>
								</div>
							)}

							{errorMessage && (
								<div className="alert alert-danger" role="alert">
									Error: {errorMessage}
								</div>
							)}

							<div
								className="graphic-canvas-wrapper"
								style={{
									aspectRatio: `${settings.width || 1920} / ${settings.height || 1080}`,
								}}
							>
								<div
									ref={previewContainerRef}
									style={{
										width: '100%',
										height: '100%',
										position: 'absolute',
										top: 0,
										left: 0,
										overflow: 'hidden',
									}}
								>
									<div
										style={{
											transform: `scale(${scale})`,
											transformOrigin: 'top left',
											width: settings.width || 1920,
											height: settings.height || 1080,
										}}
									>
										<div
											ref={canvasRef}
											className={
												'graphic-canvas' + (background?.type && background.type !== 'none' ? '' : ' checkered-bg')
											}
											style={{
												position: 'relative',
												display: 'block',
												width: settings.width || 1920,
												height: settings.height || 1080,
												border: 'none',
											}}
										></div>
										{background?.type === 'color' && background.value === 'white' ? (
											<div className="background-image" style={{ backgroundColor: 'white' }}></div>
										) : background?.type === 'color' && background.value === 'black' ? (
											<div className="background-image" style={{ backgroundColor: 'black' }}></div>
										) : background?.type === 'webcam' ? (
											<WebcamBackground deviceId={background.deviceId} />
										) : background?.type === 'asset' ? (
											<img className="background-image" src={background.src} alt="background"></img>
										) : background?.type === 'local-file' && background.blob ? (
											<img
												className="background-image"
												src={URL.createObjectURL(background.blob)}
												alt="background"
											></img>
										) : null}
									</div>
								</div>
							</div>

							<div className="graphic-tester-render-options mt-3">
								<GraphicTesterOptions
									background={background}
									setBackground={(bg) => {
										cacheBackground = bg
										storeBackground(bg)
										setBackground(bg)
									}}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
			<VideoExportModal
				show={showExportModal}
				onHide={() => setShowExportModal(false)}
				rendererRef={rendererRef}
				previewContainerRef={previewContainerRef}
				graphic={graphic}
				schedule={schedule}
			/>
		</SettingsContext.Provider>
	)
}

function GraphicTesterOptions({ background, setBackground }) {
	const [changeBackground, setChangeBackground] = React.useState(false)
	return (
		<>
			<Button
				onClick={() => {
					setChangeBackground(!changeBackground)
				}}
			>
				🖼️ Change Background
			</Button>

			{changeBackground ? (
				<GraphicTesterOptionsSetBackground background={background} setBackground={setBackground} />
			) : null}
		</>
	)
}

// Just a simple way to retain the background when switching graphics, restored from localStorage on first load:
let cacheBackground = loadStoredBackground() ?? { type: 'none' }

function GraphicTesterOptionsSetBackground({ background, setBackground }) {
	const [imageList, setImageList] = React.useState([])
	const [reloading, setReloading] = React.useState(false)

	const [webcams, setWebcams] = React.useState(null)
	const [webcamError, setWebcamError] = React.useState(null)
	const [isLoadingWebcams, setIsLoadingWebcams] = React.useState(false)

	const reloadImages = React.useCallback(async () => {
		setReloading(true)
		Promise.resolve()
			.then(async () => {
				await fileHandler.discoverFiles()

				const imageFiles = []

				for (const [key, file] of Object.entries(fileHandler.files)) {
					if (
						!(
							file.handle.name.endsWith('.png') ||
							file.handle.name.endsWith('.jpg') ||
							file.handle.name.endsWith('.jpeg') ||
							file.handle.name.endsWith('.gif') ||
							file.handle.name.endsWith('.svg') ||
							file.handle.name.endsWith('.webp')
						)
					)
						continue

					const fileContent = await file.handle.getFile()

					imageFiles.push({
						key,
						file,
						fileContent,
					})
				}
				imageFiles.sort((a, b) => a.key.localeCompare(b.key))

				setImageList(imageFiles)

				setReloading(false)
			})
			.catch(console.error)
	}, [])

	// If a previously selected local-file background was restored from storage (without its blob),
	// resolve it once a matching file turns up in a freshly loaded image list:
	React.useEffect(() => {
		if (background?.type !== 'local-file' || background.blob) return
		const match = imageList.find((image) => image.key === background.key)
		if (match) setBackground({ ...background, blob: match.fileContent })
	}, [imageList, background, setBackground])

	const openWebcamPicker = React.useCallback(async () => {
		setWebcamError(null)
		setIsLoadingWebcams(true)
		try {
			// Request permission first, since device labels are otherwise blank:
			const stream = await navigator.mediaDevices.getUserMedia({ video: true })
			stream.getTracks().forEach((track) => track.stop())

			const devices = await navigator.mediaDevices.enumerateDevices()
			setWebcams(devices.filter((device) => device.kind === 'videoinput'))
		} catch (err) {
			console.error(err)
			setWebcamError(err.message || 'Failed to access any webcam')
		} finally {
			setIsLoadingWebcams(false)
		}
	}, [])

	return (
		<div>
			{
				<div className="image-list">
					<div className="thumbnail" title="Default background" onClick={() => setBackground({ type: 'none' })}>
						<div
							className="checkered-bg"
							style={{
								width: '10em',
								height: '10em',
							}}
						></div>
					</div>
					<div
						className="thumbnail"
						title="White background"
						onClick={() => setBackground({ type: 'color', value: 'white' })}
					>
						<div
							style={{
								width: '10em',
								height: '10em',
								backgroundColor: 'white',
							}}
						></div>
					</div>
					<div
						className="thumbnail"
						title="Black background"
						onClick={() => setBackground({ type: 'color', value: 'black' })}
					>
						<div
							style={{
								width: '10em',
								height: '10em',
								backgroundColor: 'black',
							}}
						></div>
					</div>

					{BUNDLED_BACKGROUNDS.map((bg) => (
						<div
							className="thumbnail"
							key={bg.src}
							title={bg.label}
							onClick={() => setBackground({ type: 'asset', src: bg.src, label: bg.label })}
						>
							<img src={bg.src}></img>
						</div>
					))}

					{imageList.map((image) => {
						return (
							<div
								className="thumbnail"
								key={image.key}
								title={image.key}
								onClick={() =>
									setBackground({ type: 'local-file', key: image.key, label: image.key, blob: image.fileContent })
								}
							>
								<img src={URL.createObjectURL(image.fileContent)}></img>
							</div>
						)
					})}
				</div>
			}
			{fileHandler.dirHandle ? (
				<>
					{imageList.length === 0 ? <div>Click to look for images in your local folder:</div> : null}

					{reloading ? (
						<Button disabled={true}>🖼️ Looking...</Button>
					) : (
						<Button onClick={reloadImages}>🖼️ Look for images</Button>
					)}
				</>
			) : (
				<OverlayTrigger overlay={<Tooltip>Only available in Local folder mode.</Tooltip>}>
					<span className="d-inline-block">
						<Button disabled style={{ pointerEvents: 'none' }}>
							🖼️ Look for images
						</Button>
					</span>
				</OverlayTrigger>
			)}{' '}
			{isLoadingWebcams ? (
				<Button disabled={true}>🎥 Looking...</Button>
			) : (
				<Button onClick={openWebcamPicker}>🎥 Use webcam</Button>
			)}
			{webcamError && (
				<div className="alert alert-danger mt-2" role="alert">
					{webcamError}
				</div>
			)}
			{webcams && (
				<div className="image-list mt-2">
					{webcams.length === 0 ? (
						<div>No webcams found.</div>
					) : (
						webcams.map((webcam, i) => (
							<div
								className="thumbnail"
								key={webcam.deviceId || i}
								title={webcam.label || `Webcam ${i + 1}`}
								onClick={() => {
									setBackground({ type: 'webcam', deviceId: webcam.deviceId, label: webcam.label })
									setWebcams(null)
								}}
							>
								<div
									style={{
										width: '10em',
										height: '10em',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										background: '#222',
										color: 'white',
										textAlign: 'center',
										padding: '0.5em',
										overflow: 'hidden',
									}}
								>
									🎥 {webcam.label || `Webcam ${i + 1}`}
								</div>
							</div>
						))
					)}
				</div>
			)}
		</div>
	)
}

// Renders a live feed from the selected webcam as the graphic's background.
function WebcamBackground({ deviceId }) {
	const videoRef = React.useRef(null)

	React.useEffect(() => {
		let stream = null
		let cancelled = false

		navigator.mediaDevices
			.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
			.then((s) => {
				if (cancelled) {
					s.getTracks().forEach((track) => track.stop())
					return
				}
				stream = s
				if (videoRef.current) videoRef.current.srcObject = s
			})
			.catch(console.error)

		return () => {
			cancelled = true
			stream?.getTracks().forEach((track) => track.stop())
		}
	}, [deviceId])

	return <video ref={videoRef} autoPlay muted playsInline className="background-image" />
}
