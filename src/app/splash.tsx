import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { bootUpdate, onUpdateProgress } from '@/services/app-update-service';
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
const CLOSE_POLL_MS = 200;

function SplashComponent() {
  const { t } = useTranslation();
  const messages = STATUS_MESSAGE_KEYS.map((key) => t(key));
  const [statusIndex, setStatusIndex] = useState(0);
  const [applying, setApplying] = useState(false);
  const [percent, setPercent] = useState(0);
  const closedRef = useRef(false);
  const bootResolvedRef = useRef(false);
  const applyingRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStatusIndex((i) => Math.min(i + 1, STATUS_MESSAGE_KEYS.length - 1));
    }, STATUS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Applies an update the user postponed earlier, before the main window opens.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    onUpdateProgress((progress) => {
      if (progress.total && progress.total > 0) {
        setPercent(Math.min(100, Math.round((progress.downloaded / progress.total) * 100)));
      }
    })
      .then((disposeListener) => {
        if (disposed) disposeListener();
        else unlisten = disposeListener;
      })
      .catch(() => {});

    bootUpdate()
      .then((state) => {
        if (disposed) return;
        applyingRef.current = state.applying;
        setApplying(state.applying);
      })
      .catch(() => {})
      .finally(() => {
        bootResolvedRef.current = true;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const total = STATUS_MESSAGE_KEYS.length * STATUS_INTERVAL_MS + 600;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (closedRef.current || !bootResolvedRef.current || applyingRef.current) return;
      if (Date.now() - startedAt < total) return;
      closedRef.current = true;
      window.clearInterval(timer);
      invoke('close_splashscreen').catch(() => {});
    }, CLOSE_POLL_MS);
    return () => window.clearInterval(timer);
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
          <div
            className={
              applying
                ? 'splash-progress-bar splash-progress-bar--determinate'
                : 'splash-progress-bar'
            }
            style={applying ? ({ '--splash-progress': `${percent}%` } as CSSProperties) : undefined}
          />
        </div>
        {applying ? (
          <div className="splash-reel">
            <p className="splash-reel-item">{t('Applying the update…')}</p>
          </div>
        ) : (
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
        )}
        <p className="splash-version">v0.4.0</p>
      </div>
    </div>
  );
}
