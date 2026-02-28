import React from 'react'
import { createRoot } from 'react-dom/client'
import { MixerWindow } from './components/MixerWindow'
import './styles/mixer.css'

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <MixerWindow />
  </React.StrictMode>
)
