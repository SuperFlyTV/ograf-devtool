import * as React from 'react'
import { Button, Accordion } from 'react-bootstrap'
import { fileHandler } from '../FileHandler'
import {
	remoteHandler,
	isGithubRateLimited,
	GithubRateLimitError,
	isSamplePackUrl,
	resolveRemoteUrl,
} from '../RemoteHandler'
import { githubAuth } from '../GithubAuth'
import { RemoteLoadModal } from '../components/RemoteLoadModal'
import superFlyLogoUrl from '../assets/SuperFly.tv_Logo_2020_v02.png'
import ografLogoUrl from '../assets/ograf_logo_colour_draft.svg'
import { TopBanner } from '../components/common/TopBanner'
import { serviceWorkerHandler } from '../ServiceWorkerHandler'

export function InitialView({ onGraphicsFolder, initialRemoteUrl, initialCustomName, onClearInitialRemoteUrl }) {
	const [isDragging, setIsDragging] = React.useState(false)
	const [localFolderError, setLocalFolderError] = React.useState(null)

	// Remote loading & modal state:
	const remotePlaceholderUrl = 'https://github.com/ebu/ograf/tree/main/v1/examples'
	const [remoteUrl, setRemoteUrl] = React.useState('')
	const [customFolderName, setCustomFolderName] = React.useState('')
	const [customTitle, setCustomTitle] = React.useState('')
	const [showRemoteModal, setShowRemoteModal] = React.useState(false)
	const [modalMode, setModalMode] = React.useState('input') // 'input' | 'loading' | 'error'
	const [remoteProgress, setRemoteProgress] = React.useState(null)
	const [remoteError, setRemoteError] = React.useState(null)
	const [isRateLimited, setIsRateLimited] = React.useState(false)
	const [isSigningIn, setIsSigningIn] = React.useState(false)
	const [partialGraphics, setPartialGraphics] = React.useState(null)

	const handleFolderSelect = React.useCallback(
		async (dirHandle) => {
			try {
				fileHandler.dirHandle = dirHandle
				onGraphicsFolder({
					graphicsList: await fileHandler.listGraphics(),
					graphicsFolderName: fileHandler.dirHandle.name,
					source: 'local',
				})
			} catch (err) {
				console.error(err)
				setLocalFolderError(err.message)
			}
		},
		[onGraphicsFolder]
	)

	const loadRemoteUrl = React.useCallback(
		async (targetUrl, folderName, title) => {
			const inputUrl = (targetUrl || remoteUrl || remotePlaceholderUrl).trim()
			if (!inputUrl) return

			const isSample = isSamplePackUrl(inputUrl)
			const resolvedUrl = resolveRemoteUrl(inputUrl)
			const effectiveFolderName = isSample ? 'Bundled Sample Pack' : folderName || resolvedUrl
			const effectiveTitle = isSample ? 'Bundled Sample Pack' : title || folderName || ''

			setRemoteUrl(isSample ? 'sample-pack' : inputUrl)
			setCustomFolderName(effectiveFolderName)
			setCustomTitle(effectiveTitle)
			setRemoteError(null)
			setIsRateLimited(false)
			setPartialGraphics(null)
			setRemoteProgress(null)
			setModalMode('loading')
			setShowRemoteModal(true)

			try {
				await remoteHandler.init(resolvedUrl, setRemoteProgress)
				const graphicsList = await remoteHandler.listGraphics(setRemoteProgress)
				onGraphicsFolder({
					graphicsList,
					graphicsFolderName: effectiveFolderName,
					source: 'remote',
				})
				setShowRemoteModal(false)
			} catch (err) {
				console.error('Failed to load remote graphics:', err)
				setRemoteError(err.message)
				setIsRateLimited(isGithubRateLimited())
				if (err instanceof GithubRateLimitError && err.partialGraphics?.length > 0) {
					setPartialGraphics(err.partialGraphics)
				}
				setModalMode('error')
			}
		},
		[remoteUrl, onGraphicsFolder]
	)

	// Trigger initial restore if URL was supplied via props (e.g. ?remoteUrl= query param on initial page load)
	const initialRestoreAttemptedRef = React.useRef(false)
	React.useEffect(() => {
		if (initialRemoteUrl && !initialRestoreAttemptedRef.current) {
			initialRestoreAttemptedRef.current = true
			onClearInitialRemoteUrl?.()
			loadRemoteUrl(initialRemoteUrl, initialCustomName || initialRemoteUrl)
		}
	}, [initialRemoteUrl, initialCustomName, loadRemoteUrl, onClearInitialRemoteUrl])

	const handleOpenInputModal = React.useCallback(() => {
		setRemoteError(null)
		setCustomTitle('')
		setCustomFolderName('')
		setModalMode('input')
		setShowRemoteModal(true)
	}, [])

	const handleLoadSamplePack = React.useCallback(() => {
		loadRemoteUrl('sample-pack', 'Sample Pack', 'Sample Pack')
	}, [loadRemoteUrl])

	const handleLoadOfficialExamples = React.useCallback(() => {
		loadRemoteUrl(remotePlaceholderUrl, undefined, undefined)
	}, [loadRemoteUrl, remotePlaceholderUrl])

	const handleGithubSignIn = React.useCallback(async () => {
		setIsSigningIn(true)
		try {
			await githubAuth.signIn()
			setIsRateLimited(false)
			// Automatically retry with current URL
			await loadRemoteUrl(remoteUrl, customFolderName, customTitle)
		} catch (err) {
			console.error('GitHub sign-in error:', err)
			setRemoteError(`GitHub sign-in failed: ${err.message}`)
		} finally {
			setIsSigningIn(false)
		}
	}, [loadRemoteUrl, remoteUrl, customFolderName, customTitle])

	const handleContinuePartial = React.useCallback(() => {
		if (partialGraphics && partialGraphics.length > 0) {
			onGraphicsFolder({
				graphicsList: partialGraphics,
				graphicsFolderName: customFolderName || remoteUrl || 'Partial Graphics',
				source: 'remote',
			})
			setShowRemoteModal(false)
		}
	}, [partialGraphics, onGraphicsFolder, customFolderName, remoteUrl])

	const handleRetry = React.useCallback(() => {
		loadRemoteUrl(remoteUrl, customFolderName, customTitle)
	}, [loadRemoteUrl, remoteUrl, customFolderName, customTitle])

	const handleSwitchToInput = React.useCallback(() => {
		setModalMode('input')
	}, [])

	const handleCloseModal = React.useCallback(() => {
		setShowRemoteModal(false)
		onClearInitialRemoteUrl?.()
		if (window.location.search.includes('remoteUrl=')) {
			window.history.replaceState(null, '', window.location.pathname)
		}
	}, [onClearInitialRemoteUrl])

	const handleDragOver = React.useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragEnter = React.useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragLeave = React.useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}, [])

	const handleDrop = React.useCallback(
		async (e) => {
			e.preventDefault()
			e.stopPropagation()
			setIsDragging(false)
			setLocalFolderError(null)

			try {
				const items = e.dataTransfer.items
				if (items && items.length > 0) {
					const item = items[0]

					if (item.getAsFileSystemHandle) {
						const handle = await item.getAsFileSystemHandle()
						if (handle.kind === 'directory') {
							await handleFolderSelect(handle)
						} else {
							setLocalFolderError('Please drop a folder, not an individual file.')
						}
					} else {
						setLocalFolderError(
							'Drag and drop folders is not supported in this browser. Please use the button instead.'
						)
					}
				}
			} catch (err) {
				console.error(err)
				setLocalFolderError(err.message || 'Failed to process dropped folder')
			}
		},
		[handleFolderSelect]
	)

	return (
		<div
			className={`initial-dashboard ${isDragging ? 'dragging' : ''}`}
			onDragOver={handleDragOver}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Top SuperFly Banner */}
			<TopBanner />

			<main className="dashboard-container">
				{/* Hero Section */}
				<section className="dashboard-hero">
					<div className="hero-brand">
						<img src={ografLogoUrl} alt="OGraf Logo" className="hero-logo" />
						<div className="hero-title-group">
							<h1>OGraf DevTool</h1>
							<p className="hero-subtitle">View OGrafs, Validate OGrafs, export OGrafs to Video Files, and more!</p>
						</div>
					</div>
					<p className="hero-lead">
						A Web App for working with OGrafs - in your browser - on your local machine.
						<br />
						List all OGrafs in a local folder. Play and view them. Validate them against the official OGraf spec.
						Auto-generate and add thumbnails to them. Export them to video files!
					</p>

					{localFolderError && (
						<div className="alert alert-danger w-100 mt-3 text-start" role="alert">
							<strong>Local Folder Error: </strong> {localFolderError}
						</div>
					)}

					{!('showDirectoryPicker' in window) && (
						<div className="alert alert-warning w-100 mt-3 text-start">
							<p className="mb-1">
								<strong>Browser Compatibility Note:</strong> Local folder picking uses the modern File System Access API
								(<code>window.showDirectoryPicker</code>), which is not fully supported in this browser.
							</p>
							<p className="mb-0">
								You can still use <strong>Remote URL</strong> and <strong>Sample Pack</strong>, or switch to a{' '}
								<a
									href="https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker#browser_compatibility"
									target="_blank"
									rel="noreferrer"
								>
									Chromium-based browser (Chrome, Edge)
								</a>{' '}
								for local folder support.
							</p>
						</div>
					)}
				</section>

				{/* 3 Primary Action Cards */}
				<section className="dashboard-actions-section">
					<h2 className="section-heading">Get Started</h2>
					<div className="actions-grid">
						{/* Card 1: Local Folder */}
						<div className={`action-card local-card ${!('showDirectoryPicker' in window) ? 'disabled' : ''}`}>
							<div className="action-card-header">
								<div className="action-icon">📁</div>
								<div>
									<h3 className="action-title">Open Local Folder</h3>
									<span className="action-tagline">
										{'showDirectoryPicker' in window ? 'On your local hard drive' : 'Not supported in this browser'}
									</span>
								</div>
							</div>
							<p className="action-desc">View and edit OGrafs directly on your computers hard drive.</p>
							<div
								className="dropzone-box"
								onClick={() => {
									if (!('showDirectoryPicker' in window)) return
									setLocalFolderError(null)
									fileHandler
										.init()
										.then(async () => {
											await handleFolderSelect(fileHandler.dirHandle)
										})
										.catch((err) => {
											console.error(err)
											setLocalFolderError(err.message)
										})
								}}
							>
								<div className="dropzone-inner">
									<span className="dropzone-icon">📁</span>
									<span className="dropzone-text">
										{'showDirectoryPicker' in window ? (
											<>
												<strong>Drag & drop folder with OGrafs here</strong>
											</>
										) : (
											<strong>Directory access unavailable</strong>
										)}
									</span>
								</div>
							</div>
							<Button
								variant="primary"
								className="w-100 action-btn"
								disabled={!('showDirectoryPicker' in window)}
								onClick={() => {
									if (!('showDirectoryPicker' in window)) return
									setLocalFolderError(null)
									fileHandler
										.init()
										.then(async () => {
											await handleFolderSelect(fileHandler.dirHandle)
										})
										.catch((err) => {
											console.error(err)
											setLocalFolderError(err.message)
										})
								}}
							>
								Select Local Folder
							</Button>
						</div>

						{/* Card 2: Remote URL */}
						<div className="action-card remote-card">
							<div className="action-card-header">
								<div className="action-icon">🌐</div>
								<div>
									<h3 className="action-title">Open Remote URL</h3>
									<span className="action-tagline">Cloud repos & API endpoints</span>
								</div>
							</div>
							<p className="action-desc">View and test graphics hosted on a remote URL.</p>

							<div className="supported-urls-box">
								<div className="supported-title">Supported URL formats:</div>
								<ul className="supported-list">
									<li>
										<span className="url-badge github-badge">GitHub</span>
										<code>github.com/org/repo/tree/branch/...</code>
									</li>
									<li>
										<span className="url-badge server-badge">OGraf Server API</span>
										<code>http://host:port/api/ograf/v1</code>
									</li>
								</ul>
							</div>

							<div className="d-flex flex-column gap-2 mt-auto">
								<Button variant="outline-secondary" className="action-btn" onClick={handleOpenInputModal}>
									Enter Remote URL…
								</Button>
								<Button variant="secondary" size="sm" className="shortcut-btn" onClick={handleLoadOfficialExamples}>
									..or try github.com/ebu/ograf/v1/examples
								</Button>
							</div>
						</div>

						{/* Card 3: Sample Pack */}
						<div className="action-card sample-card">
							<div className="action-card-header">
								<div className="action-icon">🚀</div>
								<div>
									<h3 className="action-title">Open Sample Pack</h3>
									<span className="action-tagline">To get started right away</span>
								</div>
							</div>
							<p className="action-desc">No OGrafs to test? Try these!</p>

							<Button variant="success" className="w-100 action-btn mt-auto" onClick={handleLoadSamplePack}>
								Try Sample Pack
							</Button>
						</div>
					</div>
				</section>

				{/* 4 Feature Showcase Cards */}
				<section className="dashboard-features-section">
					<h2 className="section-heading">OGraf DevTool Features</h2>
					<div className="features-grid">
						<div className="feature-card">
							<div className="feature-header">
								<span className="feature-icon">👀</span>
								<h3 className="feature-title">View and Play OGrafs</h3>
							</div>
							<p className="feature-desc">
								In this tool, you can view and play both <strong>Real-Time</strong> and <strong>Non-Real-Time</strong>{' '}
								OGraf graphics.
							</p>
						</div>

						<div className="feature-card">
							<div className="feature-header">
								<span className="feature-icon">🎬</span>
								<h3 className="feature-title">Export OGrafs to Video</h3>
							</div>
							<p className="feature-desc">
								Render and export non-realtime OGrafs to video files. Many formats supported including the ones with
								transparency like <strong>WebM</strong>, <strong>Apple ProRes 4444</strong>,{' '}
								<strong>QuickTime Animation</strong>, <strong>.mkv VP9</strong> as well as <strong>PNG sequence</strong>
								.
							</p>
						</div>

						<div className="feature-card">
							<div className="feature-header">
								<span className="feature-icon">🖼️</span>
								<h3 className="feature-title">Auto-generate Thumbnails</h3>
							</div>
							<p className="feature-desc">
								Missing thumbnails for your OGrafs? No worries! This tool can{' '}
								<strong>update your OGrafs with thumbnails</strong> automatically, right in your local folder on your
								computer.
							</p>
						</div>

						<div className="feature-card">
							<div className="feature-header">
								<span className="feature-icon">⚡</span>
								<h3 className="feature-title">Spec Compliance & Validation</h3>
							</div>
							<p className="feature-desc">
								Automated checks against the official OGraf Specification, with helpful guidance to fix various common
								issues.
							</p>
						</div>
					</div>
				</section>

				{/* Troubleshooting Accordion */}
				<section className="dashboard-troubleshoot-section">
					<Accordion flush>
						<Accordion.Item eventKey="0" className="troubleshoot-accordion-item">
							<Accordion.Header>
								<span className="troubleshoot-toggle-text">Troubleshooting & Cache Reset</span>
							</Accordion.Header>
							<Accordion.Body>
								<TroubleShoot />
							</Accordion.Body>
						</Accordion.Item>
					</Accordion>
				</section>
			</main>

			{/* Footer */}
			<footer className="dashboard-footer">
				<div className="footer-content">
					<div className="footer-brand">
						<span>Developed with ❤️ by</span>
						<a href="https://SuperFly.tv" target="_blank" rel="noreferrer">
							<img src={superFlyLogoUrl} alt="SuperFly.tv" height="28" />
						</a>
						, if you find something that's not working, or want to contribute to the project, feel free to
						<a href="https://github.com/SuperFlyTV/ograf-devtool/pulls" target="_blank" rel="noreferrer">
							open an issue or Pull Request on Github.
						</a>
					</div>
				</div>
			</footer>

			{/* Unified Remote Loading / Error / GitHub Login Modal */}
			<RemoteLoadModal
				show={showRemoteModal}
				mode={modalMode}
				url={remoteUrl}
				customTitle={customTitle}
				onUrlChange={setRemoteUrl}
				progress={remoteProgress}
				error={remoteError}
				isRateLimited={isRateLimited}
				isSigningIn={isSigningIn}
				partialGraphics={partialGraphics}
				onSubmitUrl={(url) => loadRemoteUrl(url)}
				onRetry={handleRetry}
				onSignInGithub={handleGithubSignIn}
				onContinuePartial={handleContinuePartial}
				onSwitchToInput={handleSwitchToInput}
				onClose={handleCloseModal}
			/>
		</div>
	)
}

export function TroubleShoot() {
	const [message, setMessage] = React.useState('')
	return (
		<div className="troubleshoot-panel">
			<p className="mb-2">If you experience caching issues or unexpected behavior, follow these two steps:</p>
			<div className="troubleshoot-steps">
				<div className="troubleshoot-step">
					<strong>Step 1: </strong> Clear the Service Worker and cached app state.
					<div className="mt-2">
						<Button
							size="sm"
							variant="outline-warning"
							onClick={() => {
								serviceWorkerHandler.broadcastToSW.postMessage({
									type: 'unregister',
								})

								navigator.serviceWorker.getRegistrations().then(async (registrations) => {
									for (const sw of registrations) {
										await sw.unregister()
									}
									localStorage.clear()
									setMessage('Service Worker unregistered and cache cleared. Please do a hard reload now.')
								})
							}}
						>
							Clear Cached Data & Service Worker
						</Button>
					</div>
				</div>
				{message && <div className="alert alert-success mt-2 mb-2">{message}</div>}

				<div className="troubleshoot-step mt-2">
					<strong>Step 2: </strong> Perform a <strong>Hard Reload</strong> in your browser:
					<div className="text-secondary small mt-1">
						Windows / Linux: <code>Ctrl + Shift + R</code> or <code>Ctrl + F5</code>
						<br />
						macOS: <code>Cmd + Shift + R</code>
					</div>
				</div>
			</div>
		</div>
	)
}
