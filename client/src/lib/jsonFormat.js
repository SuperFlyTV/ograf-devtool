/**
 * Detects indentation (tabs, number of spaces), line endings (CRLF vs LF),
 * and trailing newline from a JSON text string.
 *
 * @param {string} text - Raw JSON string
 * @returns {{ indent: string | undefined, newline: string, trailingNewline: boolean }}
 */
export function detectJsonFormatting(text) {
	if (typeof text !== 'string' || !text.trim()) {
		return {
			indent: '\t',
			newline: '\n',
			trailingNewline: true,
		}
	}

	// 1. Detect line endings: CRLF vs LF
	const crlfCount = (text.match(/\r\n/g) || []).length
	const lfCount = (text.match(/[^\r]\n/g) || []).length
	const newline = crlfCount > 0 && crlfCount >= lfCount ? '\r\n' : '\n'

	// 2. Detect trailing newline
	const trailingNewline = text.endsWith('\n') || text.endsWith('\r\n')

	// 3. Detect indentation
	const lines = text.split(/\r?\n/)
	let tabLinesCount = 0
	let spaceLinesCount = 0
	const spaceDiffs = new Map()
	let prevIndentSize = 0
	let firstIndentStr = null

	for (const line of lines) {
		const match = line.match(/^([ \t]+)\S/)
		if (!match) {
			if (line.trim().length > 0) {
				// Line with non-whitespace starting at column 0 (e.g. '{' or '}')
				prevIndentSize = 0
			}
			continue
		}

		const indentStr = match[1]
		if (firstIndentStr === null) {
			firstIndentStr = indentStr
		}

		if (indentStr.startsWith('\t')) {
			tabLinesCount++
		} else if (indentStr.startsWith(' ')) {
			spaceLinesCount++
			const size = indentStr.length
			if (size > prevIndentSize) {
				const diff = size - prevIndentSize
				spaceDiffs.set(diff, (spaceDiffs.get(diff) || 0) + 1)
			}
			prevIndentSize = size
		}
	}

	// If no indented lines found:
	if (firstIndentStr === null) {
		const isSingleLine = !text.includes('\n')
		return {
			indent: isSingleLine ? null : '\t',
			newline,
			trailingNewline,
		}
	}

	// If tabs dominate:
	if (tabLinesCount > spaceLinesCount) {
		return {
			indent: '\t',
			newline,
			trailingNewline,
		}
	}

	// If spaces dominate:
	if (spaceLinesCount > 0) {
		// Prefer the most frequent indentation step difference
		let bestDiff = 0
		let maxCount = 0
		for (const [diff, count] of spaceDiffs.entries()) {
			if (count > maxCount) {
				maxCount = count
				bestDiff = diff
			}
		}

		if (bestDiff > 0) {
			return {
				indent: ' '.repeat(bestDiff),
				newline,
				trailingNewline,
			}
		}

		// Fallback to the size of the first indented line
		if (firstIndentStr && firstIndentStr.startsWith(' ')) {
			return {
				indent: ' '.repeat(firstIndentStr.length),
				newline,
				trailingNewline,
			}
		}
	}

	return {
		indent: '\t',
		newline,
		trailingNewline,
	}
}

/**
 * Stringifies an object to JSON matching the provided formatting.
 *
 * @param {any} obj - Object to stringify
 * @param {{ indent?: string | number, newline?: string, trailingNewline?: boolean } | string | number} [formatting]
 * @returns {string} Formatted JSON string
 */
export function formatJson(obj, formatting) {
	let indent = '\t'
	let newline = '\n'
	let trailingNewline = true

	if (typeof formatting === 'string' || typeof formatting === 'number') {
		indent = formatting
	} else if (formatting && typeof formatting === 'object') {
		indent = formatting.indent !== undefined ? formatting.indent : '\t'
		newline = formatting.newline ?? '\n'
		trailingNewline = formatting.trailingNewline ?? true
	}

	let json = JSON.stringify(obj, null, indent)

	if (newline === '\r\n') {
		json = json.replace(/\r?\n/g, '\r\n')
	}

	if (trailingNewline) {
		json += newline
	}

	return json
}
