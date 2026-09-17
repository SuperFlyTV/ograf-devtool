import { serviceWorkerHandler } from './ServiceWorkerHandler.js'
import { githubAuth } from './GithubAuth.js'

const OGRAF_SCHEMA_HINT = 'ograf'

// Set when the GitHub API reports 0 remaining calls, to avoid sending further requests until the rate limit resets:
let githubRateLimitResetAt = null

export function isGithubRateLimited() {
	return Boolean(githubRateLimitResetAt) && Date.now() < githubRateLimitResetAt
}

/**
 * Formats a duration (ms) as a human-readable relative time, e.g. "32 seconds", "5 minutes", "2 hours".
 */
function formatDuration(ms) {
	const seconds = Math.max(1, Math.round(ms / 1000))
	if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
	const hours = Math.round(minutes / 60)
	return `${hours} hour${hours === 1 ? '' : 's'}`
}

function githubRateLimitErrorMessage() {
	return `GitHub API rate limit exceeded. Try again in ${formatDuration(
		githubRateLimitResetAt - Date.now()
	)}, or sign in to Github.`
}

/**
 * Turns a discovery progress event (see RemoteHandler.discover()'s onProgress callback) into a human-readable string.
 */
export function formatDiscoveryProgress(progress) {
	if (!progress) return null
	if (progress.phase === 'scanning-directories') {
		return `Scanning ${progress.processed} of ${progress.total} folder${progress.total === 1 ? '' : 's'}…`
	}
	if (progress.phase === 'loading-manifests') {
		return `Loading Graphic ${progress.processed} of ${progress.total}…`
	}
	return null
}

const GITHUB_API_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const GITHUB_API_CACHE_KEY_PREFIX = 'remote-handler-github-api-cache:'

/**
 * Fetches a GitHub API url, returning the parsed JSON body.
 * Caches responses in localStorage for an hour, and tracks the "x-ratelimit-remaining"/"x-ratelimit-reset"
 * response headers, so that further calls are avoided once the (heavily rate-limited) unauthenticated quota is used up.
 */
async function fetchGithubApi(url) {
	const cacheKey = GITHUB_API_CACHE_KEY_PREFIX + url
	try {
		const cached = JSON.parse(localStorage.getItem(cacheKey))
		if (cached && Date.now() - cached.timestamp < GITHUB_API_CACHE_TTL_MS) return cached.data
	} catch (_err) {
		// Ignore corrupt/missing cache entries.
	}

	if (isGithubRateLimited()) {
		throw new Error(githubRateLimitErrorMessage())
	}

	const token = githubAuth.getToken()
	const res = await fetch(url, token ? { headers: { Authorization: `token ${token}` } } : undefined)

	if (res.status === 401 && token) {
		// The stored token is no longer valid:
		githubAuth.signOut()
	}

	const remaining = res.headers.get('x-ratelimit-remaining')
	const reset = res.headers.get('x-ratelimit-reset')
	if (remaining === '0' && reset) {
		githubRateLimitResetAt = Number(reset) * 1000
	}

	if (!res.ok) {
		if (remaining === '0') {
			throw new Error(githubRateLimitErrorMessage())
		}
		throw new Error(`GitHub API request failed for "${url}": ${res.status} ${res.statusText}`)
	}

	const data = await res.json()

	try {
		localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }))
	} catch (_err) {
		// Ignore storage errors (e.g. quota exceeded).
	}

	return data
}

/**
 * Removes any expired (or corrupt) GitHub API cache entries from localStorage.
 */
function cleanupGithubApiCache() {
	const now = Date.now()
	for (let i = localStorage.length - 1; i >= 0; i--) {
		const key = localStorage.key(i)
		if (!key || !key.startsWith(GITHUB_API_CACHE_KEY_PREFIX)) continue

		try {
			const cached = JSON.parse(localStorage.getItem(key))
			if (!cached || now - cached.timestamp >= GITHUB_API_CACHE_TTL_MS) {
				localStorage.removeItem(key)
			}
		} catch (_err) {
			localStorage.removeItem(key)
		}
	}
}

/**
 * Handles graphics that are loaded from a remote URL, instead of from a local folder.
 * The URL can point to either:
 *  1. A single Graphic manifest file.
 *  2. A "listing" of several Graphics, served by one of the known server types below.
 */
class RemoteHandler {
	constructor() {
		this.url = null
		// The base url that discovered Graphics' paths are relative to (told to the service worker, see below):
		this.baseUrl = null
	}

	async init(url, onProgress) {
		this.url = url
		cleanupGithubApiCache()
		// Let the service worker know it shouldn't warn about fetches to this origin:
		serviceWorkerHandler.addAllowedOrigin(new URL(url).origin)
		// Validate (and populate the cache) right away, so that init() fails fast on a bad url:
		await this.discover(this.url, onProgress)
	}
	close() {
		this.url = null
		this.baseUrl = null
		serviceWorkerHandler.setRemoteBaseUrl(null)
	}

	async listGraphics(onProgress) {
		if (!this.url) return []
		return this.discover(this.url, onProgress)
	}

	async discover(url, onProgress) {
		let manifest = null
		let rootJson = null
		try {
			const res = await fetch(url)
			if (res.ok) {
				const text = await res.text()
				try {
					const json = JSON.parse(text)
					rootJson = json
					if (json && typeof json.$schema === 'string' && json.$schema.toLowerCase().includes(OGRAF_SCHEMA_HINT)) {
						manifest = json
					}
				} catch (_err) {
					// Not JSON, so it's not a single manifest file.
				}
			}
		} catch (err) {
			console.warn(`Failed to fetch "${url}" directly, will attempt to treat it as a list of Graphics.`, err)
		}

		let graphics
		if (manifest) {
			// A single Graphic manifest, so its own folder is the base url:
			this.baseUrl = url.replace(/[^/]*$/, '')
			graphics = [this.manifestToGraphic(url, manifest)]
		} else {
			this.baseUrl = null
			graphics = await this.discoverGraphicsList(url, rootJson, onProgress)
		}

		// Let the service worker know how to resolve the (base-url-relative) paths of the discovered Graphics:
		serviceWorkerHandler.setRemoteBaseUrl(this.baseUrl)

		return graphics
	}

	manifestToGraphic(manifestUrl, manifest, extra) {
		const path = this.toRelativePath(manifestUrl)
		return {
			// The folder is everything up to (and including) the last "/" of the path:
			folderPath: path.replace(/[^/]*$/, ''),
			path,
			manifest,
			manifestParseError: null,
			isRemote: true,
			...extra,
		}
	}
	/**
	 * Converts an absolute url into a path relative to this.baseUrl (so it can be resolved via the service worker's
	 * "REMOTE" interception, just like local files). Urls that fall outside of this.baseUrl are kept absolute.
	 */
	toRelativePath(absoluteUrl) {
		const base = this.baseUrl?.replace(/\/+$/, '')
		if (base && absoluteUrl.startsWith(base + '/')) {
			return '/' + absoluteUrl.slice(base.length + 1)
		}
		// Prefixed with "/" so it still works as a react-router path segment (see graphicResourcePath()):
		return '/' + absoluteUrl
	}

	/**
	 * Discover a list of Graphics from a "listing" url.
	 * Dispatches to a server-specific implementation, based on the shape of the url/response.
	 */
	async discoverGraphicsList(url, rootJson, onProgress) {
		let parsed
		try {
			parsed = new URL(url)
		} catch (_err) {
			throw new Error(`"${url}" is not a valid url.`)
		}

		if (parsed.hostname === 'github.com' || parsed.hostname === 'api.github.com') {
			return this.discoverGithub(url, onProgress)
		}
		if (this.looksLikeOgrafServer(rootJson)) {
			return this.discoverOgrafServer(url)
		}
		return this.discoverGenericFileServer(url)
	}
	/**
	 * An OGraf server's root response isn't specced to have a distinctive field, so this looks for "ograf"
	 * mentioned in its (conventional) "name"/"author.url" fields, e.g.:
	 * { "name": "Simple OGraf Server", "author": { "name": "SuperFly.tv", "url": "https://github.com/SuperFlyTV/ograf-server" } }
	 */
	looksLikeOgrafServer(json) {
		if (!json || typeof json !== 'object') return false
		const name = `${json.name ?? ''}`.toLowerCase()
		const authorUrl = `${json.author?.url ?? ''}`.toLowerCase()
		return name.includes(OGRAF_SCHEMA_HINT) || authorUrl.includes(OGRAF_SCHEMA_HINT)
	}

	// ----------------------------------------------------------------------
	// 1. GitHub: discover Graphics by recursively scanning a repo (or a folder in a repo)
	//    for "*.ograf.json" manifest files, using the GitHub Contents API.
	// ----------------------------------------------------------------------
	async discoverGithub(url, onProgress) {
		const { owner, repo, ref, path } = parseGithubUrl(url)
		const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`

		serviceWorkerHandler.addAllowedOrigin('https://github.com')
		serviceWorkerHandler.addAllowedOrigin('https://api.github.com')
		serviceWorkerHandler.addAllowedOrigin('https://raw.githubusercontent.com')

		const effectiveRef = ref || (await this.getGithubDefaultBranch(owner, repo))
		// Use the "public" github.com url (rewritten to raw.githubusercontent.com when actually fetched, see service-worker.js)
		// as the base url, so that Graphic paths stay human-readable:
		this.baseUrl = `https://github.com/${owner}/${repo}/blob/${effectiveRef}${
			path ? '/' + path.replace(/\/+$/, '') : ''
		}`

		const manifestFiles = []
		const stats = { processed: 0, total: 1 }
		onProgress?.({ phase: 'scanning-directories', ...stats })
		await this.walkGithubContents(apiBase, path, ref, manifestFiles, stats, onProgress)

		const graphics = []
		for (let i = 0; i < manifestFiles.length; i++) {
			const file = manifestFiles[i]
			onProgress?.({ phase: 'loading-manifests', processed: i, total: manifestFiles.length })
			try {
				const res = await fetch(file.download_url)
				if (!res.ok) {
					console.warn(`Failed to fetch manifest "${file.path}" from GitHub: ${res.status} ${res.statusText}`)
					continue
				}
				const manifest = await res.json()
				const blobUrl = `https://github.com/${owner}/${repo}/blob/${effectiveRef}/${file.path}`
				graphics.push(this.manifestToGraphic(blobUrl, manifest))
			} catch (err) {
				console.warn(`Failed to fetch/parse manifest "${file.path}" from GitHub`, err)
			}
		}
		onProgress?.({ phase: 'loading-manifests', processed: manifestFiles.length, total: manifestFiles.length })
		return graphics
	}
	async getGithubDefaultBranch(owner, repo) {
		const info = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}`)
		return info.default_branch
	}
	async walkGithubContents(apiBase, path, ref, result, stats, onProgress) {
		const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
		const listUrl = `${apiBase}/${path}${query}`

		const entries = await fetchGithubApi(listUrl)
		stats.processed++
		onProgress?.({ phase: 'scanning-directories', ...stats })
		if (!Array.isArray(entries)) return // it was a single file, not a folder listing

		const manifestEntries = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.ograf.json'))
		if (manifestEntries.length > 0) {
			// A Graphic manifest was found in this folder, so don't look for more Graphics in its subfolders:
			result.push(...manifestEntries)
			return
		}

		const dirEntries = entries.filter((entry) => entry.type === 'dir')
		stats.total += dirEntries.length
		onProgress?.({ phase: 'scanning-directories', ...stats })
		for (const entry of dirEntries) {
			await this.walkGithubContents(apiBase, entry.path, ref, result, stats, onProgress)
		}
	}

	// ----------------------------------------------------------------------
	// 2. Generic file server: no known convention for listing files.
	// ----------------------------------------------------------------------
	// STUB: Implement discovery for plain file servers (e.g. directory listing, sitemap, index file, etc.)
	async discoverGenericFileServer(url) {
		console.warn(`Discovery of graphics on a generic file server is not implemented yet (url: "${url}")`)
		throw new Error(
			`Could not find a Graphic manifest at "${url}", and discovery of Graphics on a generic file server is not implemented yet.`
		)
	}

	// ----------------------------------------------------------------------
	// 3. OGraf server: a base url like "http://localhost:8080/api/ograf/v1/",
	//    exposing "graphics" (list) and "graphics/:graphicId" (per-graphic info) endpoints.
	// ----------------------------------------------------------------------
	async discoverOgrafServer(baseUrl) {
		const base = baseUrl.replace(/\/+$/, '')

		const listUrl = `${base}/graphics`
		const res = await fetch(listUrl)
		if (!res.ok) {
			throw new Error(`Failed to list Graphics from OGraf server at "${listUrl}": ${res.status} ${res.statusText}`)
		}
		const body = await res.json()
		const items = Array.isArray(body) ? body : body.graphics ?? []

		const graphics = []
		let anyHasContent = false
		for (const item of items) {
			const graphicId = typeof item === 'string' ? item : item.id ?? item.graphicId
			if (!graphicId) continue

			const infoUrl = `${base}/graphics/${encodeURIComponent(graphicId)}`
			try {
				const infoRes = await fetch(infoUrl)
				if (!infoRes.ok) {
					console.warn(`Failed to fetch info for Graphic "${graphicId}" from "${infoUrl}": ${infoRes.status}`)
					continue
				}
				const info = await infoRes.json()
				if (info?.metadata?.content) anyHasContent = true
				graphics.push(this.ografServerInfoToGraphic(infoUrl, info))
			} catch (err) {
				console.warn(`Failed to fetch info for Graphic "${graphicId}" from "${infoUrl}"`, err)
			}
		}

		if (graphics.length > 0 && !anyHasContent) {
			throw new Error(
				`The OGraf server at "${base}" does not expose "metadata.content" for any of its Graphics. ` +
					`This server does not appear to support serving Graphic files, so their content cannot be loaded.`
			)
		}

		return graphics
	}
	ografServerInfoToGraphic(infoUrl, info) {
		// The manifest itself is exposed under "graphic", while "metadata.content" points to where its files are served from:
		const manifest = info?.graphic ?? info?.metadata ?? info
		const content = info?.metadata?.content

		const warnings = []
		if (!content?.url) {
			warnings.push(
				`The OGraf server did not expose "metadata.content" for this Graphic. Its content cannot be loaded.`
			)
			return this.manifestToGraphic(infoUrl, manifest, { warnings })
		}

		const folderPath = content.url.endsWith('/') ? content.url : content.url + '/'
		serviceWorkerHandler.addAllowedOrigin(new URL(folderPath).origin)

		const manifestFile = (content.files ?? []).find((file) => file.path.endsWith('.ograf.json'))
		if (!manifestFile) {
			warnings.push(`Could not find a manifest file ("*.ograf.json") among this Graphic's "metadata.content.files".`)
		}
		const manifestUrl = manifestFile ? folderPath + manifestFile.path : infoUrl

		return this.manifestToGraphic(manifestUrl, manifest, { folderPath, warnings })
	}
}

/**
 * Parses a GitHub url into its constituent parts.
 * Supports:
 *  - https://github.com/{owner}/{repo}
 *  - https://github.com/{owner}/{repo}/tree/{branch}/{path}
 *  - https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}
 */
function parseGithubUrl(url) {
	const u = new URL(url)

	if (u.hostname === 'api.github.com') {
		const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/)
		if (!m) throw new Error(`Unrecognized GitHub API url: "${url}"`)
		const [, owner, repo, path] = m
		return { owner, repo, path: path || '', ref: u.searchParams.get('ref') || undefined }
	}

	const parts = u.pathname
		.replace(/^\//, '')
		.replace(/\.git$/, '')
		.split('/')
		.filter(Boolean)
	const [owner, repo, kind, ref, ...rest] = parts
	if (!owner || !repo) throw new Error(`Unrecognized GitHub url: "${url}"`)

	if (kind === 'tree' || kind === 'blob') {
		return { owner, repo, ref, path: rest.join('/') }
	}
	return { owner, repo, ref: undefined, path: '' }
}

export const remoteHandler = new RemoteHandler()
