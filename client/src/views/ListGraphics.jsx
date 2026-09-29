import * as React from 'react'
import { Table, Button, OverlayTrigger, Tooltip, Badge } from 'react-bootstrap'
import { Link } from 'react-router'
import { GraphicIssues } from '../components/GraphicIssues'
import { graphicResourcePath } from '../lib/lib.js'

function getBestThumbnail(thumbnails) {
	if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null

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

			return {
				raw: t,
				file,
				isCropped,
				width: width || 0,
				height: height || 0,
				pixels: (width || 0) * (height || 0),
			}
		})
		.filter(Boolean)

	if (items.length === 0) return null

	items.sort((a, b) => {
		if (a.isCropped !== b.isCropped) {
			return a.isCropped ? 1 : -1
		}
		if (a.pixels !== b.pixels) {
			return b.pixels - a.pixels
		}
		return 0
	})

	return items[0]
}

function formatLastModified(timestamp) {
	if (!timestamp) return '—'
	const d = new Date(timestamp)
	if (isNaN(d.getTime())) return '—'
	return d.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export function ListGraphics({ graphicsList, onRefresh, onCloseFolder, graphicsFolderName, graphicsSource }) {
	const [sortField, setSortField] = React.useState('path')
	const [sortDirection, setSortDirection] = React.useState('asc')

	const handleSort = (field) => {
		if (sortField === field) {
			setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
		} else {
			setSortField(field)
			setSortDirection('asc')
		}
	}

	const sortedGraphics = React.useMemo(() => {
		if (!graphicsList) return []
		const list = [...graphicsList]

		list.sort((a, b) => {
			let aVal, bVal

			switch (sortField) {
				case 'name':
					aVal = (a.manifest?.name || '').toLowerCase()
					bVal = (b.manifest?.name || '').toLowerCase()
					break
				case 'lastModified':
					aVal = a.lastModified || 0
					bVal = b.lastModified || 0
					break
				case 'capabilities': {
					const getRank = (g) => (g.manifest?.supportsRealTime ? 2 : 0) + (g.manifest?.supportsNonRealTime ? 1 : 0)
					aVal = getRank(a)
					bVal = getRank(b)
					break
				}
				case 'path':
				default:
					aVal = (a.path || '').toLowerCase()
					bVal = (b.path || '').toLowerCase()
					break
			}

			if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
			if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
			return 0
		})

		return list
	}, [graphicsList, sortField, sortDirection])

	const renderSortHeader = (field, label) => {
		const isActive = sortField === field
		return (
			<th
				onClick={() => handleSort(field)}
				style={{ cursor: 'pointer', userSelect: 'none' }}
				title={`Click to sort by ${label}`}
			>
				<div className="d-flex align-items-center justify-content-between gap-1">
					<span>{label}</span>
					<small className="text-muted" style={{ fontSize: '0.75rem' }}>
						{isActive ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
					</small>
				</div>
			</th>
		)
	}

	return (
		<div className="container-lg">
			<div className="list-graphics card">
				<div>
					<h2>
						{graphicsSource === 'remote' ? 'Remote URL' : 'Local folder'} "{graphicsFolderName}"
					</h2>
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
						<Link to={`/thumbnails`}>
							<Button>View All OGrafs</Button>
						</Link>{' '}
						{graphicsSource === 'remote' ? (
							<OverlayTrigger
								overlay={<Tooltip>Generating Thumbnails is only available in Local folder mode.</Tooltip>}
							>
								<span className="d-inline-block">
									<Button variant="success" disabled style={{ pointerEvents: 'none' }}>
										🖼️ Generate Thumbnails
									</Button>
								</span>
							</OverlayTrigger>
						) : (
							<Link to={`/generate-thumbnails`}>
								<Button variant="success">🖼️ Generate Thumbnails</Button>
							</Link>
						)}
					</div>
				</div>

				{graphicsList.length > 0 ? (
					<Table striped bordered className="align-middle">
						<thead>
							<tr>
								{renderSortHeader('path', 'Manifest path')}
								<th>Thumbnail</th>
								{renderSortHeader('name', 'Name')}
								{renderSortHeader('capabilities', 'Capabilities')}
								{renderSortHeader('lastModified', 'Modified date')}
								<th>Issues</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{sortedGraphics.map((graphic, i) => {
								const bestThumbnail = getBestThumbnail(graphic.manifest?.thumbnails)
								const hasId = !!graphic.manifest?.id
								const hasVersion = !!graphic.manifest?.version
								const tooltipText =
									hasId || hasVersion ? (
										<Tooltip id={`tooltip-id-${i}`}>
											{hasId && (
												<div>
													<strong>ID:</strong> {graphic.manifest.id}
												</div>
											)}
											{hasVersion && (
												<div>
													<strong>Version:</strong> {graphic.manifest.version}
												</div>
											)}
										</Tooltip>
									) : null

								return (
									<tr key={graphic.path}>
										<td>{graphic.path}</td>
										<td>
											{bestThumbnail
												? (() => {
														const filePath = (graphic.folderPath || '') + bestThumbnail.file
														const src = graphicResourcePath(filePath)
														const label =
															bestThumbnail.width && bestThumbnail.height
																? `${bestThumbnail.width}×${bestThumbnail.height}`
																: bestThumbnail.file
														return (
															<a
																href={src}
																target="_blank"
																rel="noreferrer"
																title={`Open ${bestThumbnail.file} in new tab`}
															>
																<img
																	src={src}
																	alt={label}
																	style={{
																		maxHeight: '48px',
																		maxWidth: '90px',
																		width: 'auto',
																		height: 'auto',
																		objectFit: 'contain',
																		border: '1px solid #ccc',
																		borderRadius: '3px',
																		background: 'repeating-conic-gradient(#888 0% 25%, #555 0% 50%) 0 0 / 12px 12px',
																		display: 'block',
																	}}
																/>
															</a>
														)
												  })()
												: null}
										</td>
										<td>
											{tooltipText ? (
												<OverlayTrigger placement="top" overlay={tooltipText}>
													<span style={{ cursor: 'help', borderBottom: '1px dotted #666' }}>
														{graphic.manifest?.name ?? `N/A`}
													</span>
												</OverlayTrigger>
											) : (
												graphic.manifest?.name ?? `N/A`
											)}
										</td>
										<td>
											<div className="d-flex flex-wrap gap-1 align-items-center">
												{graphic.manifest?.supportsRealTime && <span title="Supports Real-Time rendering">🏃</span>}
												{graphic.manifest?.supportsNonRealTime && (
													<span title="Supports Non-Real-Time rendering">🎞</span>
												)}
												{!graphic.manifest?.supportsRealTime && !graphic.manifest?.supportsNonRealTime && (
													<span className="text-muted small">—</span>
												)}
											</div>
										</td>
										<td style={{ whiteSpace: 'nowrap' }}>{formatLastModified(graphic.lastModified)}</td>
										<td>
											{graphic.manifestParseError ? (
												<div className="alert alert-danger">
													<div>Error in manifest file:</div>
													<div>{graphic.manifestParseError.toString()}</div>
												</div>
											) : null}
											{graphic.warnings?.map((warning, wi) => (
												<div className="alert alert-warning" key={wi}>
													{warning}
												</div>
											))}
											<GraphicIssues manifest={graphic.manifest} graphic={graphic} />
										</td>
										<td>
											<Link to={`/graphic${graphic.path}`}>
												<Button>Select</Button>
											</Link>
										</td>
									</tr>
								)
							})}
						</tbody>
					</Table>
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
