import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import './splash.css';

export const Route = createFileRoute('/splash')({
  component: SplashComponent,
});

const STATUS_MESSAGE_KEYS = [
  'Starting Lumen…',
  'Loading media library…',
  'Preparing presentation…',
  'Loading modules…',
  'Almost there…',
];

const STATUS_INTERVAL_MS = 520;

function SplashComponent() {
  const { t } = useTranslation();
  const messages = STATUS_MESSAGE_KEYS.map((key) => t(key));
  const [statusIndex, setStatusIndex] = useState(0);
  const closedRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStatusIndex((i) => Math.min(i + 1, STATUS_MESSAGE_KEYS.length - 1));
    }, STATUS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const total = STATUS_MESSAGE_KEYS.length * STATUS_INTERVAL_MS + 600;
    const timer = window.setTimeout(() => {
      if (closedRef.current) return;
      closedRef.current = true;
      invoke('close_splashscreen').catch(() => {});
    }, total);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="splash-root">
      <div className="splash-backdrop">
        <div className="splash-blob splash-blob--cyan" />
        <div className="splash-blob splash-blob--blue" />
        <div className="splash-blob splash-blob--violet" />
      </div>
      <div className="splash-card">
        <div className="splash-logo-wrap">
          <img src="/logo.png" alt="lumen" className="splash-logo" />
        </div>
        <h1 className="splash-title">lumen</h1>
        <p className="splash-subtitle">{t('Live presentations, under your control.')}</p>
        <div className="splash-progress">
          <div className="splash-progress-bar" />
        </div>
        <div className="splash-reel">
          <div
            className="splash-reel-strip"
            style={{
              transform: `translateY(-${(statusIndex * 100) / messages.length}%)`,
            }}
          >
            {messages.map((message) => (
              <p key={message} className="splash-reel-item">
                {message}
              </p>
            ))}
          </div>
        </div>
        <p className="splash-version">v0.4.0</p>
      </div>
    </div>
  );
}