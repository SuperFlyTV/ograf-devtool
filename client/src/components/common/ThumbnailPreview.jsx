import * as React from 'react'
import { Link } from 'react-router'
import { Overlay, Popover, Button, Spinner, Badge } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBolt, faGear, faFilm, faImage, faCamera } from '@fortawesome/free-solid-svg-icons'
import { graphicResourcePath } from '../../lib/lib.js'
import { fileHandler } from '../../FileHandler.js'
import { generateThumbnailsForGraphic } from '../../lib/ThumbnailGenerator.js'
import { loadPersistedSettings } from '../ThumbnailGeneratorSection.jsx'
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

			const extMatch = typeof file === 'string' ? file.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/) : null
			const format = extMatch ? extMatch[1].toLowerCase() : ''
			const isAnimated = format === 'gif' || format === 'webp'

			const width = typeof t === 'object' && typeof t?.resolution?.width === 'number' ? t.resolution.width : undefined
			const height =
				typeof t === 'object' && typeof t?.resolution?.height === 'number' ? t.resolution.height : undefined

			let label = width && height ? `${width}×${height}` : file
			if (format) label += ` [${format.toUpperCase()}]`

			return {
				raw: t,
				file,
				isAnimated,
				format,
				width: width || 0,
				height: height || 0,
				pixels: (width || 0) * (height || 0),
				label,
			}
		})
		.filter(Boolean)

	return items
}

export function getBestThumbnail(thumbnails, targetSize = null) {
	const all = getAllThumbnails(thumbnails)
	if (all.length === 0) return null

	const formatRank = (format) => {
		if (format === 'webp') return 1
		if (format === 'gif') return 2
		if (format === 'png') return 3
		if (format === 'svg') return 4
		if (format === 'jpg' || format === 'jpeg') return 5
		return 6
	}

	const targetW =
		typeof targetSize === 'object' && targetSize !== null
			? targetSize.width
			: typeof targetSize === 'number'
			? targetSize
			: null
	const targetH = typeof targetSize === 'object' && targetSize !== null ? targetSize.height : null

	const getViewportDistance = (item) => {
		if (!targetW) return 0
		if (!item.width || !item.height) return Infinity
		if (targetW && targetH) {
			return Math.hypot(item.width - targetW, item.height - targetH)
		}
		return Math.abs(item.pixels - targetW * (targetH || targetW))
	}

	const sorted = [...all].sort((a, b) => {
		// 1. Prefer animated over static (WebP over GIF)
		if (a.isAnimated !== b.isAnimated) {
			return a.isAnimated ? -1 : 1
		}
		if (a.isAnimated && b.isAnimated) {
			const rankA = formatRank(a.format)
			const rankB = formatRank(b.format)
			if (rankA !== rankB) {
				return rankA - rankB
			}
		}

		// 2. Closest size matching viewport (if targetSize is provided)
		if (targetW) {
			const distA = getViewportDistance(a)
			const distB = getViewportDistance(b)
			if (distA !== distB) {
				return distA - distB
			}
		}

		// 3. Prefer transparent formats (like PNG) over JPG/JPEG
		const rankA = formatRank(a.format)
		const rankB = formatRank(b.format)
		if (rankA !== rankB) {
			return rankA - rankB
		}

		// 4. Default to higher resolution
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
	size = 'table', // 'table' | 'card' | { width, height }
	targetSize: customTargetSize,
	disableHover = size === 'card',
	graphicsSource = 'local',
	onRefresh,
	className = '',
}) {
	const effectiveThumbnails = thumbnails ?? graphic?.manifest?.thumbnails
	const effectiveFolderPath = folderPath || graphic?.folderPath || ''
	const allThumbnails = React.useMemo(() => getAllThumbnails(effectiveThumbnails), [effectiveThumbnails])

	const resolvedTargetSize = React.useMemo(() => {
		if (customTargetSize) return customTargetSize
		if (typeof size === 'object' && size !== null && size.width && size.height) return size
		if (size === 'table') return { width: 80, height: 45 }
		if (size === 'card') return { width: 320, height: 180 }
		return null
	}, [customTargetSize, size])

	const best = React.useMemo(
		() => getBestThumbnail(effectiveThumbnails, resolvedTargetSize),
		[effectiveThumbnails, resolvedTargetSize]
	)
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
			const saved = loadPersistedSettings()
			const thumbnailSettings = {
				...saved,
				resolutions: [{ width: targetRes.width, height: targetRes.height, addCropped: false }],
				transparent: true,
				captureDelay: 1000,
				skipAnimation: true,
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
				(existing) => !newThumbnails.some((n) => n.file === (typeof existing === 'string' ? existing : existing.file))
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
		const mainLabel = best.label

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
								<span className="thumb-popover-title">
									<FontAwesomeIcon icon={faImage} className="me-1" />
									{alt}
								</span>
								{allThumbnails.length > 1 && (
									<span className="thumb-count-badge">{allThumbnails.length} thumbnails</span>
								)}
							</Popover.Header>
							<Popover.Body className="thumb-popover-body">
								{/* Primary Large Thumbnail */}
								<div className="popover-main-thumb-box position-relative">
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
									{best.isAnimated && (
										<Badge bg="info" className="position-absolute top-0 end-0 m-2 text-dark">
											<FontAwesomeIcon icon={faFilm} className="me-1" />
											Animated
										</Badge>
									)}
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
														<div className="variation-thumb-wrap position-relative">
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
						<div className="thumbnail-card-aspect position-relative">
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
						className="thumbnail-table-link position-relative"
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
							<span className="thumb-popover-title">
								<FontAwesomeIcon icon={faImage} className="me-1" />
								{alt}
							</span>
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
							<span className="no-thumb-icon">
								<FontAwesomeIcon icon={faImage} />
							</span>
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
					<span className="no-thumb-icon-sm">
						<FontAwesomeIcon icon={faCamera} />
					</span>
					<span className="no-thumb-text-sm">No thumbnail</span>
				</div>
			</div>
			{!disableHover && noThumbPopoverOverlay}
		</>
	)
}
