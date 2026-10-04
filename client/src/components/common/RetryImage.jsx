import * as React from 'react'

/**
 * An <img> wrapper that automatically retries loading if it encounters an error
 * (e.g., when a file was just written to disk and the service worker / filesystem
 * is still settling or indexing).
 */
export function RetryImage({
	src,
	alt = '',
	className = '',
	style = {},
	maxRetries = 5,
	initialDelay = 300,
	onLoad,
	onError,
	fallback = null,
	...rest
}) {
	const [retryCount, setRetryCount] = React.useState(0)
	const [hasError, setHasError] = React.useState(false)
	const [isLoaded, setIsLoaded] = React.useState(false)
	const retryTimerRef = React.useRef(null)

	// Reset state whenever the source URL changes
	React.useEffect(() => {
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current)
			retryTimerRef.current = null
		}
		setRetryCount(0)
		setHasError(false)
		setIsLoaded(false)
	}, [src])

	// Clean up timer on unmount
	React.useEffect(() => {
		return () => {
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current)
			}
		}
	}, [])

	const handleImageError = React.useCallback(
		(e) => {
			if (retryCount < maxRetries) {
				const delay = initialDelay * (retryCount + 1)
				if (retryTimerRef.current) {
					clearTimeout(retryTimerRef.current)
				}
				retryTimerRef.current = setTimeout(() => {
					setRetryCount((prev) => prev + 1)
				}, delay)
			} else {
				setHasError(true)
				if (onError) onError(e)
			}
		},
		[retryCount, maxRetries, initialDelay, onError]
	)

	const handleImageLoad = React.useCallback(
		(e) => {
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current)
				retryTimerRef.current = null
			}
			setIsLoaded(true)
			setHasError(false)
			if (onLoad) onLoad(e)
		},
		[onLoad]
	)

	if (hasError && fallback) {
		return fallback
	}

	// Append retry cache-buster if retrying
	let effectiveSrc = src
	if (retryCount > 0 && typeof src === 'string') {
		const separator = src.includes('?') ? '&' : '?'
		effectiveSrc = `${src}${separator}_retry=${retryCount}_${Date.now()}`
	}

	return (
		<img
			src={effectiveSrc}
			alt={alt}
			className={`${className} ${!isLoaded && retryCount > 0 ? 'img-retrying' : ''}`}
			style={style}
			onError={handleImageError}
			onLoad={handleImageLoad}
			{...rest}
		/>
	)
}
