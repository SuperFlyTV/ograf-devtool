import * as React from 'react'
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router'

export function WorkspaceHeader({
	graphicsFolderName,
	graphicsSource = 'local',
	onRefresh,
	onCloseFolder,
	actionButtons,
	children,
	className = '',
}) {
	const isRemote = graphicsSource === 'remote'
	const isSample = graphicsFolderName?.toLowerCase().includes('sample')

	const sourceIcon = isSample ? '🚀' : isRemote ? '🌐' : '📁'
	const sourceLabel = isSample ? 'Sample Pack' : isRemote ? 'Remote URL' : 'Local Folder'

	return (
		<div className={`workspace-header-bar ${className}`}>
			<div className="workspace-title-row">
				<div className="workspace-info">
					<span
						className={`workspace-source-badge ${
							isSample ? 'source-sample' : isRemote ? 'source-remote' : 'source-local'
						}`}
					>
						<span className="source-icon">{sourceIcon}</span>
						<span className="source-label">{sourceLabel}</span>
					</span>
					<h1 className="workspace-folder-name" title={graphicsFolderName}>
						{graphicsFolderName || 'Graphics Workspace'}
					</h1>
				</div>

				<div className="workspace-primary-actions">
					{onRefresh && (
						<Button
							variant="outline-light"
							size="sm"
							className="ws-action-btn"
							onClick={onRefresh}
							title="Refresh list of graphics from disk / remote"
						>
							🔄 Refresh
						</Button>
					)}
					{onCloseFolder && (
						<Button
							variant="outline-secondary"
							size="sm"
							className="ws-action-btn"
							onClick={onCloseFolder}
							title="Close current folder and pick another folder or remote URL"
						>
							📂 Switch Folder
						</Button>
					)}
					{actionButtons}
				</div>
			</div>

			{children && <div className="workspace-sub-toolbar">{children}</div>}
		</div>
	)
}
