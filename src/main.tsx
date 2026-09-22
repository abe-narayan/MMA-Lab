/**
 * Entry point. Mounts the app shell into #root.
 *
 * Nothing here talks to the network: the simulation, the replay data and the
 * renderer all ship inside the bundle, which is what lets the whole thing run
 * as one self-contained page.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from index.html');

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
