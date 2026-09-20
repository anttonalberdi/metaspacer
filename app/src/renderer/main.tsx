import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('The renderer root element is missing.');
}

if (window.metaspacer?.platform) {
  document.documentElement.dataset.platform = window.metaspacer.platform;
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
