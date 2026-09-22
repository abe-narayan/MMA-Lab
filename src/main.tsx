/**
 * Entry point. Mounts the app shell into #root.
 *
 * Nothing here talks to the network: the simulation, the replay data and the
 * renderer all ship inside the bundle, which is what lets the whole thing run
 * as one self-contained page.
 *
 * The shell is `src/app/App` from Phase 6 on. It still renders the legacy
 * `src/ui` Replay, Dashboard and Model views alongside the new fighter screens;
 * Phase 7 retires those three. The stylesheets are imported here, in cascade
 * order, so the creator's rules land after the ones they build on rather than
 * wherever the module graph happens to put them.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import './app/creator.css';
import { App } from './app/App';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from index.html');

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
