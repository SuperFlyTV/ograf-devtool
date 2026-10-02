import * as React from 'react'

export const ThemeContext = React.createContext({
	theme: 'system',
	effectiveTheme: 'dark',
	setTheme: () => {},
	isDark: true,
	isLight: false,
	isSystem: true,
})

const THEME_STORAGE_KEY = 'ograf-theme-preference'

function getSystemTheme() {
	if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme() {
	if (typeof window === 'undefined' || !window.localStorage) return 'system'
	const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
	if (stored === 'light' || stored === 'dark' || stored === 'system') {
		return stored
	}
	return 'system'
}

export function ThemeProvider({ children }) {
	const [theme, setThemeState] = React.useState(getStoredTheme)
	const [systemTheme, setSystemTheme] = React.useState(getSystemTheme)

	// Listen for OS system theme changes
	React.useEffect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
		const handleChange = (e) => {
			setSystemTheme(e.matches ? 'dark' : 'light')
		}

		// Modern event listener with fallback
		if (mediaQuery.addEventListener) {
			mediaQuery.addEventListener('change', handleChange)
			return () => mediaQuery.removeEventListener('change', handleChange)
		} else if (mediaQuery.addListener) {
			mediaQuery.addListener(handleChange)
			return () => mediaQuery.removeListener(handleChange)
		}
	}, [])

	const effectiveTheme = theme === 'system' ? systemTheme : theme

	// Apply data-bs-theme and data-theme to document root
	React.useEffect(() => {
		const root = document.documentElement
		root.setAttribute('data-bs-theme', effectiveTheme)
		root.setAttribute('data-theme', effectiveTheme)
		root.style.colorScheme = effectiveTheme
	}, [effectiveTheme])

	const setTheme = React.useCallback((newTheme) => {
		if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'system') {
			setThemeState(newTheme)
			try {
				window.localStorage.setItem(THEME_STORAGE_KEY, newTheme)
			} catch (err) {
				console.error('Failed to save theme preference', err)
			}
		}
	}, [])

	const value = React.useMemo(
		() => ({
			theme,
			effectiveTheme,
			setTheme,
			isDark: effectiveTheme === 'dark',
			isLight: effectiveTheme === 'light',
			isSystem: theme === 'system',
		}),
		[theme, effectiveTheme, setTheme]
	)

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
	return React.useContext(ThemeContext)
}
