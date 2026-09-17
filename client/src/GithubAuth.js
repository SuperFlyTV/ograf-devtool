const TOKEN_STORAGE_KEY = 'github-oauth-token'

/**
 * Handles "Sign in with GitHub" (OAuth), so that GitHub API calls can use a higher rate limit.
 * The OAuth code<->token exchange is done by the server (see server/server.js), since it requires the client secret.
 */
class GithubAuth {
	getToken() {
		return localStorage.getItem(TOKEN_STORAGE_KEY)
	}
	signOut() {
		localStorage.removeItem(TOKEN_STORAGE_KEY)
	}

	async signIn() {
		const configRes = await fetch('/api/github/oauth/config')
		if (!configRes.ok) throw new Error('Failed to load GitHub sign-in configuration from the server.')
		const { clientId } = await configRes.json()
		if (!clientId) throw new Error('GitHub sign-in is not configured on this server (missing OGRAF_DEVTOOL_APP_ID).')

		const redirectUri = `${window.location.origin}/api/github/oauth/callback`
		console.log('redirectUri', redirectUri)
		const authorizeUrl =
			`https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
			`&scope=public_repo&redirect_uri=${encodeURIComponent(redirectUri)}`

		console.log('authorizeUrl', authorizeUrl)
		const popup = window.open(authorizeUrl, 'github-oauth', 'width=600,height=700')
		if (!popup) throw new Error('Popup was blocked. Please allow popups for this site and try again.')

		const token = await new Promise((resolve, reject) => {
			const onMessage = (event) => {
				if (event.origin !== window.location.origin) return
				if (!event.data || event.data.type !== 'github-oauth-token') return

				window.removeEventListener('message', onMessage)
				clearInterval(popupChecker)

				if (event.data.token) resolve(event.data.token)
				else reject(new Error(event.data.error || 'GitHub sign-in failed.'))
			}
			window.addEventListener('message', onMessage)

			// In case the user closes the popup without completing the sign-in:
			const popupChecker = setInterval(() => {
				if (popup.closed) {
					clearInterval(popupChecker)
					window.removeEventListener('message', onMessage)
					reject(new Error('GitHub sign-in was cancelled.'))
				}
			}, 500)
		})

		localStorage.setItem(TOKEN_STORAGE_KEY, token)
		return token
	}
}

export const githubAuth = new GithubAuth()
