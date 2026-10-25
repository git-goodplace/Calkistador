import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App.tsx';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('не найден #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
