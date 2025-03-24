import * as React from 'react'
export const SettingsContext = React.createContext(null)

export function getDefaultSettings() {
	const stored = localStorage.getItem('settings')
	if (stored) {
		try {
			return {
				...DEFAULT_SETTINGS,
				...JSON.parse(stored),
			}
		} catch (e) {
			console.error('Error parsing stored settings', e)
			return DEFAULT_SETTINGS
		}
	} else return DEFAULT_SETTINGS
}
const DEFAULT_SETTINGS = {
	realtime: true,
	width: 1280,
	height: 720,
	autoReloadEnable: false,
	duration: 3000,

	quantizeFps: 50, // non-realtime only

	viewSettingsAccordion: ['0'],
	viewCapabilitiesAccordion: ['0'],
	viewControlAccordion: ['0'],
}
