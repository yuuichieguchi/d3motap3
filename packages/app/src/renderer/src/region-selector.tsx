import React from 'react'
import { createRoot } from 'react-dom/client'
import { RegionSelectorOverlay } from './components/RegionSelectorOverlay'

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <RegionSelectorOverlay />
  </React.StrictMode>
)
