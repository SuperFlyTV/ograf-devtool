import * as fs from 'fs'

/*
  This script updates a constant in two places.
  This is used for the main application to detect if the service worker is outdated.
  This script is intended to be run upon each build.
*/

const files = ['src/service-worker.js', 'src/lib/sw-version.js']

const version = new Date().toISOString()
for (const file of files) {
	const content = await fs.promises.readFile(file, 'utf-8')

	const newContent = content.replace(/SW_VERSION = '[^']+'/, `SW_VERSION = '${version}'`)

	await fs.promises.writeFile(file, newContent)
}
console.log(`Updated SW_VERSION to ${version}`)
