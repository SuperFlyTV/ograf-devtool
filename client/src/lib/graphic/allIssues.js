import { normalizeIssue, testGraphicManifestFileNames } from './verify.js'

/**
 * Get a suggested fix description for an issue
 */
export function getIssueFixRecommendation(issue) {
	if (!issue) return ''
	if (issue.fixLabel) return issue.fixLabel

	const id = issue.id || ''
	const msg = issue.message || ''

	if (id === 'PARSE_ERROR') {
		return 'Fix syntax errors in the JSON manifest (check commas, quotes, brackets).'
	}
	if (id === 'FIX.1') {
		return 'Update "$schema" to "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json"'
	}
	if (id === 'FIX.2' || msg.includes('rendering')) {
		return 'Flatten properties from the deprecated "rendering" object to the top level of the manifest.'
	}
	if (id === 'FIX.2' || msg.includes('actions')) {
		return 'Rename the "actions" property to "customActions".'
	}
	if (id === 'FIX.3' || msg.includes('.ograf.json')) {
		return 'Rename the manifest file to end with ".ograf.json".'
	}
	if (id === 'T1.1') {
		return 'Ensure the main entrypoint file exists on disk and is correctly specified in the "main" field.'
	}
	if (id === 'T1.2') {
		return 'Implement the graphic Web Component extending HTMLElement with a default class export.'
	}
	if (id === 'T1.3') {
		return 'Enable at least one render mode: "supportsRealTime": true or "supportsNonRealTime": true.'
	}
	if (id === 'T1.4') {
		return 'Check actionDurations: ensure valid action types or matching customActionId without duplicates.'
	}
	if (id === 'T1.5') {
		return 'Ensure playAction step indices are within the stepCount boundary (< stepCount).'
	}
	if (id === 'T1.6') {
		return 'Remove forward slashes from the manifest "id" property.'
	}
	if (id === 'T1.7') {
		return 'Implement non-real-time required methods: goToTime() and setActionsSchedule().'
	}
	if (id === 'T2.1') {
		return 'Add a descriptive "title" or "label" string to each property in schema.properties.'
	}
	if (id === 'T2.2') {
		return 'Update declared thumbnail resolution to match the actual image dimensions.'
	}
	if (id === 'T2.3') {
		return 'Use a supported thumbnail image format (.png, .jpg, .jpeg, .gif, .webp).'
	}
	if (id === 'T2.4') {
		return 'Add at least one thumbnail entry to the "thumbnails" array and ensure the file exists on disk.'
	}
	if (id === 'T2.5') {
		return 'Consider optimizing or compressing large asset files to reduce load time.'
	}

	if (msg.includes('is not allowed to have the additional property')) {
		return 'Remove the unknown property, or prefix vendor-specific properties with "v_".'
	}

	return 'Review the issue message and update the manifest or implementation files accordingly.'
}

/**
 * Collect all issues for a single graphic
 */
export async function collectGraphicIssues(graphic, validator) {
	const issues = []

	// 1. JSON Parse errors
	if (graphic.manifestParseError) {
		const parseErrMsg =
			typeof graphic.manifestParseError === 'string'
				? graphic.manifestParseError
				: graphic.manifestParseError?.message || String(graphic.manifestParseError)
		issues.push({
			id: 'PARSE_ERROR',
			severity: 'error',
			message: `Manifest JSON parse error: ${parseErrMsg}`,
			fixable: false,
		})
	}

	// 2. Filename checks
	try {
		const filenameErrors = testGraphicManifestFileNames(graphic) || []
		for (const fe of filenameErrors) {
			issues.push(normalizeIssue(fe, 'error'))
		}
	} catch (_) {}

	// 3. File handler warnings
	if (graphic.warnings && Array.isArray(graphic.warnings)) {
		for (const w of graphic.warnings) {
			issues.push(normalizeIssue(w, 'warning'))
		}
	}

	// 4. Schema and semantic validation
	if (graphic.manifest) {
		if (validator) {
			try {
				const valIssues = await validator(graphic.manifest, graphic)
				if (Array.isArray(valIssues)) {
					for (const vi of valIssues) {
						issues.push(normalizeIssue(vi, 'error'))
					}
				}
			} catch (err) {
				issues.push({
					id: 'VALIDATOR_ERROR',
					severity: 'error',
					message: `Schema validator error: ${err.message || err}`,
				})
			}
		} else if (graphic.manifestIssues && Array.isArray(graphic.manifestIssues)) {
			for (const mi of graphic.manifestIssues) {
				issues.push(normalizeIssue(mi, 'error'))
			}
		}
	}

	// 5. Any module errors if present
	if (graphic.moduleErrors && Array.isArray(graphic.moduleErrors)) {
		for (const me of graphic.moduleErrors) {
			issues.push(normalizeIssue(me, 'error'))
		}
	}

	// Deduplicate issues by severity + id + message
	const seen = new Set()
	const uniqueIssues = []
	for (const issue of issues) {
		if (!issue) continue
		const norm = normalizeIssue(issue, 'error')
		const key = `${norm.severity || 'error'}:${norm.id || ''}:${norm.message || ''}`
		if (!seen.has(key)) {
			seen.add(key)
			uniqueIssues.push(norm)
		}
	}

	return uniqueIssues
}

/**
 * Matches an issue against a severity filter
 */
function matchesSeverityFilter(issue, filter) {
	if (!issue) return false
	const sev = issue.severity || 'error'
	if (filter === 'errors-only') return sev === 'error'
	if (filter === 'warnings-errors') return sev === 'error' || sev === 'warning'
	return true // 'all'
}

/**
 * Format all issues into a simple list of file paths and issue texts:
 *
 * {path to file}
 * {issue texts}
 * ...
 */
export function getAllIssuesText({
	graphicsResults = [], // array of { graphic, issues }
	severityFilter = 'all', // 'all' | 'errors-only' | 'warnings-errors'
	onlyWithIssues = true,
}) {
	// Filter issues for each graphic according to severity filter
	const processedResults = graphicsResults.map(({ graphic, issues }) => {
		const filteredIssues = (issues || []).filter((i) => matchesSeverityFilter(i, severityFilter))
		return { graphic, issues: filteredIssues }
	})

	const displayResults = onlyWithIssues ? processedResults.filter((r) => r.issues.length > 0) : processedResults

	const blocks = []

	for (const { graphic, issues } of displayResults) {
		if (!issues || issues.length === 0) continue
		const filePath = graphic.path || graphic.folderPath || 'unknown'
		const issueLines = issues
			.map((issue) => (typeof issue === 'string' ? issue : issue?.message || String(issue)).trim())
			.filter(Boolean)

		if (issueLines.length > 0) {
			blocks.push([filePath, ...issueLines].join('\n'))
		}
	}

	return blocks.length === 0 ? 'No issues found.' : blocks.join('\n\n')
}

export const generateAllIssuesReport = getAllIssuesText

/**
 * Format issues for a single graphic
 */
export function getSingleGraphicIssuesText({ graphic, issues = [] }) {
	return getAllIssuesText({
		graphicsResults: [{ graphic, issues }],
		severityFilter: 'all',
		onlyWithIssues: false,
	})
}

export const generateSingleGraphicIssuesReport = getSingleGraphicIssuesText
