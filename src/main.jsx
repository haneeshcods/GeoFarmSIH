import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { LanguageProvider } from './contexts/LanguageContext.jsx';
import { AlertQueueProvider } from './contexts/AlertQueueContext.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <AuthProvider>
        <AlertQueueProvider>
          <App />
        </AlertQueueProvider>
      </AuthProvider>
    </LanguageProvider>
  </React.StrictMode>
);
