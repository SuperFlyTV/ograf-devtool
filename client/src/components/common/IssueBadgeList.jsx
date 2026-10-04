import * as React from 'react'
import { Badge } from 'react-bootstrap'
import { GraphicIssues } from '../GraphicIssues.jsx'

export function getGraphicIssueCounts(graphic) {
	let errorCount = 0
	let warningCount = 0

	if (graphic.manifestParseError) {
		errorCount++
	}

	if (graphic.warnings && graphic.warnings.length > 0) {
		warningCount += graphic.warnings.length
	}

	// Filename error checks
	if (graphic.path && !graphic.path.endsWith('.ograf.json')) {
		errorCount++
	}

	return {
		errorCount,
		warningCount,
		hasIssues: errorCount > 0 || warningCount > 0,
	}
}

export function IssueBadgeList({ graphic, forceExpanded, className = '' }) {
	const [isLocallyExpanded, setIsLocallyExpanded] = React.useState(false)

	const isExpanded = forceExpanded !== undefined ? forceExpanded : isLocallyExpanded

	const { errorCount, warningCount, hasIssues } = React.useMemo(() => getGraphicIssueCounts(graphic), [graphic])

	const toggleExpanded = React.useCallback((e) => {
		e.stopPropagation()
		setIsLocallyExpanded((prev) => !prev)
	}, [])

	return (
		<div className={`issue-badge-list ${className}`}>
			<div className="issue-badge-row d-flex align-items-center gap-1 flex-wrap">
				{hasIssues ? (
					<>
						{errorCount > 0 && (
							<button
								type="button"
								className="badge-btn badge-btn-error"
								onClick={toggleExpanded}
								title="Click to view error details"
							>
								<span className="badge-icon">⛔</span>
								<span>
									{errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
								</span>
								<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
							</button>
						)}
						{warningCount > 0 && (
							<button
								type="button"
								className="badge-btn badge-btn-warning"
								onClick={toggleExpanded}
								title="Click to view warning details"
							>
								<span className="badge-icon">⚠️</span>
								<span>
									{warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
								</span>
								<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
							</button>
						)}
					</>
				) : (
					<button
						type="button"
						className="badge-btn badge-btn-valid"
						onClick={toggleExpanded}
						title="Click to view verification details or run in-depth test"
					>
						<span className="badge-icon">✓</span>
						<span>Valid</span>
						<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
					</button>
				)}
			</div>

			{isExpanded && (
				<div className="issue-details-panel mt-2" onClick={(e) => e.stopPropagation()}>
					{graphic.manifestParseError && (
						<div className="alert alert-danger p-2 small mb-2">
							<strong>Manifest Parse Error:</strong>
							<div>{graphic.manifestParseError.toString()}</div>
						</div>
					)}
					{graphic.warnings?.map((warning, wi) => (
						<div className="alert alert-warning p-2 small mb-2" key={wi}>
							<strong>Warning:</strong> {warning}
						</div>
					))}
					<GraphicIssues manifest={graphic.manifest} graphic={graphic} />
				</div>
			)}
		</div>
	)
}
