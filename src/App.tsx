import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { MobileLayout } from './components/MobileLayout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { imagesToPdf } from './engines/pdfService';
import { AdminScreen } from './screens/AdminScreen';
import { AiAssistantScreen } from './screens/AiAssistantScreen';
import { AuthScreen } from './screens/AuthScreen';
import { ConversionStudioScreen } from './screens/ConversionStudioScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { MoreScreen } from './screens/MoreScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { PdfStudioScreen } from './screens/PdfStudioScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SheetsStudioScreen } from './screens/SheetsStudioScreen';
import { StudiosHubScreen } from './screens/StudiosHubScreen';
import { apiClient } from './services/apiClient';
import { captureDocumentPhoto, isNativePlatform, registerAppLifecycle } from './services/nativeBridge';
import { MobileSubView, MobileTab } from './types';

const TAB_TITLES: Record<MobileTab, string> = {
  home: 'OmniDoc Studio',
  library: 'Document Library',
  studios: 'Document Studios',
  activity: 'Processing History',
  more: 'Account & Tools',
};

const SUBVIEW_TITLES: Record<Exclude<MobileSubView, 'none'>, string> = {
  pdf_studio: 'PDF Studio',
  conversion_studio: 'Conversion Studio',
  sheets_studio: 'Excel Sheets',
  notifications: 'Notifications',
  profile: 'User Profile',
  settings: 'Account Settings',
  admin: 'Admin Console',
  ai_assistant: 'AI Assistant',
};

const MobileShell: React.FC = () => {
  const { isBooting, isAuthenticated, isOnline } = useAuth();
  const [activeTab, setActiveTab] = useState<MobileTab>('home');
  const [subView, setSubView] = useState<MobileSubView>('none');
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [convertFile, setConvertFile] = useState<File | null>(null);

  const showToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      SplashScreen.hide().catch(() => {});
    }
    return registerAppLifecycle({
      onBackButton: () => {
        setSubView((prev) => {
          if (prev !== 'none') return 'none';
          setActiveTab((tab) => (tab !== 'home' ? 'home' : tab));
          return 'none';
        });
      },
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isOnline) return;
    apiClient
      .listNotifications({ status: 'unread', limit: 1 })
      .then((res) => setUnreadCount(res.unread_count || 0))
      .catch(() => {});
  }, [isAuthenticated, isOnline]);

  const handleQuickCameraScan = async () => {
    try {
      const photo = await captureDocumentPhoto('prompt');
      const pdfBytes = await imagesToPdf([{ bytes: photo.bytes, mimeType: photo.mimeType }]);
      const scannedFile = new File([pdfBytes as any], `scan_${Date.now()}.pdf`, { type: 'application/pdf' });
      setPdfFile(scannedFile);
      setActiveTab('studios');
      setSubView('pdf_studio');
      showToast('success', 'Scan converted to PDF in PDF Studio.');
    } catch (err: any) {
      if (!String(err?.message || '').toLowerCase().includes('cancel')) {
        showToast('error', err?.message || 'Camera scan failed');
      }
    }
  };

  if (isBooting) {
    return (
      <div className="h-full bg-[#0B1120] flex flex-col items-center justify-center gap-3 text-slate-300">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 animate-pulse" />
        <p className="text-xs font-medium tracking-wide text-slate-400">Initializing Secure Vault...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  const title = subView !== 'none' ? SUBVIEW_TITLES[subView] : TAB_TITLES[activeTab];

  const renderContent = () => {
    if (subView === 'pdf_studio') return <PdfStudioScreen initialFile={pdfFile} onToast={showToast} />;
    if (subView === 'conversion_studio') return <ConversionStudioScreen initialFile={convertFile} onToast={showToast} />;
    if (subView === 'sheets_studio') return <SheetsStudioScreen initialFile={sheetFile} onToast={showToast} />;
    if (subView === 'notifications') return <NotificationsScreen onUnreadChange={setUnreadCount} onToast={showToast} />;
    if (subView === 'profile') return <ProfileScreen onToast={showToast} />;
    if (subView === 'settings') return <SettingsScreen onToast={showToast} />;
    if (subView === 'admin') return <AdminScreen onToast={showToast} />;
    if (subView === 'ai_assistant') return <AiAssistantScreen onToast={showToast} />;

    switch (activeTab) {
      case 'home':
        return (
          <DashboardScreen
            onNavigateTab={(t) => {
              setSubView('none');
              setActiveTab(t);
            }}
            onOpenSubView={(v) => setSubView(v)}
            onQuickCameraScan={handleQuickCameraScan}
          />
        );
      case 'library':
        return (
          <LibraryScreen
            onOpenInPdfStudio={(f) => {
              setPdfFile(f);
              setSubView('pdf_studio');
            }}
            onOpenInSheetsStudio={(f) => {
              setSheetFile(f);
              setSubView('sheets_studio');
            }}
            onOpenInConverter={(f) => {
              setConvertFile(f);
              setSubView('conversion_studio');
            }}
            onToast={showToast}
          />
        );
      case 'studios':
        return <StudiosHubScreen onOpenSubView={(v) => setSubView(v)} />;
      case 'activity':
        return <HistoryScreen onToast={showToast} />;
      case 'more':
        return <MoreScreen unreadCount={unreadCount} onOpenSubView={(v) => setSubView(v)} />;
    }
  };

  return (
    <MobileLayout
      activeTab={activeTab}
      subView={subView}
      title={title}
      isOnline={isOnline}
      unreadNotifications={unreadCount}
      toast={toast}
      onDismissToast={() => setToast(null)}
      onSelectTab={(t) => {
        setSubView('none');
        setActiveTab(t);
      }}
      onBack={() => setSubView('none')}
      onOpenNotifications={() => setSubView('notifications')}
    >
      {renderContent()}
    </MobileLayout>
  );
};

export function App() {
  return (
    <AuthProvider>
      <MobileShell />
    </AuthProvider>
  );
}

export default App;
