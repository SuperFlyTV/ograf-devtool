import React from 'react'

export function pathJoin(...paths) {
	return paths.join('/').replace(/\/+/g, '/')
}
export function graphicResourcePath(...paths) {
	// This URL prefix causes the service-worker to intercept the requests and serve the file from the local file system:

	const prefix = window.location.href.includes('https') ? 'https://' : 'http://'

	const basePath = `${window.location.href}`.replace(/^https?:\/\//, '').replace(/\?.*/, '')

	return prefix + pathJoin(basePath, `LOCAL`, ...paths)
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
