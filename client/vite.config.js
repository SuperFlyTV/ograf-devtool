import path from 'path'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { defineConfig } from 'vite'
import { buildSync } from 'esbuild'

// Generate version once for entire build to ensure sync between main bundle and service worker
const BUILD_VERSION = new Date().toISOString()

export default defineConfig({
	root: path.resolve(__dirname, 'src'),
	// resolve: {
	//     alias: {
	//       '~bootstrap': path.resolve(__dirname, 'node_modules/bootstrap'),
	//     }
	//   },
	server: {
		port: 8083,
	},
	build: {
		rollupOptions: {
			output: {
				assetFileNames: '[name][extname]',
				chunkFileNames: '[name].js',
				entryFileNames: '[name].js',
			},
		},
		assetsDir: '../assets',
		outDir: '../dist',
	},
	base: '/',
	define: {
		'__BUILD_VERSION__': JSON.stringify(BUILD_VERSION),
	},

	plugins: [
		// ...
		react(),
		nodePolyfills(),
		{
			apply: 'build',
			enforce: 'post',
			transformIndexHtml() {
				buildSync({
					minify: true,
					bundle: true,
					entryPoints: [path.join(process.cwd(), 'src/service-worker.js')],
					outfile: path.join(process.cwd(), 'dist/service-worker.js'),
					define: {
						'__BUILD_VERSION__': JSON.stringify(BUILD_VERSION),
					},
				})
			},
		},
	],
})
