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
import { NotificationsScreen } from './screens/NotificationsScreen';
import { OcrImageStudioScreen } from './screens/OcrImageStudioScreen';
import { PdfStudioScreen } from './screens/PdfStudioScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SheetsStudioScreen } from './screens/SheetsStudioScreen';
import { SlidesStudioScreen } from './screens/SlidesStudioScreen';
import { StudiosHubScreen } from './screens/StudiosHubScreen';
import { WordStudioScreen } from './screens/WordStudioScreen';
import { WorkspacesScreen } from './screens/WorkspacesScreen';
import { apiClient } from './services/apiClient';
import { captureDocumentPhoto, isNativePlatform, registerAppLifecycle } from './services/nativeBridge';
import { CloudProjectDetail, MobileSubView, MobileTab } from './types';

const TAB_TITLES: Record<MobileTab, string> = {
  home: 'OmniDoc Studio',
  convert: 'Conversion Studio',
  pdf: 'PDF Studio',
  docs: 'Documents & Projects',
  profile: 'Account & Profile',
};

const SUBVIEW_TITLES: Record<Exclude<MobileSubView, 'none'>, string> = {
  word_studio: 'Word Studio',
  slides_studio: 'PowerPoint Slides',
  sheets_studio: 'Excel Sheets',
  ocr_studio: 'OCR & Image Studio',
  workspaces: 'Team Workspaces',
  studios_hub: 'Document Studios',
  history: 'Document History',
  notifications: 'Notifications',
  settings: 'Account Settings',
  admin: 'Admin Console',
  ai_assistant: 'AI Assistant',
};

const MobileShell: React.FC = () => {
  const { isBooting, isAuthenticated, isOnline, pendingDeepLink, clearPendingDeepLink } = useAuth();
  const [activeTab, setActiveTab] = useState<MobileTab>('home');
  const [subView, setSubView] = useState<MobileSubView>('none');
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [convertFile, setConvertFile] = useState<File | null>(null);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [slidesFile, setSlidesFile] = useState<File | null>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);

  const [wordProject, setWordProject] = useState<CloudProjectDetail | null>(null);
  const [slidesProject, setSlidesProject] = useState<CloudProjectDetail | null>(null);
  const [sheetProject, setSheetProject] = useState<CloudProjectDetail | null>(null);

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

  // Handle omnidoc:// deep links when authenticated
  useEffect(() => {
    if (!isAuthenticated || !pendingDeepLink) return;

    const target = `${pendingDeepLink.host}${pendingDeepLink.path}`
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
    const projectId = pendingDeepLink.params?.projectId || pendingDeepLink.params?.id;

    if ((target === 'project' || target === 'projects') && projectId && isOnline) {
      apiClient
        .getProject(projectId)
        .then((proj) => {
          if (proj.project_type === 'docx') {
            setWordFile(null);
            setWordProject(proj);
            setSubView('word_studio');
          } else if (proj.project_type === 'slides') {
            setSlidesFile(null);
            setSlidesProject(proj);
            setSubView('slides_studio');
          } else if (proj.project_type === 'sheets') {
            setSheetFile(null);
            setSheetProject(proj);
            setSubView('sheets_studio');
          } else {
            setSubView('none');
            setActiveTab('docs');
          }
        })
        .catch(() => {
          setSubView('none');
          setActiveTab('docs');
        });
      clearPendingDeepLink();
      return;
    }

    switch (target) {
      case 'home':
      case 'dashboard':
        setSubView('none');
        setActiveTab('home');
        break;
      case 'convert':
      case 'conversion_studio':
        setSubView('none');
        setActiveTab('convert');
        break;
      case 'pdf':
      case 'pdf_studio':
        setSubView('none');
        setActiveTab('pdf');
        break;
      case 'docs':
      case 'library':
      case 'documents':
        setSubView('none');
        setActiveTab('docs');
        break;
      case 'profile':
      case 'account':
        setSubView('none');
        setActiveTab('profile');
        break;
      case 'word':
      case 'word_studio':
        setSubView('word_studio');
        break;
      case 'slides':
      case 'slides_studio':
        setSubView('slides_studio');
        break;
      case 'sheets':
      case 'sheets_studio':
        setSubView('sheets_studio');
        break;
      case 'ocr':
      case 'ocr_studio':
        setSubView('ocr_studio');
        break;
      case 'workspaces':
        setSubView('workspaces');
        break;
      case 'studios':
      case 'studios_hub':
        setSubView('studios_hub');
        break;
      case 'history':
        setSubView('history');
        break;
      case 'notifications':
        setSubView('notifications');
        break;
      case 'settings':
        setSubView('settings');
        break;
      case 'admin':
        setSubView('admin');
        break;
      case 'ai':
      case 'ai_assistant':
        setSubView('ai_assistant');
        break;
      default:
        setSubView('none');
        setActiveTab('home');
        break;
    }

    clearPendingDeepLink();
  }, [isAuthenticated, isOnline, pendingDeepLink, clearPendingDeepLink]);

  const handleQuickCameraScan = async () => {
    try {
      const photo = await captureDocumentPhoto('prompt');
      const pdfBytes = await imagesToPdf([{ bytes: photo.bytes, mimeType: photo.mimeType }]);
      const scannedFile = new File([pdfBytes as any], `scan_${Date.now()}.pdf`, { type: 'application/pdf' });
      setPdfFile(scannedFile);
      setSubView('none');
      setActiveTab('pdf');
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
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 animate-pulse" />
        <p className="text-xs font-medium tracking-wide text-slate-400">Initializing Secure Vault...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  const title = subView !== 'none' ? SUBVIEW_TITLES[subView] : TAB_TITLES[activeTab];

  const renderContent = () => {
    if (subView === 'word_studio') {
      return <WordStudioScreen initialFile={wordFile} initialProject={wordProject} onToast={showToast} />;
    }
    if (subView === 'slides_studio') {
      return <SlidesStudioScreen initialFile={slidesFile} initialProject={slidesProject} onToast={showToast} />;
    }
    if (subView === 'sheets_studio') {
      return <SheetsStudioScreen initialFile={sheetFile} initialProject={sheetProject} onToast={showToast} />;
    }
    if (subView === 'ocr_studio') {
      return <OcrImageStudioScreen onToast={showToast} />;
    }
    if (subView === 'workspaces') {
      return <WorkspacesScreen onToast={showToast} />;
    }
    if (subView === 'studios_hub') {
      return (
        <StudiosHubScreen
          onNavigateTab={(t) => {
            setSubView('none');
            setActiveTab(t);
          }}
          onOpenSubView={(v) => setSubView(v)}
        />
      );
    }
    if (subView === 'history') return <HistoryScreen onToast={showToast} />;
    if (subView === 'notifications') return <NotificationsScreen onUnreadChange={setUnreadCount} onToast={showToast} />;
    if (subView === 'settings') return <SettingsScreen onToast={showToast} />;
    if (subView === 'admin') return <AdminScreen onToast={showToast} />;
    if (subView === 'ai_assistant') return <AiAssistantScreen onToast={showToast} />;

    switch (activeTab) {
      case 'home':
        return (
          <DashboardScreen
            unreadCount={unreadCount}
            onNavigateTab={(t) => {
              setSubView('none');
              setActiveTab(t);
            }}
            onOpenSubView={(v) => setSubView(v)}
            onQuickCameraScan={handleQuickCameraScan}
          />
        );
      case 'convert':
        return <ConversionStudioScreen initialFile={convertFile} onToast={showToast} />;
      case 'pdf':
        return <PdfStudioScreen initialFile={pdfFile} onToast={showToast} />;
      case 'docs':
        return (
          <LibraryScreen
            onOpenInPdfStudio={(f) => {
              setPdfFile(f);
              setSubView('none');
              setActiveTab('pdf');
            }}
            onOpenInConversionStudio={(f) => {
              setConvertFile(f);
              setSubView('none');
              setActiveTab('convert');
            }}
            onOpenInWordStudio={(f) => {
              setWordProject(null);
              setWordFile(f);
              setSubView('word_studio');
            }}
            onOpenInSlidesStudio={(f) => {
              setSlidesProject(null);
              setSlidesFile(f);
              setSubView('slides_studio');
            }}
            onOpenInSheetsStudio={(f) => {
              setSheetProject(null);
              setSheetFile(f);
              setSubView('sheets_studio');
            }}
            onOpenProjectInWordStudio={(proj) => {
              setWordFile(null);
              setWordProject(proj);
              setSubView('word_studio');
            }}
            onOpenProjectInSlidesStudio={(proj) => {
              setSlidesFile(null);
              setSlidesProject(proj);
              setSubView('slides_studio');
            }}
            onOpenProjectInSheetsStudio={(proj) => {
              setSheetFile(null);
              setSheetProject(proj);
              setSubView('sheets_studio');
            }}
            onToast={showToast}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            unreadCount={unreadCount}
            onOpenSubView={(v) => setSubView(v)}
            onToast={showToast}
          />
        );
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
