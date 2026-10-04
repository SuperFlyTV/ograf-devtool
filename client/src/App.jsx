import * as React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router'
import { fileHandler } from './FileHandler'
import {
	remoteHandler,
	isSamplePackUrl,
	clearGithubApiCache,
	isGithubRateLimited,
	GithubRateLimitError,
	resolveRemoteUrl,
} from './RemoteHandler'
import { githubAuth } from './GithubAuth'
import { serviceWorkerHandler } from './ServiceWorkerHandler.js'
import { setResourceSource } from './lib/lib.js'
import { InitialView, TroubleShoot } from './views/InitialView'
import { ListGraphics } from './views/ListGraphics'
import { GraphicTester } from './views/GraphicTester.jsx'
import { RemoteLoadModal } from './components/RemoteLoadModal.jsx'

// Keeps a "?remoteUrl=" query param on the current route while in remote mode, so any page can be
// reloaded/shared directly.
function RemoteUrlQuerySync({ graphicsSource }) {
	const location = useLocation()
	const navigate = useNavigate()

	React.useEffect(() => {
		// Prefer baseUrl (a normalized, shareable form), but fall back to the originally entered url
		// (e.g. an OGraf server, which doesn't have a single shared resource base):
		const rawShareableUrl = remoteHandler.baseUrl ?? remoteHandler.url
		if (graphicsSource !== 'remote' || !rawShareableUrl) return

		const shareableUrl = isSamplePackUrl(rawShareableUrl) ? 'sample-pack' : rawShareableUrl

		const params = new URLSearchParams(location.search)
		if (params.get('remoteUrl') === shareableUrl) return

		params.set('remoteUrl', shareableUrl)
		navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true })
	}, [graphicsSource, location.pathname, location.search, navigate])

	return null
}

export function App() {
	// ----------- Initialize ServiceWorker -----------
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
	const [initialRemoteUrl, setInitialRemoteUrl] = React.useState(() => {
		return new URLSearchParams(window.location.search).get('remoteUrl')
	})

	// Remote Modal state for refreshing / re-discovery:
	const [showRemoteModal, setShowRemoteModal] = React.useState(false)
	const [modalMode, setModalMode] = React.useState('loading') // 'input' | 'loading' | 'error'
	const [remoteProgress, setRemoteProgress] = React.useState(null)
	const [remoteError, setRemoteError] = React.useState(null)
	const [isRateLimited, setIsRateLimited] = React.useState(false)
	const [isSigningIn, setIsSigningIn] = React.useState(false)
	const [partialGraphics, setPartialGraphics] = React.useState(null)
	const [modalUrl, setModalUrl] = React.useState('')
	const [modalTitle, setModalTitle] = React.useState('')

	// Let graphicResourcePath() know whether to resolve resources against the local folder or the remote base url:
	React.useEffect(() => {
		setResourceSource(graphicsSource)
	}, [graphicsSource])

	const refreshRemoteGraphics = React.useCallback(
		async (targetUrl) => {
			const rawUrl = targetUrl || remoteHandler.url || 'https://github.com/ebu/ograf/tree/main/v1/examples'
			const isSample = isSamplePackUrl(rawUrl)
			const resolvedUrl = resolveRemoteUrl(rawUrl)
			const effectiveTitle = isSample ? 'Bundled Sample Pack' : graphicsFolderName || rawUrl

			setModalUrl(isSample ? 'sample-pack' : rawUrl)
			setModalTitle(effectiveTitle)
			setRemoteProgress(null)
			setRemoteError(null)
			setIsRateLimited(false)
			setPartialGraphics(null)
			setModalMode('loading')
			setShowRemoteModal(true)

			try {
				// Clear localStorage cache for remote GitHub APIs and fetch fresh
				clearGithubApiCache()
				const list = await remoteHandler.discover(resolvedUrl, setRemoteProgress, { forceRefresh: true })
				setGraphicsList(list)
				setShowRemoteModal(false)
			} catch (err) {
				console.error('Failed to refresh remote graphics:', err)
				setRemoteError(err.message)
				setIsRateLimited(isGithubRateLimited())
				if (err instanceof GithubRateLimitError && err.partialGraphics?.length > 0) {
					setPartialGraphics(err.partialGraphics)
				}
				setModalMode('error')
			}
		},
		[graphicsFolderName]
	)

	const onRefreshGraphics = React.useCallback(async () => {
		if (graphicsSource === 'remote') {
			await refreshRemoteGraphics()
		} else {
			try {
				const list = await fileHandler.listGraphics()
				setGraphicsList(list)
			} catch (err) {
				console.error('Failed to refresh local graphics:', err)
			}
		}
	}, [graphicsSource, refreshRemoteGraphics])

	const handleSignInGithub = React.useCallback(async () => {
		setIsSigningIn(true)
		try {
			await githubAuth.signIn()
			setIsRateLimited(false)
			await refreshRemoteGraphics(modalUrl)
		} catch (err) {
			console.error('GitHub sign-in error:', err)
			setRemoteError(`GitHub sign-in failed: ${err.message}`)
		} finally {
			setIsSigningIn(false)
		}
	}, [modalUrl, refreshRemoteGraphics])

	const handleContinuePartial = React.useCallback(() => {
		if (partialGraphics && partialGraphics.length > 0) {
			setGraphicsList(partialGraphics)
			setShowRemoteModal(false)
		}
	}, [partialGraphics])

	const handleRetry = React.useCallback(() => {
		refreshRemoteGraphics(modalUrl)
	}, [modalUrl, refreshRemoteGraphics])

	const handleSwitchToInput = React.useCallback(() => {
		setModalMode('input')
	}, [])

	const handleModalSubmitUrl = React.useCallback(
		async (submittedUrl) => {
			const isSample = isSamplePackUrl(submittedUrl)
			const resolvedUrl = resolveRemoteUrl(submittedUrl)
			const effectiveFolderName = isSample ? 'Bundled Sample Pack' : resolvedUrl
			setGraphicsFolderName(effectiveFolderName)
			await refreshRemoteGraphics(submittedUrl)
		},
		[refreshRemoteGraphics]
	)

	const handleCloseModal = React.useCallback(() => {
		setShowRemoteModal(false)
	}, [])

	const onCloseFolder = React.useCallback(() => {
		setInitialRemoteUrl(null)
		setGraphicsList(null)
		setGraphicsFolderName(null)
		if (graphicsSource === 'remote') remoteHandler.close()
		else fileHandler.close()
		// Drop the "?remoteUrl=" query param, so it isn't restored:
		window.history.replaceState(null, '', window.location.pathname)
	}, [graphicsSource])

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

	// Select Graphics folder / Landing:
	if (!graphicsList) {
		return (
			<InitialView
				initialRemoteUrl={initialRemoteUrl}
				onClearInitialRemoteUrl={() => setInitialRemoteUrl(null)}
				onGraphicsFolder={({ graphicsList, graphicsFolderName, source }) => {
					setInitialRemoteUrl(null)
					setResourceSource(source ?? 'local')
					setGraphicsList(graphicsList)
					setGraphicsFolderName(graphicsFolderName)
					setGraphicsSource(source ?? 'local')
				}}
			/>
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
					<Route path="/thumbnails" element={<Navigate to="/" replace />} />
					<Route path="/generate-thumbnails" element={<Navigate to="/?generator=true" replace />} />
					<Route
						path="/graphic/*"
						element={
							<GraphicTester
								graphicsList={graphicsList}
								graphicsFolderName={graphicsFolderName}
								graphicsSource={graphicsSource}
								onCloseFolder={onCloseFolder}
							/>
						}
					/>
				</Routes>
			</BrowserRouter>

			{/* Remote Loading / Error / GitHub Login Modal (used on Refresh / in-app remote actions) */}
			<RemoteLoadModal
				show={showRemoteModal}
				mode={modalMode}
				url={modalUrl}
				customTitle={modalTitle}
				onUrlChange={setModalUrl}
				progress={remoteProgress}
				error={remoteError}
				isRateLimited={isRateLimited}
				isSigningIn={isSigningIn}
				partialGraphics={partialGraphics}
				onSubmitUrl={handleModalSubmitUrl}
				onRetry={handleRetry}
				onSignInGithub={handleSignInGithub}
				onContinuePartial={handleContinuePartial}
				onSwitchToInput={handleSwitchToInput}
				onClose={handleCloseModal}
			/>
		</>
	)
}
