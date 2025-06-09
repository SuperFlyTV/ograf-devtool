import { EventEmitter } from 'events'
import { sleep } from './lib/lib.js'

class FileHandler extends EventEmitter {
	constructor() {
		super()
		this.monitoredHandles = {}
		this.fileChangeListeners = []
		this.files = {}
		this.dirs = {}
		this.dirHandle = null
	}
	async init() {
		this.triggerMonitor().catch(console.error)

		const dirHandle = await window.showDirectoryPicker({
			id: 'ebu-graphics-devtool',
			mode: 'read',
		})
		this.dirHandle = dirHandle
	}
	close() {
		this.dirHandle = null
		this.monitoredHandles = {}
		this.fileChangeListeners = []
		this.files = {}
		this.dirs = {}
	}
	async discoverFilesInDirectory(path, dirHandle) {
		for await (const [key, handle] of dirHandle.entries()) {
			// Optimization
			if (handle.name === '.git') continue
			if (handle.name === 'node_modules') continue

			const subPath = path + '/' + handle.name

			if (handle.kind === 'directory') {
				this.dirs[subPath] = {
					dirHandle: handle,
				}
				await this.discoverFilesInDirectory(subPath, handle)
			} else {
				this.files[subPath] = {
					dirHandle,
					handle,
				}
			}
		}
	}
	async discoverFiles() {
		this.dirs = {}
		this.files = {}
		await this.discoverFilesInDirectory('', this.dirHandle)
	}
	async listGraphics() {
		// discover all files in the directory:
		await this.discoverFiles()

		// List all graphics in the directory:
		const graphics = []
		for (const [key, file] of Object.entries(this.files)) {
			if (await this.isManifestFile(file.handle.name, async () => (await file.handle.getFile()).text())) {
				const graphic = {
					path: key,
					folderPath: key.slice(0, -file.handle.name.length),
				}
				graphics.push(graphic)

				// Check if the manifest is correct
				const manifestStr = await (await file.handle.getFile()).text()
				let manifest = null
				try {
					manifest = JSON.parse(manifestStr)
				} catch (e) {
					console.error(`Error parsing manifest.json (${key}): `)
					graphic.manifestParseError = e
					continue
				}
				graphic.manifest = manifest
			}
		}

		return graphics
	}
	async isManifestFile(filePath, getFileContents) {
		if (!filePath.endsWith('.json')) return false

		// Use content to determine which files are manifest files:
		//{
		//  "$schema": "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json"
		//}

		// console.log("---", filePath);
		const fileContents = await getFileContents()
		let contentStr = undefined
		if (fileContents instanceof Buffer) {
			try {
				contentStr = fileContents.toString('utf8')
			} catch (_err) {
				// console.log(`isManifestFile "${filePath}" check failed`, _err)
				return false
			}
		} else if (typeof fileContents === 'string') {
			contentStr = fileContents
		}
		// const contentStr = await fs.promises.readFile(filePath, "utf-8");
		const expectSchemaContent = `https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json`
		if (
			!(
				typeof contentStr === 'string' &&
				contentStr.includes(`"$schema"`) &&
				contentStr.includes(`"${expectSchemaContent}"`)
			)
		) {
			// console.log(`isManifestFile "${filePath}" check failed`, 'initial content')
			return false
		}

		// Check that it's valid JSON:
		try {
			const content = JSON.parse(contentStr)

			if (content.$schema !== expectSchemaContent) {
				// console.log(`isManifestFile "${filePath}" check failed`, 'bad $schema', content.$schema, expectSchemaContent)
				return false
			}

			return true
		} catch (err) {
			// console.error(`isManifestFile "${filePath}" check failed`, 'Invalid JSON in manifest file', filePath, err)
			return false
		}
	}

	async readFile(path) {
		try {
			// remove any query parameters:
			path = path.replace(/\?.*/, '')

			let f = this.files[path]
			if (!f) {
				const dirPath = path.replace(/\/[^/]+$/, '')
				const dir = this.dirs[dirPath]
				if (dir) {
					// reload files in parent directory:
					await this.discoverFilesInDirectory(dirPath, dir.dirHandle)
				}
				// Try again:
				f = this.files[path]
			}
			if (!f) {
				throw new Error(`File not found: "${path}"`)
			}

			this.monitorFile(path, f.handle)

			const file = await f.handle.getFile()

			return {
				size: file.size,
				name: file.name,
				type: file.type,
				arrayBuffer: await file.arrayBuffer(),
			}
		} catch (error) {
			if (`${error}`.includes('NotAllowedError')) {
				this.emit('lostAccess')
			}
			throw error
		}
	}

	monitorFile(path, fileHandle) {
		if (this.monitoredHandles[path]) return // ignore

		this.monitoredHandles[path] = {
			handle: fileHandle,
			exists: true,
			checked: false,
		}
	}
	async triggerMonitor() {
		for (const [key, mon] of Object.entries(this.monitoredHandles)) {
			const props = {
				exists: mon.exists,
				size: mon.size,
				lastModified: mon.lastModified,
			}

			try {
				const file = await mon.handle.getFile()
				props.exists = true
				props.size = file.size
				props.lastModified = file.lastModified
			} catch (e) {
				if (e.name === 'NotFoundError') {
					props.exists = false
				} else {
					throw e
				}
			}
			const changed = mon.exists !== props.exists || mon.size !== props.size || mon.lastModified !== props.lastModified
			const checked = mon.checked
			mon.checked = true
			mon.exists = props.exists
			mon.size = props.size
			mon.lastModified = props.lastModified

			if (checked && changed) {
				// Sleep a bit, to allow for multiple files saves to settle
				await sleep(100)
				console.log(`File ${key} has changed`)
				// First, reset all monitors, so that they'll not retrigger right away:
				for (const mon of Object.values(this.monitoredHandles)) {
					mon.checked = false
				}
				this.fileHasChanged()
				break
			}
		}
		setTimeout(() => {
			this.triggerMonitor().catch(console.error)
		}, 1000)
	}
	fileHasChanged() {
		for (const fileChangeListener of this.fileChangeListeners) {
			fileChangeListener()
		}
	}
	listenToFileChanges(cb) {
		this.fileChangeListeners.push(cb)
		return {
			stop: () => {
				const i = this.fileChangeListeners.findIndex((c) => c === cb)
				if (i === -1) throw new Error('stop: no index found for callback')
				this.fileChangeListeners.splice(i, 1)
			},
		}
	}
}

export const fileHandler = new FileHandler()
