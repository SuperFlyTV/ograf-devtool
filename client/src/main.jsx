import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import { App } from './App.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'

// Import our custom CSS
import './scss/styles.scss'

ReactDOM.createRoot(document.getElementById('root')).render(
	<React.StrictMode>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</React.StrictMode>
)

