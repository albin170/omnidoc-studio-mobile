import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { envManager } from '../config/env';
import { apiClient, ApiError } from '../services/apiClient';
import {
  DeepLinkEvent,
  getNetworkConnected,
  registerAppLifecycle,
  subscribeNetworkChanges,
} from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { isJwtExpired, secureStorage } from '../services/secureStorage';
import { AuthSessionMeta, BackendRegisterPayload, PlanTier, UserEntitlements, UserRole, UserUiConfig } from '../types';

interface AuthContextValue {
  isBooting: boolean;
  isAuthenticated: boolean;
  isOnline: boolean;
  user: AuthSessionMeta | null;
  entitlements: UserEntitlements | null;
  uiConfig: UserUiConfig | null;
  sessionNotice: string | null;
  pendingDeepLink: DeepLinkEvent | null;
  isAdmin: boolean;
  clearSessionNotice: () => void;
  clearPendingDeepLink: () => void;
  login: (email: string, password: string, adminMode?: boolean) => Promise<void>;
  register: (payload: BackendRegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateLocalUser: (patch: Partial<AuthSessionMeta>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isBooting, setIsBooting] = useState(true);
  const [user, setUser] = useState<AuthSessionMeta | null>(null);
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(null);
  const [uiConfig, setUiConfig] = useState<UserUiConfig | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<DeepLinkEvent | null>(null);

  const wipeLocalSession = useCallback(async (notice?: string) => {
    apiClient.setToken(null);
    await secureStorage.clearAll();
    await offlineStore.clearUserCaches();
    setUser(null);
    setEntitlements(null);
    setUiConfig(null);
    if (notice) setSessionNotice(notice);
  }, []);

  const hydrateUserState = useCallback(async (fallbackMeta?: AuthSessionMeta | null) => {
    try {
      const [me, ent, cfg] = await Promise.all([
        apiClient.getMe(),
        apiClient.getEntitlements().catch(() => null),
        apiClient.getUiConfig().catch(() => null),
      ]);
      const token = apiClient.getToken();
      const updatedMeta: AuthSessionMeta = {
        userId: me.id,
        orgId: me.org_id,
        email: me.email,
        fullName: me.full_name,
        role: (me.role || 'user') as UserRole,
        planTier: ((ent?.plan_slug || fallbackMeta?.planTier || 'free') as PlanTier),
        issuedAt: fallbackMeta?.issuedAt || Date.now(),
        expiresAt: fallbackMeta?.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
        termsAccepted: Boolean(me.terms_accepted),
        privacyAccepted: Boolean(me.privacy_accepted),
        aiConsent: Boolean(me.ai_consent),
        marketingConsent: Boolean(me.marketing_consent),
      };
      if (token) {
        await secureStorage.saveSession(token, updatedMeta);
      }
      setUser(updatedMeta);
      if (ent) {
        setEntitlements(ent);
        await offlineStore.cacheEntitlements(ent);
      }
      if (cfg) {
        setUiConfig(cfg);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        await wipeLocalSession('Your session expired. Please sign in again.');
        throw err;
      }
      // Offline / transient network issue: keep verified local session metadata if token has not expired
      if (fallbackMeta) {
        setUser(fallbackMeta);
        const cachedEnt = await offlineStore.getCachedEntitlements();
        if (cachedEnt) setEntitlements(cachedEnt);
      }
    }
  }, [wipeLocalSession]);

  // Boot & restore session
  useEffect(() => {
    let mounted = true;
    apiClient.setSessionExpiredHandler((reason) => {
      if (!mounted) return;
      wipeLocalSession(reason).catch(() => {});
    });

    (async () => {
      await envManager.init();
      const connected = await getNetworkConnected();
      if (mounted) setIsOnline(connected);

      const storedToken = await secureStorage.getToken();
      const storedMeta = await secureStorage.getSessionMeta();

      if (storedToken && storedMeta && !isJwtExpired(storedToken)) {
        apiClient.setToken(storedToken);
        if (mounted) setUser(storedMeta);
        if (connected) {
          await hydrateUserState(storedMeta).catch(() => {});
        } else {
          const cachedEnt = await offlineStore.getCachedEntitlements();
          if (mounted && cachedEnt) setEntitlements(cachedEnt);
        }
      } else if (storedToken && isJwtExpired(storedToken)) {
        await wipeLocalSession('Previous session expired. Please sign in again.');
      }

      if (mounted) setIsBooting(false);
    })();

    const unsubNet = subscribeNetworkChanges((connected) => {
      if (mounted) setIsOnline(connected);
    });

    const unsubApp = registerAppLifecycle({
      onResume: async () => {
        const token = await secureStorage.getToken();
        if (!token) return;
        if (isJwtExpired(token)) {
          await wipeLocalSession('Session expired while app was in the background.');
          return;
        }
        const connected = await getNetworkConnected();
        if (connected) {
          await hydrateUserState(await secureStorage.getSessionMeta()).catch(() => {});
        }
      },
      onAppUrlOpen: async (deepLink) => {
        if (!mounted) return;
        if (deepLink.host === 'auth' && deepLink.path.includes('logout')) {
          await wipeLocalSession('Signed out via deep link.');
          return;
        }
        if (deepLink.host === 'auth' && deepLink.params.access_token && !isJwtExpired(deepLink.params.access_token)) {
          apiClient.setToken(deepLink.params.access_token);
          await hydrateUserState(null).catch(() => {});
          return;
        }
        setPendingDeepLink(deepLink);
      },
    });

    return () => {
      mounted = false;
      unsubNet();
      unsubApp();
      apiClient.setSessionExpiredHandler(null);
    };
  }, [hydrateUserState, wipeLocalSession]);

  const login = useCallback(async (email: string, password: string, adminMode = false) => {
    setSessionNotice(null);
    const tokenRes = adminMode ? await apiClient.adminLogin(email, password) : await apiClient.login(email, password);
    const rawRole = (tokenRes.role || 'user').toLowerCase().trim() as UserRole;
    if (adminMode && rawRole !== 'admin' && rawRole !== 'superadmin') {
      apiClient.setToken(null);
      throw new Error('Unauthorized: Account does not have administrator privileges.');
    }

    const now = Date.now();
    const meta: AuthSessionMeta = {
      userId: tokenRes.user_id,
      orgId: tokenRes.org_id,
      email: tokenRes.email,
      fullName: tokenRes.full_name || email.split('@')[0],
      role: rawRole,
      planTier: ((tokenRes.plan_tier || (adminMode ? 'enterprise' : 'free')) as PlanTier),
      issuedAt: now,
      expiresAt: now + (adminMode ? 12 : 24) * 60 * 60 * 1000,
    };

    await secureStorage.saveSession(tokenRes.access_token, meta);
    setUser(meta);
    await hydrateUserState(meta);
  }, [hydrateUserState]);

  const register = useCallback(async (payload: BackendRegisterPayload) => {
    setSessionNotice(null);
    await apiClient.register(payload);
    await login(payload.email, payload.password, false);
  }, [login]);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch {
      // always clear local state even if offline
    }
    await wipeLocalSession();
  }, [wipeLocalSession]);

  const refreshSession = useCallback(async () => {
    const token = await secureStorage.getToken();
    if (!token || isJwtExpired(token)) {
      await wipeLocalSession('Session expired. Please sign in again.');
      return;
    }
    apiClient.setToken(token);
    await hydrateUserState(user);
  }, [hydrateUserState, user, wipeLocalSession]);

  const updateLocalUser = useCallback(async (patch: Partial<AuthSessionMeta>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      secureStorage.getToken().then((t) => {
        if (t) secureStorage.saveSession(t, next).catch(() => {});
      });
      return next;
    });
  }, []);

  const isAdmin = Boolean(user && (user.role === 'admin' || user.role === 'superadmin'));

  return (
    <AuthContext.Provider
      value={{
        isBooting,
        isAuthenticated: Boolean(user),
        isOnline,
        user,
        entitlements,
        uiConfig,
        sessionNotice,
        pendingDeepLink,
        isAdmin,
        clearSessionNotice: () => setSessionNotice(null),
        clearPendingDeepLink: () => setPendingDeepLink(null),
        login,
        register,
        logout,
        refreshSession,
        updateLocalUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
