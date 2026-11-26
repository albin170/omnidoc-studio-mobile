import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MobileLayout } from '../components/MobileLayout';
import { AdminScreen } from '../screens/AdminScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { apiClient } from '../services/apiClient';
import { AuthSessionMeta } from '../types';

const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

function makeUser(role: AuthSessionMeta['role']): AuthSessionMeta {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 'tester@omnidoc.local',
    fullName: 'Test User',
    role,
    planTier: 'pro',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
  };
}

describe('Mobile React UI Components & Security Guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockUseAuth.mockReturnValue({
      isBooting: false,
      isAuthenticated: true,
      isOnline: true,
      user: makeUser('user'),
      entitlements: null,
      uiConfig: null,
      sessionNotice: null,
      isAdmin: false,
      pendingDeepLink: null,
      clearPendingDeepLink: vi.fn(),
      clearSessionNotice: vi.fn(),
      login: vi.fn().mockResolvedValue(undefined),
      register: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      updateLocalUser: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renders AuthScreen modes, admin toggle, and submits login credentials cleanly', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    const clearNoticeMock = vi.fn();
    mockUseAuth.mockReturnValue({
      login: loginMock,
      register: vi.fn().mockResolvedValue(undefined),
      sessionNotice: null,
      clearSessionNotice: clearNoticeMock,
    });

    render(<AuthScreen />);

    expect(screen.getByRole('heading', { name: /OmniDoc Studio/i })).toBeTruthy();

    // Switch to Register tab and confirm consent checkboxes appear
    fireEvent.click(screen.getByRole('tab', { name: 'Register' }));
    expect(screen.getByLabelText(/Accept Terms of Service/i)).toBeTruthy();

    // Switch back to Sign In and toggle Admin Portal Sign-In
    fireEvent.click(screen.getByRole('tab', { name: 'Sign In' }));
    const adminSwitch = screen.getByRole('switch', { name: /Toggle admin login mode/i });
    fireEvent.click(adminSwitch);
    expect(adminSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecretPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In as Administrator/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin@example.com', 'SecretPass123!', true);
    });
  });

  it('renders ConfirmDialog with accessibility attributes and handles confirm, cancel, and Escape key', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <ConfirmDialog
        open
        title="Delete Document"
        message="This action permanently deletes the document."
        confirmLabel="Delete"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Delete Document')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog
        open={false}
        title="Hidden"
        message="Should not render"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders MobileLayout 5-tab navigation (Home, Convert, PDF, Docs, Profile) and handles tab & back callbacks', () => {
    const onSelectTab = vi.fn();
    const onBack = vi.fn();
    const onOpenNotifications = vi.fn();

    const { rerender } = render(
      <MobileLayout
        activeTab="pdf"
        subView="none"
        title="PDF Studio"
        isOnline
        unreadNotifications={3}
        toast={null}
        onDismissToast={vi.fn()}
        onSelectTab={onSelectTab}
        onBack={onBack}
        onOpenNotifications={onOpenNotifications}
      >
        <div>PDF Workspace</div>
      </MobileLayout>
    );

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const navButtons = nav.querySelectorAll('button');
    expect(navButtons).toHaveLength(5);
    expect(Array.from(navButtons).map((b) => b.textContent?.trim())).toEqual([
      'Home',
      'Convert',
      'PDF',
      'Docs',
      'Profile',
    ]);

    expect(screen.getByRole('button', { name: 'PDF' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(onSelectTab).toHaveBeenCalledWith('convert');

    fireEvent.click(screen.getByRole('button', { name: /Notifications \(3 unread\)/i }));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);

    rerender(
      <MobileLayout
        activeTab="profile"
        subView="settings"
        title="Account Settings"
        isOnline={false}
        unreadNotifications={0}
        toast={null}
        onDismissToast={vi.fn()}
        onSelectTab={onSelectTab}
        onBack={onBack}
        onOpenNotifications={onOpenNotifications}
      >
        <div>Settings Body</div>
      </MobileLayout>
    );

    expect(screen.getByText('Offline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('blocks standard users on AdminScreen with 403 Forbidden guard and avoids admin API calls', async () => {
    const telSpy = vi.spyOn(apiClient, 'getAdminTelemetry');
    const onToast = vi.fn();

    const { rerender } = render(<AdminScreen onToast={onToast} />);
    expect(screen.getByText(/403 Forbidden/i)).toBeTruthy();
    expect(telSpy).not.toHaveBeenCalled();

    // Verify admin user renders live telemetry cleanly
    mockUseAuth.mockReturnValue({
      isBooting: false,
      isAuthenticated: true,
      isOnline: true,
      user: makeUser('admin'),
      isAdmin: true,
    });
    telSpy.mockResolvedValue({
      total_users: 12,
      active_users: 10,
      total_documents: 45,
      total_storage_bytes: 1048576,
      total_jobs: 9,
      failed_jobs: 0,
      environment: 'production',
    });
    vi.spyOn(apiClient, 'getAdminUsers').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getAdminUiConfig').mockResolvedValue({ announcement_banner: '', maintenance_mode: false });
    vi.spyOn(apiClient, 'getAdminAuditLogs').mockResolvedValue([]);

    rerender(<AdminScreen onToast={onToast} />);
    await waitFor(() => {
      expect(screen.getByText(/Platform Telemetry/i)).toBeTruthy();
      expect(screen.getByText('45')).toBeTruthy();
    });
  });
});
