import * as React from 'react'
import { Modal, Button, Form, ProgressBar, Alert, Spinner, Badge } from 'react-bootstrap'
import { formatDiscoveryProgress, isSamplePackUrl } from '../RemoteHandler'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
	faHourglassHalf,
	faTriangleExclamation,
	faGlobe,
	faCircleXmark,
	faLock,
	faPen,
	faRotateRight,
} from '@fortawesome/free-solid-svg-icons'

export function getRemoteUrlType(url) {
	if (!url) return { type: 'generic', label: 'Remote URL', variant: 'secondary' }
	if (isSamplePackUrl(url)) return { type: 'sample', label: 'Sample Pack', variant: 'success' }
	if (url.includes('github.com') || url.includes('api.github.com'))
		return { type: 'github', label: 'GitHub', variant: 'dark' }
	if (url.endsWith('.ograf.json')) return { type: 'manifest', label: 'Manifest (.ograf.json)', variant: 'primary' }
	if (url.includes('/api/ograf') || url.includes(':8080'))
		return { type: 'ograf-server', label: 'OGraf Server', variant: 'info' }
	return { type: 'generic', label: 'Remote URL', variant: 'secondary' }
}

export function RemoteLoadModal({
	show,
	mode = 'input', // 'input' | 'loading' | 'error'
	url,
	customTitle,
	onUrlChange,
	progress,
	error,
	isRateLimited,
	isSigningIn,
	partialGraphics,
	onSubmitUrl,
	onRetry,
	onSignInGithub,
	onContinuePartial,
	onSwitchToInput,
	onClose,
}) {
	const defaultPlaceholder = 'https://github.com/ebu/ograf/tree/main/v1/examples'
	const currentUrl = url ?? ''
	const urlMeta = getRemoteUrlType(currentUrl || defaultPlaceholder)

	const handleSubmit = (e) => {
		if (e) e.preventDefault()
		const targetUrl = currentUrl.trim() || defaultPlaceholder
		onSubmitUrl?.(targetUrl)
	}

	const renderHeaderTitle = () => {
		if (mode === 'loading') {
			return customTitle ? `Loading: ${customTitle}` : 'Loading Remote Graphics'
		}
		if (mode === 'error') {
			return 'Failed to Load Remote Graphics'
		}
		return 'Open Remote Graphics URL'
	}

	const renderHeaderIcon = () => {
		if (mode === 'loading') return <FontAwesomeIcon icon={faHourglassHalf} className="me-2 text-muted" />
		if (mode === 'error') return <FontAwesomeIcon icon={faTriangleExclamation} className="me-2 text-warning" />
		return <FontAwesomeIcon icon={faGlobe} className="me-2 text-muted" />
	}

	// Calculate percentage for progress bar
	let progressPercent = 0
	let isIndeterminate = false
	if (progress && progress.total > 0) {
		progressPercent = Math.min(100, Math.round((progress.processed / progress.total) * 100))
	} else {
		isIndeterminate = true
		progressPercent = 100
	}

	const progressText = formatDiscoveryProgress(progress) || 'Connecting to remote server and discovering graphics…'

	return (
		<Modal
			show={show}
			onHide={() => {
				if (!isSigningIn) onClose?.()
			}}
			centered
			backdrop={mode === 'loading' || isSigningIn ? 'static' : true}
			className="remote-load-modal"
		>
			<Modal.Header closeButton={!isSigningIn} className="remote-modal-header">
				<Modal.Title className="d-flex align-items-center gap-2 fs-5">
					<span>{renderHeaderIcon()}</span>
					<span>{renderHeaderTitle()}</span>
				</Modal.Title>
			</Modal.Header>

			<Modal.Body className="remote-modal-body">
				{/* ========================================================================= */}
				{/* MODE: INPUT */}
				{/* ========================================================================= */}
				{mode === 'input' && (
					<Form onSubmit={handleSubmit}>
						<p className="text-secondary small mb-3">
							Enter a URL pointing to a GitHub repository/folder, an OGraf API server endpoint, or a direct{' '}
							<code>*.ograf.json</code> manifest file.
						</p>

						<Form.Group className="mb-3">
							<Form.Label className="fw-bold small d-flex justify-content-between">
								<span>Remote URL</span>
								{currentUrl && (
									<Badge bg={urlMeta.variant} className="text-uppercase" style={{ fontSize: '0.7rem' }}>
										{urlMeta.label}
									</Badge>
								)}
							</Form.Label>
							<Form.Control
								type="text"
								placeholder={defaultPlaceholder}
								value={currentUrl}
								onChange={(e) => onUrlChange?.(e.target.value)}
								autoFocus
								className="font-monospace text-sm"
							/>
						</Form.Group>

						<div className="remote-hints small p-3 rounded border mb-3">
							<div className="fw-bold mb-2">Supported URL formats:</div>
							<div className="d-flex flex-column gap-2">
								<div
									className="d-flex align-items-center justify-content-between p-1 rounded hover-bg-light cursor-pointer"
									onClick={() => onUrlChange?.(defaultPlaceholder)}
									title="Click to use this URL"
									style={{ cursor: 'pointer' }}
								>
									<div className="d-flex align-items-center gap-2 overflow-hidden">
										<Badge bg="dark" className="border border-secondary">
											GitHub
										</Badge>
										<code className="text-truncate text-secondary">github.com/ebu/ograf/tree/main/v1/examples</code>
									</div>
									<span className="badge bg-secondary bg-opacity-25 text-body ms-2" style={{ fontSize: '0.68rem' }}>
										Use
									</span>
								</div>
								<div
									className="d-flex align-items-center justify-content-between p-1 rounded hover-bg-light cursor-pointer"
									onClick={() => onUrlChange?.('sample-pack')}
									title="Click to use this URL"
									style={{ cursor: 'pointer' }}
								>
									<div className="d-flex align-items-center gap-2 overflow-hidden">
										<Badge bg="success">Samples</Badge>
										<code className="text-truncate text-secondary">sample-pack</code>
									</div>
									<span className="badge bg-secondary bg-opacity-25 text-body ms-2" style={{ fontSize: '0.68rem' }}>
										Use
									</span>
								</div>
								<div
									className="d-flex align-items-center justify-content-between p-1 rounded hover-bg-light cursor-pointer"
									onClick={() => onUrlChange?.('http://localhost:8080/api/ograf/v1')}
									title="Click to use this URL"
									style={{ cursor: 'pointer' }}
								>
									<div className="d-flex align-items-center gap-2 overflow-hidden">
										<Badge bg="info">OGraf API</Badge>
										<code className="text-truncate text-secondary">http://localhost:8080/api/ograf/v1</code>
									</div>
									<span className="badge bg-secondary bg-opacity-25 text-body ms-2" style={{ fontSize: '0.68rem' }}>
										Use
									</span>
								</div>
							</div>
						</div>
					</Form>
				)}

				{/* ========================================================================= */}
				{/* MODE: LOADING */}
				{/* ========================================================================= */}
				{mode === 'loading' && (
					<div className="remote-loading-view py-2">
						{/* Target URL banner */}
						<div className="remote-target-banner p-2 px-3 rounded border mb-4">
							<div className="d-flex align-items-center justify-content-between mb-1">
								<span
									className="text-secondary small fw-semibold text-uppercase"
									style={{ fontSize: '0.72rem', letterSpacing: '0.05em' }}
								>
									Loading from
								</span>
								<Badge bg={urlMeta.variant} style={{ fontSize: '0.7rem' }}>
									{urlMeta.label}
								</Badge>
							</div>
							<div className="font-monospace small text-break fw-semibold">
								{customTitle && customTitle !== currentUrl ? (
									<div>
										<span>{customTitle}</span>
										<div className="text-secondary small font-monospace mt-1" style={{ fontSize: '0.75rem' }}>
											{currentUrl}
										</div>
									</div>
								) : (
									currentUrl || defaultPlaceholder
								)}
							</div>
						</div>

						{/* Animated spinner & progress display */}
						<div className="text-center my-4">
							<div className="mb-3 position-relative d-inline-block">
								<Spinner
									animation="border"
									variant="primary"
									style={{ width: '3rem', height: '3rem', borderWidth: '0.25rem' }}
								/>
							</div>
							<div className="fw-semibold mb-1 fs-6">{progressText}</div>
							<div className="text-secondary small mb-3">
								{progress?.phase === 'scanning-directories' &&
									'Traversing repository contents to locate OGraf definitions…'}
								{progress?.phase === 'loading-manifests' && 'Fetching graphic package configurations & assets…'}
								{!progress?.phase && 'Connecting to endpoint and preparing graphic packages…'}
							</div>

							<div className="px-2">
								<ProgressBar
									animated={isIndeterminate}
									striped={isIndeterminate}
									variant={progress?.phase === 'loading-manifests' ? 'success' : 'primary'}
									now={progressPercent}
									style={{ height: '10px', borderRadius: '6px' }}
								/>
								{progress && progress.total > 0 && (
									<div
										className="d-flex justify-content-between text-secondary small mt-1"
										style={{ fontSize: '0.75rem' }}
									>
										<span>
											{progress.processed} of {progress.total} processed
										</span>
										<span>{progressPercent}%</span>
									</div>
								)}
							</div>
						</div>
					</div>
				)}

				{/* ========================================================================= */}
				{/* MODE: ERROR */}
				{/* ========================================================================= */}
				{mode === 'error' && (
					<div className="remote-error-view">
						{/* Target URL reference */}
						<div className="remote-target-banner p-2 px-3 rounded border mb-3">
							<div className="d-flex align-items-center justify-content-between mb-1">
								<span className="text-secondary small fw-semibold text-uppercase" style={{ fontSize: '0.72rem' }}>
									Target URL
								</span>
								<Badge bg={urlMeta.variant} style={{ fontSize: '0.7rem' }}>
									{urlMeta.label}
								</Badge>
							</div>
							<div className="font-monospace small text-break">{customTitle || currentUrl || defaultPlaceholder}</div>
						</div>

						{/* Error alert */}
						<Alert variant="danger" className="mb-3">
							<div className="d-flex gap-2 align-items-start">
								<span className="fs-5">
									<FontAwesomeIcon icon={faCircleXmark} />
								</span>
								<div>
									<strong>Error loading remote graphics:</strong>
									<div className="mt-1 text-break">
										{error || 'An unknown error occurred while loading remote graphics.'}
									</div>
								</div>
							</div>
						</Alert>

						{/* GitHub Rate Limit Info & Login */}
						{isRateLimited && (
							<div className="rate-limit-card p-3 rounded mb-3 border border-warning bg-warning bg-opacity-10">
								<div className="d-flex gap-2 align-items-start mb-2">
									<span className="fs-5">
										<FontAwesomeIcon icon={faLock} />
									</span>
									<div>
										<strong className="text-warning">GitHub Rate Limit Exceeded</strong>
										<p className="small mb-0 mt-1">
											Unauthenticated GitHub API requests are capped at 60 per hour. Sign in with your GitHub account to
											increase your quota to 5,000 requests per hour.
										</p>
									</div>
								</div>
								<div className="mt-3">
									<Button
										variant="dark"
										className="w-100 d-flex align-items-center justify-content-center gap-2 border border-secondary py-2"
										disabled={isSigningIn}
										onClick={onSignInGithub}
									>
										{isSigningIn ? (
											<>
												<Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />
												<span>Authenticating with GitHub…</span>
											</>
										) : (
											<>
												<svg
													width="18"
													height="18"
													viewBox="0 0 24 24"
													fill="currentColor"
													style={{ verticalAlign: '-3px' }}
												>
													<path
														fillRule="evenodd"
														clipRule="evenodd"
														d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
													/>
												</svg>
												<span>Sign in with GitHub to Retry</span>
											</>
										)}
									</Button>
								</div>
							</div>
						)}

						{/* Partial Graphics Option */}
						{partialGraphics && partialGraphics.length > 0 && (
							<div className="partial-card p-3 rounded mb-3 border border-info bg-info bg-opacity-10">
								<div className="d-flex gap-2 align-items-center justify-content-between flex-wrap">
									<div>
										<strong className="text-info">Partial Results Found</strong>
										<div className="small">
											{partialGraphics.length} graphic{partialGraphics.length === 1 ? '' : 's'} were successfully
											located before the scan stopped.
										</div>
									</div>
									<Button size="sm" variant="info" className="fw-semibold mt-1" onClick={onContinuePartial}>
										Continue with {partialGraphics.length} Graphic{partialGraphics.length === 1 ? '' : 's'}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
			</Modal.Body>

			<Modal.Footer className="remote-modal-footer">
				{mode === 'input' && (
					<>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button variant="primary" onClick={handleSubmit}>
							Load Graphics
						</Button>
					</>
				)}

				{mode === 'loading' && (
					<Button variant="outline-secondary" size="sm" onClick={onClose} disabled={isSigningIn}>
						Cancel
					</Button>
				)}

				{mode === 'error' && (
					<div className="d-flex justify-content-between w-100 align-items-center">
						<Button variant="outline-secondary" size="sm" onClick={onSwitchToInput} disabled={isSigningIn}>
							<FontAwesomeIcon icon={faPen} className="me-1" />
							Edit URL
						</Button>
						<div className="d-flex gap-2">
							<Button variant="secondary" size="sm" onClick={onClose} disabled={isSigningIn}>
								Close
							</Button>
							<Button variant="primary" size="sm" onClick={onRetry} disabled={isSigningIn}>
								<FontAwesomeIcon icon={faRotateRight} className="me-1" />
								Try Again
							</Button>
						</div>
					</div>
				)}
			</Modal.Footer>
		</Modal>
	)
}
