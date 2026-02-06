import * as React from 'react'
import { Table, Button } from 'react-bootstrap'
import { Link, useNavigate } from 'react-router'
import { graphicResourcePath, usePromise } from '../lib/lib.js'
import { getDefaultSettings } from '../contexts/SettingsContext.js'
import { Renderer } from '../renderer/Renderer.js'
import { fileHandler } from '../FileHandler.js'
import { getDefaultDataFromSchema } from '../lib/GDD/gdd/data.js'

export function ListGraphicsThumbnails({ graphicsList, onRefresh, onCloseFolder, graphicsFolderName }) {
	return (
		<div className="container-fluid">
			<div className="list-graphics card">
				<div>
					<h2>Local folder "{graphicsFolderName}"</h2>
					<Button
						onClick={() => {
							onRefresh()
						}}
					>
						Refresh list
					</Button>
					<Button
						onClick={() => {
							onCloseFolder()
						}}
					>
						Pick another folder
					</Button>

					<div className="float-end">
						<Link to={`/`}>
							<Button>View List</Button>
						</Link>
					</div>
				</div>

				{graphicsList.length > 0 ? (
					<div>
						{graphicsList.map((graphic, i) => (
							<GraphicsThumbnail key={i} graphic={graphic} i={i} />
						))}
					</div>
				) : (
					<div>
						<p>No graphics found in the selected folder (nor any of its subfolders).</p>
						<p>Please reload the page to try again.</p>
					</div>
				)}
			</div>
		</div>
	)
}

function GraphicsThumbnail({ graphic, i }) {
	const navigate = useNavigate()
	const [errorMessage, setErrorMessage] = React.useState('')
	const onError = React.useCallback((e) => {
		setErrorMessage(`${e.message || e}`)
		console.error(e)
	}, [])

	const [settings, setSettings] = React.useState(getDefaultSettings())
	settings.width = 1280
	settings.height = 720

	const [scale, setScale] = React.useState(1)

	const previewContainerRef = React.useRef(null)
	const canvasRef = React.useRef(null)
	const rendererRef = React.useRef(null)

	const [graphicManifest, setGraphicManifest] = React.useState(null)

	const data = React.useRef(null)

	const updateScale = React.useCallback(() => {
		if (previewContainerRef.current) {
			const containerWidth = previewContainerRef.current.clientWidth
			const widthScale = containerWidth / settings.width

			const containerHeight = previewContainerRef.current.clientHeight
			const heightScale = containerHeight / settings.height

			setScale(heightScale < widthScale ? heightScale : widthScale)
		}
	}, [settings])

	const reloadGraphicManifest = React.useCallback(async () => {
		const url = graphicResourcePath(graphic.path)
		const r = await fetch(url)
		const manifest = await r.json()
		setGraphicManifest((prevValue) => {
			if (JSON.stringify(prevValue) !== JSON.stringify(manifest)) {
				return manifest
			} else return prevValue
		})
	}, [graphic.path])

	const settingsRef = React.useRef(settings)
	React.useEffect(() => {
		settingsRef.current = settings
	}, [settings])

	// Load the graphic manifest:
	React.useEffect(() => {
		if (!graphicManifest) reloadGraphicManifest().catch(onError)
	}, [])

	React.useEffect(() => {
		if (graphicManifest && graphicManifest.schema && data.current === null) {
			data.current = getDefaultDataFromSchema(graphicManifest.schema)
		}
	}, [graphicManifest])

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

	const rendererAnimationTimeout = React.useRef(null)
	const rendererAnimationState = React.useRef()
	const rendererAnimationId = React.useRef(0)
	React.useEffect(() => {
		rendererAnimationState.current = 'initial'

		const animationId = Date.now() + Math.random()
		rendererAnimationId.current = animationId

		if (rendererAnimationTimeout.current) {
			clearTimeout(rendererAnimationTimeout.current)
			rendererAnimationTimeout.current = null
		}
		const triggerAnimation = () => {
			if (!rendererRef.current) return
			if (!data.current) return

			if (rendererAnimationId.current !== animationId) return // Stale animation

			let pauseTime = 2000
			const intervalTime = 10000
			const staggerTime = 100

			Promise.resolve()
				.then(async () => {
					await rendererRef.current.setData(data.current)
					if (rendererAnimationState.current === 'initial') {
						rendererAnimationState.current = 'animate-in'

						await rendererRef.current.loadGraphic(settingsRef.current)

						pauseTime = 0
					} else if (rendererAnimationState.current === 'animate-in') {
						rendererAnimationState.current = 'animate-out'

						await rendererRef.current.playAction({})

						let nextTime = Date.now()
						nextTime += intervalTime - ((Date.now() - i * staggerTime) % intervalTime)

						pauseTime = nextTime - Date.now()
					} else if (rendererAnimationState.current === 'animate-out') {
						rendererAnimationState.current = 'animate-in'

						await rendererRef.current.stopAction({})

						pauseTime = 500
					}
				})
				.catch(console.error)
				.finally(() => {
					if (rendererAnimationId.current !== animationId) return // Stale animation

					rendererAnimationTimeout.current = setTimeout(() => {
						triggerAnimation()
					}, pauseTime)
				})
		}

		triggerAnimation()

		return () => {
			clearTimeout(rendererAnimationTimeout.current)
			rendererAnimationTimeout.current = null
			rendererAnimationState.current = null
		}
	}, [graphic, graphicManifest, settings, i])

	return (
		<div className="card graphic-thumbnail">
			<div
				className="transparent-overlay"
				onClick={() => {
					navigate(`/graphic${graphic.path}`)
				}}
			/>
			<div className="card-img-top ">
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
								className={'graphic-canvas' + ' checkered-bg'}
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
			<div className="card-body">{graphic.manifest?.name || graphic.path}</div>
		</div>
	)
}
