import React from 'react'

export function pathJoin(...paths) {
	// Collapse runs of 2+ slashes, but preserve the "://" of an absolute URL scheme.
	return paths.join('/').replace(/([^:]|^)\/{2,}/g, '$1/')
}

export function isAbsoluteUrl(str) {
	return typeof str === 'string' && /^https?:\/\//i.test(str)
}

function safeDecodeURIComponent(str) {
	try {
		return decodeURIComponent(str)
	} catch (_err) {
		return str
	}
}

// Whether Graphic resources should currently be resolved against the local folder ("LOCAL")
// or the selected remote base url ("REMOTE"), see setResourceSource()/RemoteHandler.js/service-worker.js.
let resourceSource = 'local' // 'local' | 'remote'
export function setResourceSource(source) {
	resourceSource = source
}

export function graphicResourcePath(...paths) {
	const raw = paths.join('/')

	// Some graphics carry a fully absolute url (e.g. one not relative to the shared remote base url), fetch it directly:
	if (isAbsoluteUrl(raw)) return raw
	// Graphic routing paths can be absolute urls that aren't relative to the remote base either (see RemoteHandler.js):
	const decoded = safeDecodeURIComponent(raw.replace(/^\//, ''))
	if (isAbsoluteUrl(decoded)) return decoded

	// This URL prefix causes the service-worker to intercept the request and serve the file from local disk,
	// or from the selected remote base url, depending on the current resourceSource:

	const prefix = window.location.href.includes('https') ? 'https://' : 'http://'

	const basePath = `${window.location.href}`.replace(/^https?:\/\//, '').replace(/\?.*/, '')

	const marker = resourceSource === 'remote' ? 'REMOTE' : 'LOCAL'
	return prefix + pathJoin(basePath, marker, ...paths)
}
export async function sleep(ms) {
	await new Promise((resolve) => setTimeout(resolve, ms))
}
export function usePromise(fcn, deps) {
	const [result, setResult] = React.useState(null)

	React.useEffect(() => {
		fcn()
			.then((value) => {
				setResult({ value, error: null })
			})
			.catch((error) => {
				setResult({ value: null, error })
			})
	}, deps ?? [])

	return result
}
