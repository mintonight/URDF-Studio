import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/app';
import { useUIStore } from '@/store';
import {
  getInitialLanguageFromUrl,
  hideSeoLanguagePathFromUserUrl,
} from '@/app/utils/initialLanguage';
import '@/styles/index.css';

// SEO emits a Chinese static entry at /zh/. Use it as an initial language hint
// for direct visits, then hide the SEO-only path before the interactive app runs.
const urlLanguage = getInitialLanguageFromUrl();
if (urlLanguage !== null) {
  useUIStore.getState().setLang(urlLanguage);
  hideSeoLanguagePathFromUserUrl();
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
