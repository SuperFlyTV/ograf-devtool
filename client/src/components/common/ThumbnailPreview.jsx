import * as React from 'react'
import { Link } from 'react-router'
import { Overlay, Popover, Button, Spinner } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBolt, faGear } from '@fortawesome/free-solid-svg-icons'
import { graphicResourcePath } from '../../lib/lib.js'
import { fileHandler } from '../../FileHandler.js'
import { generateThumbnailsForGraphic } from '../../lib/ThumbnailGenerator.js'
import { RetryImage } from './RetryImage.jsx'

export function resolveNumberConstraint(constraint, defaultValue) {
	if (typeof constraint === 'number' && !isNaN(constraint) && constraint > 0) return constraint
	if (!constraint || typeof constraint !== 'object') return defaultValue

	if (typeof constraint.exact === 'number' && constraint.exact > 0) return constraint.exact
	if (typeof constraint.ideal === 'number' && constraint.ideal > 0) return constraint.ideal
	if (typeof constraint.max === 'number' && constraint.max > 0) return constraint.max
	if (typeof constraint.min === 'number' && constraint.min > 0) return constraint.min

	return defaultValue
}

export function resolveDefaultGraphicResolution(manifest) {
	const defaultRes = { width: 1920, height: 1080 }
	if (!manifest) return defaultRes

	if (Array.isArray(manifest.renderRequirements)) {
		for (const req of manifest.renderRequirements) {
			if (req?.resolution) {
				const w = resolveNumberConstraint(req.resolution.width, null)
				const h = resolveNumberConstraint(req.resolution.height, null)
				if (w && h) {
					return { width: Math.round(w), height: Math.round(h) }
				}
			}
		}
	}

	if (manifest.resolution) {
		const w = resolveNumberConstraint(manifest.resolution.width, null)
		const h = resolveNumberConstraint(manifest.resolution.height, null)
		if (w && h) {
			return { width: Math.round(w), height: Math.round(h) }
		}
	}

	return defaultRes
}

export function getAllThumbnails(thumbnails) {
	if (!Array.isArray(thumbnails) || thumbnails.length === 0) return []

	const items = thumbnails
		.map((t) => {
			const file = typeof t === 'string' ? t : t?.file
			if (!file) return null

			const isCropped = file.includes('-cropped')
			let width = typeof t === 'object' ? t?.resolution?.width : undefined
			let height = typeof t === 'object' ? t?.resolution?.height : undefined

			if (!width || !height) {
				const match = file.match(/(\d+)x(\d+)/)
				if (match) {
					width = parseInt(match[1], 10)
					height = parseInt(match[2], 10)
				}
			}

			const label = width && height ? `${width}×${height}${isCropped ? ' (Cropped)' : ''}` : file

			return {
				raw: t,
				file,
				isCropped,
				width: width || 0,
				height: height || 0,
				pixels: (width || 0) * (height || 0),
				label,
			}
		})
		.filter(Boolean)

	return items
}

export function getBestThumbnail(thumbnails) {
	const all = getAllThumbnails(thumbnails)
	if (all.length === 0) return null

	const sorted = [...all].sort((a, b) => {
		if (a.isCropped !== b.isCropped) {
			return a.isCropped ? 1 : -1
		}
		if (a.pixels !== b.pixels) {
			return b.pixels - a.pixels
		}
		return 0
	})

	return sorted[0]
}

export function ThumbnailPreview({
	graphic,
	thumbnails,
	folderPath = '',
	alt = 'Graphic Thumbnail',
	size = 'table', // 'table' | 'card'
	disableHover = size === 'card',
	graphicsSource = 'local',
	onRefresh,
	className = '',
}) {
	const effectiveThumbnails = thumbnails ?? graphic?.manifest?.thumbnails
	const effectiveFolderPath = folderPath || graphic?.folderPath || ''
	const allThumbnails = React.useMemo(() => getAllThumbnails(effectiveThumbnails), [effectiveThumbnails])
	const best = React.useMemo(() => getBestThumbnail(effectiveThumbnails), [effectiveThumbnails])
	const [imgError, setImgError] = React.useState(false)

	// Quick-Add generation state
	const [isGenerating, setIsGenerating] = React.useState(false)
	const [generateStatus, setGenerateStatus] = React.useState('')
	const [generateError, setGenerateError] = React.useState(null)

	// Controlled hover state to ensure rock-solid hover transitions into the popover
	const [showPopover, setShowPopover] = React.useState(false)
	const triggerRef = React.useRef(null)
	const hoverTimeoutRef = React.useRef(null)

	const handleMouseEnter = React.useCallback(() => {
		if (disableHover) return
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current)
			hoverTimeoutRef.current = null
		}
		hoverTimeoutRef.current = setTimeout(() => {
			setShowPopover(true)
		}, 300)
	}, [disableHover])

	const handleMouseLeave = React.useCallback(() => {
		if (disableHover) return
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current)
			hoverTimeoutRef.current = null
		}
		hoverTimeoutRef.current = setTimeout(() => {
			setShowPopover(false)
		}, 350)
	}, [disableHover])

	const handlePopoverMouseEnter = React.useCallback(() => {
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current)
			hoverTimeoutRef.current = null
		}
	}, [])

	const handlePopoverMouseLeave = React.useCallback(() => {
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current)
			hoverTimeoutRef.current = null
		}
		hoverTimeoutRef.current = setTimeout(() => {
			setShowPopover(false)
		}, 350)
	}, [])

	React.useEffect(() => {
		return () => {
			if (hoverTimeoutRef.current) {
				clearTimeout(hoverTimeoutRef.current)
			}
		}
	}, [])

	const isRemote = graphicsSource === 'remote'
	const targetRes = React.useMemo(() => resolveDefaultGraphicResolution(graphic?.manifest), [graphic?.manifest])

	const handleQuickAdd = async (e) => {
		e?.preventDefault?.()
		e?.stopPropagation?.()
		if (isGenerating || isRemote || !graphic) return

		setIsGenerating(true)
		setGenerateStatus('Starting…')
		setGenerateError(null)

		try {
			const thumbnailSettings = {
				resolutions: [{ width: targetRes.width, height: targetRes.height, addCropped: false }],
				transparent: true,
				captureDelay: 1000,
				skipAnimation: true,
				renderMethod: 'html-in-canvas',
			}

			const newThumbnails = await generateThumbnailsForGraphic({
				graphic,
				thumbnailSettings,
				onProgress: (msg) => {
					setGenerateStatus(msg)
				},
				writeFileFn: async (path, blob) => {
					await fileHandler.writeFile(path, blob)
				},
			})

			const keptThumbnails = (graphic.manifest?.thumbnails ?? []).filter(
				(existing) => !newThumbnails.some((n) => n.file === existing.file)
			)
			const updatedManifest = {
				...graphic.manifest,
				thumbnails: [...keptThumbnails, ...newThumbnails],
			}
			await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
			graphic.manifest = updatedManifest

			setImgError(false)
			setGenerateStatus('Done!')
			setShowPopover(false)

			if (onRefresh) {
				await onRefresh()
			}
		} catch (err) {
			console.error('Quick-Add thumbnail error:', err)
			setGenerateError(err.message || 'Failed to generate thumbnail')
		} finally {
			setIsGenerating(false)
		}
	}

	// ── Case 1: Thumbnail is present ──────────────────────────────────────────
	if (best && !imgError) {
		const filePath = (effectiveFolderPath || '') + best.file
		const mainSrc = graphicResourcePath(filePath)
		const mainLabel = best.width && best.height ? `${best.width}×${best.height}` : best.file

		const popoverOverlay = (
			<Overlay target={triggerRef.current} show={showPopover} placement={size === 'card' ? 'auto' : 'right'}>
				{({ placement, arrowProps, show: _show, popper, hasDoneInitialMeasure, ...overlayProps }) => (
					<div
						{...overlayProps}
						onMouseEnter={handlePopoverMouseEnter}
						onMouseLeave={handlePopoverMouseLeave}
						style={{
							...overlayProps.style,
							zIndex: 1070,
						}}
					>
						<Popover id={`popover-thumb-${encodeURIComponent(alt)}`} className="thumbnail-hover-popover">
							<Popover.Header className="thumb-popover-header">
								<span className="thumb-popover-title">🖼️ {alt}</span>
								{allThumbnails.length > 1 && (
									<span className="thumb-count-badge">{allThumbnails.length} thumbnails</span>
								)}
							</Popover.Header>
							<Popover.Body className="thumb-popover-body">
								{/* Primary Large Thumbnail */}
								<div className="popover-main-thumb-box">
									<a
										href={mainSrc}
										target="_blank"
										rel="noreferrer"
										className="popover-main-link"
										title={`Open full ${best.file} in new tab`}
										onClick={(e) => e.stopPropagation()}
									>
										<RetryImage src={mainSrc} alt={mainLabel} className="popover-main-img" />
									</a>
								</div>

								{/* Multiple variations gallery */}
								{allThumbnails.length > 1 && (
									<div className="popover-variations-section">
										<div className="variations-header">Available Variations:</div>
										<div className="variations-grid">
											{allThumbnails.map((item, idx) => {
												const itemSrc = graphicResourcePath((effectiveFolderPath || '') + item.file)
												const isCurrentBest = item.file === best.file
												return (
													<a
														key={idx}
														href={itemSrc}
														target="_blank"
														rel="noreferrer"
														className={`variation-card ${isCurrentBest ? 'is-best' : ''}`}
														title={`Open ${item.file} in new tab`}
														onClick={(e) => e.stopPropagation()}
													>
														<div className="variation-thumb-wrap">
															<RetryImage src={itemSrc} alt={item.label} className="variation-img" />
														</div>
														<span className="variation-label">{item.label}</span>
													</a>
												)
											})}
										</div>
									</div>
								)}
								<div>
									<Link
										to="/?generator=true"
										className="btn btn-outline-secondary btn-sm w-100 open-generator-btn"
										onClick={(e) => {
											e.stopPropagation()
											setShowPopover(false)
										}}
									>
										<FontAwesomeIcon icon={faGear} className="me-1" />
										<span>Go to Thumbnail Generator…</span>
									</Link>
								</div>
							</Popover.Body>
						</Popover>
					</div>
				)}
			</Overlay>
		)

		if (size === 'card') {
			return (
				<>
					<div
						ref={disableHover ? undefined : triggerRef}
						className={`thumbnail-card-wrapper ${className}`}
						onMouseEnter={disableHover ? undefined : handleMouseEnter}
						onMouseLeave={disableHover ? undefined : handleMouseLeave}
					>
						<div className="thumbnail-card-aspect">
							<RetryImage src={mainSrc} alt={alt} className="thumbnail-img-card" onError={() => setImgError(true)} />
							<span className="thumbnail-res-tag">{mainLabel}</span>
						</div>
					</div>
					{!disableHover && popoverOverlay}
				</>
			)
		}

		// Table / compact view:
		return (
			<>
				<div
					ref={disableHover ? undefined : triggerRef}
					className={`thumbnail-table-wrapper ${className}`}
					onMouseEnter={disableHover ? undefined : handleMouseEnter}
					onMouseLeave={disableHover ? undefined : handleMouseLeave}
				>
					<a
						href={mainSrc}
						target="_blank"
						rel="noreferrer"
						title={`Open ${best.file} (${mainLabel}) in new tab`}
						className="thumbnail-table-link"
						onClick={(e) => e.stopPropagation()}
					>
						<RetryImage src={mainSrc} alt={alt} className="thumbnail-img-table" onError={() => setImgError(true)} />
					</a>
				</div>
				{!disableHover && popoverOverlay}
			</>
		)
	}

	// ── Case 2: No thumbnail present (Hover popover with Quick-Add & Generator link) ──

	const noThumbPopoverOverlay = (
		<Overlay target={triggerRef.current} show={showPopover} placement={size === 'card' ? 'auto' : 'right'}>
			{({ placement, arrowProps, show: _show, popper, hasDoneInitialMeasure, ...overlayProps }) => (
				<div
					{...overlayProps}
					onMouseEnter={handlePopoverMouseEnter}
					onMouseLeave={handlePopoverMouseLeave}
					style={{
						...overlayProps.style,
						zIndex: 1070,
					}}
				>
					<Popover
						id={`popover-no-thumb-${encodeURIComponent(alt)}`}
						className="thumbnail-hover-popover no-thumb-popover"
					>
						<Popover.Header className="thumb-popover-header">
							<span className="thumb-popover-title">🖼️ {alt}</span>
							<span className="thumb-count-badge no-thumb-badge">No Thumbnail</span>
						</Popover.Header>
						<Popover.Body className="thumb-popover-body">
							<div className="no-thumb-popover-card">
								<p className="no-thumb-popover-desc">This graphic does not have any thumbnails generated yet.</p>

								{!isRemote ? (
									<div className="no-thumb-actions-container">
										<div className="resolution-hint mb-2">
											<span className="hint-label">Target resolution:</span>
											<code className="hint-value">
												{targetRes.width} × {targetRes.height}
											</code>
										</div>

										{generateError && (
											<div className="alert alert-danger p-2 small mb-2">
												<strong>Error:</strong> {generateError}
											</div>
										)}

										<Button
											variant="primary"
											size="sm"
											className="w-100 quick-add-btn mb-2"
											onClick={handleQuickAdd}
											disabled={isGenerating}
										>
											{isGenerating ? (
												<>
													<Spinner size="sm" animation="border" className="me-2" />
													<span>{generateStatus || 'Generating…'}</span>
												</>
											) : (
												<>
													<FontAwesomeIcon icon={faBolt} className="me-1" />
													<span>Quick-Add Thumbnail</span>
												</>
											)}
										</Button>

										<Link
											to="/?generator=true"
											className="btn btn-outline-secondary btn-sm w-100 open-generator-btn"
											onClick={(e) => {
												e.stopPropagation()
												setShowPopover(false)
											}}
										>
											<FontAwesomeIcon icon={faGear} className="me-1" />
											<span>Open Thumbnail Generator…</span>
										</Link>
									</div>
								) : (
									<div className="alert alert-info p-2 small mb-0">
										Thumbnails can only be generated when opening a local folder.
									</div>
								)}
							</div>
						</Popover.Body>
					</Popover>
				</div>
			)}
		</Overlay>
	)

	if (size === 'card') {
		return (
			<>
				<div
					ref={disableHover ? undefined : triggerRef}
					className={`thumbnail-card-wrapper no-thumbnail-wrapper ${className}`}
					onMouseEnter={disableHover ? undefined : handleMouseEnter}
					onMouseLeave={disableHover ? undefined : handleMouseLeave}
				>
					<div className="thumbnail-card-aspect no-thumbnail-box card-no-thumb">
						<div className="no-thumb-content">
							<span className="no-thumb-icon">🖼️</span>
							<span className="no-thumb-title">No thumbnail</span>
						</div>
					</div>
				</div>
				{!disableHover && noThumbPopoverOverlay}
			</>
		)
	}

	// Compact table placeholder
	return (
		<>
			<div
				ref={disableHover ? undefined : triggerRef}
				className={`thumbnail-table-wrapper no-thumbnail-wrapper ${className}`}
				onMouseEnter={disableHover ? undefined : handleMouseEnter}
				onMouseLeave={disableHover ? undefined : handleMouseLeave}
			>
				<div className="no-thumb-table-box" title="No thumbnail available (hover for options)">
					<span className="no-thumb-icon-sm">📷</span>
					<span className="no-thumb-text-sm">No thumbnail</span>
				</div>
			</div>
			{!disableHover && noThumbPopoverOverlay}
		</>
	)
}
