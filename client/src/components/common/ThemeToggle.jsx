import * as React from 'react'
import { Dropdown } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSun, faMoon, faDesktop, faCheck } from '@fortawesome/free-solid-svg-icons'
import { useTheme } from '../../contexts/ThemeContext'

export function ThemeToggle({ className = '', size = 'sm' }) {
	const { theme, effectiveTheme, setTheme } = useTheme()

	const currentIcon = theme === 'system' ? faDesktop : effectiveTheme === 'dark' ? faMoon : faSun
	const currentLabel = theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'

	return (
		<div className={`theme-toggle-container ${className}`}>
			<Dropdown align="end">
				<Dropdown.Toggle
					variant="outline-secondary"
					size={size}
					id="theme-toggle-dropdown"
					className="theme-toggle-btn"
					title={`Theme: ${currentLabel} (Click to change)`}
					aria-label={`Current theme: ${currentLabel}. Click to switch theme.`}
				>
					<FontAwesomeIcon icon={currentIcon} className="theme-toggle-icon" />
					<span className="theme-toggle-label d-none d-sm-inline ms-1">{currentLabel}</span>
				</Dropdown.Toggle>

				<Dropdown.Menu className="theme-dropdown-menu shadow-lg">
					<Dropdown.Item
						active={theme === 'light'}
						onClick={() => setTheme('light')}
						className="d-flex align-items-center justify-content-between theme-item"
					>
						<span className="d-flex align-items-center gap-2">
							<FontAwesomeIcon icon={faSun} className="theme-menu-icon text-warning" />
							<span>Light</span>
						</span>
						{theme === 'light' && <FontAwesomeIcon icon={faCheck} className="text-primary ms-2" />}
					</Dropdown.Item>

					<Dropdown.Item
						active={theme === 'dark'}
						onClick={() => setTheme('dark')}
						className="d-flex align-items-center justify-content-between theme-item"
					>
						<span className="d-flex align-items-center gap-2">
							<FontAwesomeIcon icon={faMoon} className="theme-menu-icon text-info" />
							<span>Dark</span>
						</span>
						{theme === 'dark' && <FontAwesomeIcon icon={faCheck} className="text-primary ms-2" />}
					</Dropdown.Item>

					<Dropdown.Divider />

					<Dropdown.Item
						active={theme === 'system'}
						onClick={() => setTheme('system')}
						className="d-flex align-items-center justify-content-between theme-item"
					>
						<span className="d-flex align-items-center gap-2">
							<FontAwesomeIcon icon={faDesktop} className="theme-menu-icon text-secondary" />
							<span>System (Auto)</span>
						</span>
						{theme === 'system' && <FontAwesomeIcon icon={faCheck} className="text-primary ms-2" />}
					</Dropdown.Item>
				</Dropdown.Menu>
			</Dropdown>
		</div>
	)
}
