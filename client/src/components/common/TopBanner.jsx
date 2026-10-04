import * as React from 'react'
import { Link } from 'react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import superFlyLogoUrl from '../../assets/SuperFly.tv_Logo_2020_v02.png'
import { ThemeToggle } from './ThemeToggle'

export function TopBanner({
	folderName,
	graphicsSource,
	onCloseFolder,
	onBack,
	backLabel = 'Back to list',
	breadcrumbs,
	rightContent,
	children,
	className = '',
}) {
	const isWorkspaceMode = !!(folderName || onCloseFolder || onBack || (breadcrumbs && breadcrumbs.length > 0))

	if (!isWorkspaceMode) {
		// Front page / Landing banner as-is with theme toggle
		return (
			<header className={`dashboard-top-banner ${className}`}>
				<div className="banner-badge">
					<span className="badge-label">A tool provided by</span>
					<a href="https://superfly.tv" target="_blank" rel="noreferrer" className="superfly-link">
						<img src={superFlyLogoUrl} alt="SuperFly.tv" height="22" />
					</a>
				</div>
				<div className="banner-links">
					{rightContent}
					<a
						href="https://github.com/SuperFlyTV/ograf-devtool"
						target="_blank"
						rel="noreferrer"
						className="banner-nav-link d-none d-md-inline"
					>
						OGraf DevTool on GitHub
					</a>
					<a
						href="https://ograf.ebu.io"
						target="_blank"
						rel="noreferrer"
						className="banner-nav-link d-none d-md-inline"
					>
						OGraf Specification
					</a>
					<ThemeToggle />
					{children}
				</div>
			</header>
		)
	}

	// Workspace / Sub-page header with breadcrumbs, navigation, and theme toggle
	const isRemote = graphicsSource === 'remote'
	const isSample = folderName?.toLowerCase().includes('sample')
	const sourceIcon = isSample ? '🚀' : isRemote ? '🌐' : '📁'
	const sourceLabel = isSample ? 'Sample Pack' : isRemote ? 'Remote URL' : 'Local Folder'

	return (
		<header className={`dashboard-top-banner workspace-top-banner ${className}`}>
			<div className="banner-left">
				<a
					href="https://superfly.tv"
					target="_blank"
					rel="noreferrer"
					className="superfly-link superfly-brand"
					title="Provided by SuperFly.tv"
				>
					<img src={superFlyLogoUrl} alt="SuperFly.tv" height="20" />
				</a>

				<span className="banner-divider">/</span>

				{onBack ? (
					<button type="button" className="banner-nav-btn" onClick={onBack} title={backLabel}>
						<FontAwesomeIcon icon={faArrowLeft} />
						<span className="btn-text">{backLabel}</span>
					</button>
				) : onCloseFolder ? (
					<button type="button" className="banner-nav-btn" onClick={onCloseFolder} title="Switch folder or remote URL">
						<FontAwesomeIcon icon={faArrowLeft} />
						<span className="btn-text">Switch Folder</span>
					</button>
				) : null}

				{graphicsSource && (
					<span
						className={`banner-source-badge ${
							isSample ? 'source-sample' : isRemote ? 'source-remote' : 'source-local'
						}`}
					>
						<span className="badge-icon">{sourceIcon}</span>
						<span className="badge-text">{sourceLabel}</span>
					</span>
				)}

				{breadcrumbs && breadcrumbs.length > 0 ? (
					<nav className="banner-breadcrumbs" aria-label="breadcrumb">
						{breadcrumbs.map((crumb, idx) => (
							<React.Fragment key={idx}>
								<span className="crumb-separator">/</span>
								{crumb.to ? (
									<Link to={crumb.to} className="crumb-link">
										{crumb.label}
									</Link>
								) : crumb.onClick ? (
									<button type="button" className="crumb-btn" onClick={crumb.onClick}>
										{crumb.label}
									</button>
								) : (
									<span className="crumb-current" title={crumb.label}>
										{crumb.label}
									</span>
								)}
							</React.Fragment>
						))}
					</nav>
				) : folderName ? (
					<span className="banner-current-folder" title={folderName}>
						{folderName}
					</span>
				) : null}
			</div>

			<div className="banner-right">
				{rightContent}
				<ThemeToggle />
				{children}
			</div>
		</header>
	)
}
