/**
 * Entry point. Mounts the app shell into #root.
 *
 * The simulation, the fighter catalogue and the UI ship inside the bundle and
 * make no network requests. The 3D broadcast view is the exception: it fetches
 * its body mesh, motion library, textures and broadcast font from `/assets/*`
 * (`static/assets/`, see docs/ASSETS.md) at runtime, and falls back to
 * placeholder figures if they cannot be loaded. Bouts and batches run in Web
 * Workers (separate chunks), with a main-thread fallback.
 *
 * Stylesheets are imported here, in cascade order: the base reset and shared
 * classes, then the creator and match screens, and finally the design system
 * (src/app/theme.css), whose tokens and component rules win over everything
 * before it. The Watch screen and broadcast overlay import their own sheets,
 * which read the same tokens.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import './app/base.css';
import './app/creator.css';
import './app/match.css';
import './app/theme.css';
import './app/pages.css';
import { App } from './app/App';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from index.html');

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
