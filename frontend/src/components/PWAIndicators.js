import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, X } from 'lucide-react';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      data-testid="offline-banner"
      className="fixed top-0 left-0 right-0 z-[100] bg-amber-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>You're offline. Some features may be unavailable.</span>
    </div>
  );
}

export function UpdateNotification() {
  const [showUpdate, setShowUpdate] = useState(false);

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'SW_UPDATED') {
        setShowUpdate(true);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, []);

  if (!showUpdate) return null;

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div
      data-testid="update-notification"
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 text-sm max-w-sm"
    >
      <RefreshCw className="w-4 h-4 shrink-0" />
      <span>New version available</span>
      <button
        data-testid="update-reload-btn"
        onClick={handleRefresh}
        className="bg-white text-slate-900 px-3 py-1 rounded text-xs font-semibold hover:bg-slate-100 transition-colors"
      >
        Reload
      </button>
      <button
        data-testid="update-dismiss-btn"
        onClick={() => setShowUpdate(false)}
        className="text-slate-400 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
