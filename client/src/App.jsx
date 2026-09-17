import * as React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router'
import { fileHandler } from './FileHandler'
import { remoteHandler, isGithubRateLimited, formatDiscoveryProgress } from './RemoteHandler'
import { serviceWorkerHandler } from './ServiceWorkerHandler.js'
import { setResourceSource } from './lib/lib.js'
import { InitialView, TroubleShoot } from './views/InitialView'
import { ListGraphics } from './views/ListGraphics'
import { ListGraphicsThumbnails } from './views/ListGraphicsThumbnails'
import { GraphicTester } from './views/GraphicTester.jsx'
import { ThumbnailGeneratorView } from './views/ThumbnailGeneratorView.jsx'

// Keeps a "?remoteUrl=" query param on the current route while in remote mode, so any page can be
// reloaded/shared directly (see App's "restore from ?remoteUrl=" effect).
function RemoteUrlQuerySync({ graphicsSource }) {
	const location = useLocation()
	const navigate = useNavigate()

	React.useEffect(() => {
		// Prefer baseUrl (a normalized, shareable form), but fall back to the originally entered url
		// (e.g. an OGraf server, which doesn't have a single shared resource base):
		const shareableUrl = remoteHandler.baseUrl ?? remoteHandler.url
		if (graphicsSource !== 'remote' || !shareableUrl) return

		const params = new URLSearchParams(location.search)
		if (params.get('remoteUrl') === shareableUrl) return

		params.set('remoteUrl', shareableUrl)
		navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true })
	}, [graphicsSource, location.pathname, location.search, navigate])

	return null
}

export function App() {
	//  ----------- Initialize ServiceWorker -----------
	const [serviceWorker, setServiceWorker] = React.useState(null)
	const [serviceWorkerError, setServiceWorkerError] = React.useState(null)

	// Initialize Service Worker:
	React.useEffect(() => {
		if (!serviceWorker) {
			serviceWorkerHandler
				.init(fileHandler)
				.then((sw) => {
					setServiceWorker(sw)
				})

				.catch((e) => {
					setServiceWorker(null)
					setServiceWorkerError(e)
					console.error(e)
				})
		}
	}, [serviceWorker])

	const [graphicsList, setGraphicsList] = React.useState(null)
	const [graphicsFolderName, setGraphicsFolderName] = React.useState(null)
	const [graphicsSource, setGraphicsSource] = React.useState('local') // 'local' | 'remote'
	const [restoreError, setRestoreError] = React.useState(null)
	const [restoreShowGithubSignIn, setRestoreShowGithubSignIn] = React.useState(false)
	const [restoreProgress, setRestoreProgress] = React.useState(null)

	// Let graphicResourcePath() know whether to resolve resources against the local folder or the remote base url:
	React.useEffect(() => {
		setResourceSource(graphicsSource)
	}, [graphicsSource])

	const restoreFromRemoteUrl = React.useCallback((remoteUrl) => {
		setGraphicsList(false)
		setRestoreError(null)
		setRestoreShowGithubSignIn(false)
		setRestoreProgress(null)
		return remoteHandler
			.init(remoteUrl, setRestoreProgress)
			.then(() => remoteHandler.listGraphics(setRestoreProgress))
			.then((list) => {
				setResourceSource('remote')
				setGraphicsList(list)
				setGraphicsFolderName(remoteUrl)
				setGraphicsSource('remote')
			})
			.catch((err) => {
				console.error(err)
				setRestoreError(err.message)
				setRestoreShowGithubSignIn(isGithubRateLimited())
				setGraphicsList(null)
			})
	}, [])

	// If we land directly on a route with a "?remoteUrl=" query param (e.g. a shared link to a specific Graphic),
	// automatically redo the discovery-dance against that remote url, instead of showing the InitialView:
	const attemptedRestoreRef = React.useRef(false)
	const restoreRemoteUrlRef = React.useRef(null)
	React.useEffect(() => {
		if (!serviceWorker || graphicsList || attemptedRestoreRef.current) return

		const remoteUrl = new URLSearchParams(window.location.search).get('remoteUrl')
		if (!remoteUrl) return
		attemptedRestoreRef.current = true
		restoreRemoteUrlRef.current = remoteUrl

		restoreFromRemoteUrl(remoteUrl)
	}, [serviceWorker, graphicsList, restoreFromRemoteUrl])

	const onGithubSignIn = React.useCallback(() => {
		if (restoreRemoteUrlRef.current) restoreFromRemoteUrl(restoreRemoteUrlRef.current)
	}, [restoreFromRemoteUrl])

	const onRefreshGraphics = React.useCallback(() => {
		setGraphicsList(false)
		const handler = graphicsSource === 'remote' ? remoteHandler : fileHandler
		handler.listGraphics().then(setGraphicsList).catch(console.error)
	}, [graphicsSource])
	const onCloseFolder = React.useCallback(() => {
		setGraphicsList(null)
		setGraphicsFolderName(null)
		if (graphicsSource === 'remote') remoteHandler.close()
		else fileHandler.close()
		// Drop the "?remoteUrl=" query param, so it isn't restored on a later reload:
		attemptedRestoreRef.current = false
		window.history.replaceState(null, '', window.location.pathname)
	}, [graphicsSource])

	const [initialized, setInitialized] = React.useState(false)

	// Initializing Service Worker:
	if (!serviceWorker) {
		if (!navigator.serviceWorker) {
			return (
				<div className="container">
					<div className="alert alert-danger">
						<p>Sorry, this tool uses Service Workers to function, which are not supported in your browser.</p>
						<p>Please use a browser that supports Service Workers.</p>
					</div>
				</div>
			)
		}
		return (
			<div className="container">
				{serviceWorkerError ? (
					<div className="alert alert-danger">
						<p>There was an error Initializing the web page.</p>
						<p>Error details: {serviceWorkerError.message}</p>
						<p>Please try to reload the page, it might help fixing this issue.</p>
					</div>
				) : (
					<div className="alert alert-info">
						<span>Initializing Service Worker, please wait..</span>
						<p>
							<i>If this message doesn't disappear, please reload the page.</i>
						</p>
					</div>
				)}

				<div>
					<TroubleShoot />
				</div>
			</div>
		)
	}
	// Select Graphics folder:
	if (!graphicsList) {
		return (
			<>
				{graphicsList === false ? (
					<div className="container">
						<div className="alert alert-info">
							{formatDiscoveryProgress(restoreProgress) ?? 'Loading Graphics from remote url, please wait...'}
						</div>
					</div>
				) : (
					<InitialView
						error={restoreError}
						showGithubSignIn={restoreShowGithubSignIn}
						onGithubSignIn={onGithubSignIn}
						onGraphicsFolder={({ graphicsList, graphicsFolderName, source }) => {
							setResourceSource(source ?? 'local')
							setGraphicsList(graphicsList)
							setGraphicsFolderName(graphicsFolderName)
							setGraphicsSource(source ?? 'local')
						}}
					/>
				)}
			</>
		)
	}

	return (
		<>
			<BrowserRouter>
				<RemoteUrlQuerySync graphicsSource={graphicsSource} />
				<Routes>
					<Route
						path="/"
						element={
							<ListGraphics
								graphicsList={graphicsList}
								onRefresh={onRefreshGraphics}
								graphicsFolderName={graphicsFolderName}
								graphicsSource={graphicsSource}
								onCloseFolder={onCloseFolder}
							/>
						}
					/>
					<Route
						path="/thumbnails"
						element={
							<ListGraphicsThumbnails
								graphicsList={graphicsList}
								onRefresh={onRefreshGraphics}
								graphicsFolderName={graphicsFolderName}
								graphicsSource={graphicsSource}
								onCloseFolder={onCloseFolder}
							/>
						}
					/>
					<Route
						path="/generate-thumbnails"
						element={
							graphicsSource === 'remote' ? (
								<Navigate to="/" replace />
							) : (
								<ThumbnailGeneratorView
									graphicsList={graphicsList}
									onRefresh={onRefreshGraphics}
									graphicsFolderName={graphicsFolderName}
									onCloseFolder={onCloseFolder}
								/>
							)
						}
					/>
					<Route path="/graphic/*" element={<GraphicTester graphicsList={graphicsList} />} />
				</Routes>
			</BrowserRouter>
		</>
	)
}
