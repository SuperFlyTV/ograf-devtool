import * as React from 'react'
import { Button } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faCheck, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons'
import { setupSchemaValidator } from '../lib/graphic/verify.js'
import { collectGraphicIssues, getAllIssuesText } from '../lib/graphic/allIssues.js'

const EXPANDED_STORAGE_KEY = 'ograf-all-issues-expanded'

function getInitialExpanded() {
	try {
		return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true'
	} catch (_) {
		return false
	}
}

export function AllGraphicsIssuesSection({ graphicsList = [], graphicsFolderName = '' }) {
	const [isExpanded, setIsExpanded] = React.useState(getInitialExpanded)
	const [graphicsIssuesResults, setGraphicsIssuesResults] = React.useState([])
	const [validatorInstance, setValidatorInstance] = React.useState(null)
	const [copied, setCopied] = React.useState(false)

	const toggleExpanded = React.useCallback(() => {
		setIsExpanded((prev) => {
			const next = !prev
			try {
				localStorage.setItem(EXPANDED_STORAGE_KEY, String(next))
			} catch (_) {}
			return next
		})
	}, [])

	// Setup schema validator instance
	React.useEffect(() => {
		let isCancelled = false
		setupSchemaValidator()
			.then((validator) => {
				if (!isCancelled) {
					setValidatorInstance(() => validator)
				}
			})
			.catch((err) => {
				console.error('Failed to setup schema validator:', err)
			})
		return () => {
			isCancelled = true
		}
	}, [])

	// Validate graphics
	React.useEffect(() => {
		let isCancelled = false
		if (!graphicsList || graphicsList.length === 0) {
			setGraphicsIssuesResults([])
			return
		}

		async function runValidation() {
			let validator = validatorInstance
			if (!validator) {
				try {
					validator = await setupSchemaValidator()
					if (!isCancelled) setValidatorInstance(() => validator)
				} catch (_) {}
			}

			const results = []
			for (const graphic of graphicsList) {
				if (isCancelled) return
				try {
					const issues = await collectGraphicIssues(graphic, validator)
					results.push({ graphic, issues })
				} catch (err) {
					results.push({
						graphic,
						issues: [
							{
								id: 'VALIDATION_EXCEPTION',
								severity: 'error',
								message: `Validation error: ${err.message || err}`,
							},
						],
					})
				}
			}

			if (!isCancelled) {
				setGraphicsIssuesResults(results)
			}
		}

		runValidation()

		return () => {
			isCancelled = true
		}
	}, [graphicsList, validatorInstance])

	// Total issues count
	const issuesCount = React.useMemo(() => {
		let count = 0
		for (const { issues } of graphicsIssuesResults) {
			count += (issues || []).length
		}
		return count
	}, [graphicsIssuesResults])

	// Formatted issues text
	const allIssuesText = React.useMemo(() => {
		return getAllIssuesText({
			graphicsResults: graphicsIssuesResults,
			severityFilter: 'all',
			onlyWithIssues: true,
		})
	}, [graphicsIssuesResults])

	const handleCopy = React.useCallback(async () => {
		try {
			if (navigator?.clipboard?.writeText) {
				await navigator.clipboard.writeText(allIssuesText)
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
				return
			}
		} catch (_) {}

		try {
			const textarea = document.createElement('textarea')
			textarea.value = allIssuesText
			textarea.style.position = 'fixed'
			textarea.style.left = '-9999px'
			document.body.appendChild(textarea)
			textarea.focus()
			textarea.select()
			document.execCommand('copy')
			document.body.removeChild(textarea)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch (_) {}
	}, [allIssuesText])

	if (!graphicsList || graphicsList.length === 0) {
		return null
	}

	return (
		<div className="all-issues-accordion">
			<button type="button" className="all-issues-toggle" onClick={toggleExpanded} aria-expanded={isExpanded}>
				<span className="all-issues-title">All issues {issuesCount > 0 ? `(${issuesCount})` : ''}</span>
				<FontAwesomeIcon icon={isExpanded ? faChevronUp : faChevronDown} className="text-muted" />
			</button>

			{isExpanded && (
				<div className="all-issues-content">
					<div className="d-flex justify-content-end mb-2">
						<Button variant="outline-secondary" size="sm" onClick={handleCopy} className="btn-copy-issues">
							<FontAwesomeIcon icon={copied ? faCheck : faCopy} className="me-1" />
							{copied ? 'Copied' : 'Copy text'}
						</Button>
					</div>
					<textarea
						className="form-control all-issues-textarea"
						readOnly
						value={allIssuesText}
						rows={14}
						spellCheck={false}
					/>
				</div>
			)}
		</div>
	)
}
