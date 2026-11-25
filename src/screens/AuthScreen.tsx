import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Mail, Server, ShieldAlert, Sparkles, UserPlus } from 'lucide-react';
import { DEFAULT_URLS, envManager } from '../config/env';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { AppEnvironment } from '../types';

type AuthMode = 'login' | 'register' | 'reset';

export const AuthScreen: React.FC = () => {
  const { login, register, sessionNotice, clearSessionNotice } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [adminMode, setAdminMode] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');

  const [termsAccepted, setTermsAccepted] = useState(true);
  const [privacyAccepted, setPrivacyAccepted] = useState(true);
  const [aiConsent, setAiConsent] = useState(true);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetRequested, setResetRequested] = useState(false);

  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState<AppEnvironment>(envManager.getEnvironment());
  const [customUrl, setCustomUrl] = useState(envManager.getApiBaseUrl());
  const [healthText, setHealthText] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    clearSessionNotice();
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password, adminMode);
      } else if (mode === 'register') {
        if (!termsAccepted || !privacyAccepted || !aiConsent) {
          throw new Error('Please accept Terms, Privacy Policy, and AI Processing consent to create an account.');
        }
        await register({
          email,
          password,
          full_name: fullName.trim() || email.split('@')[0],
          organization_name: orgName.trim() || undefined,
          terms_accepted: termsAccepted,
          privacy_accepted: privacyAccepted,
          ai_consent: aiConsent,
          marketing_consent: marketingConsent,
        });
      } else {
        if (!resetRequested) {
          const res = await apiClient.forgotPassword(email);
          setInfo(res.message);
          setResetRequested(true);
        } else {
          const res = await apiClient.resetPassword(resetToken, newPassword);
          setInfo(res.message);
          setMode('login');
          setResetRequested(false);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication request failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEnv = async () => {
    setError(null);
    setHealthText(null);
    try {
      const normalized = await envManager.setConfiguration(selectedEnv, customUrl);
      setCustomUrl(normalized);
      const health = await apiClient.getHealth(normalized);
      setHealthText(`Connected (${health.status})`);
    } catch (err: any) {
      setError(err?.message || 'Failed to validate API URL');
    }
  };

  return (
    <div className="min-h-full bg-[#0B1120] text-slate-100 px-5 pt-safe pb-safe flex flex-col justify-center">
      <div className="w-full max-w-md mx-auto space-y-5 py-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">OmniDoc Studio</h1>
          <p className="text-xs text-slate-400">
            Mobile Document Engineering · Shared Enterprise Backend
          </p>
        </div>

        {(sessionNotice || error || info) && (
          <div
            className={`p-3.5 rounded-xl text-xs border ${
              error || sessionNotice
                ? 'bg-rose-950/70 border-rose-500/40 text-rose-200'
                : 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
            }`}
          >
            {error || sessionNotice || info}
          </div>
        )}

        {/* Mode Tabs */}
        <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
          {[
            { id: 'login', label: 'Sign In' },
            { id: 'register', label: 'Register' },
            { id: 'reset', label: 'Reset' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setMode(t.id as AuthMode);
                setError(null);
                setInfo(null);
              }}
              className={`py-2.5 text-xs font-semibold rounded-lg transition-colors ${
                mode === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3.5">
          {mode === 'login' && (
            <div className="flex items-center justify-between bg-slate-950/70 px-3 py-2 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-300 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Admin Portal Sign-In
              </span>
              <button
                type="button"
                onClick={() => setAdminMode((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 ${
                  adminMode ? 'bg-amber-500' : 'bg-slate-700'
                }`}
                aria-label="Toggle admin login mode"
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    adminMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}

          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Albin Binu"
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Workspace / Organization (Optional)</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="My Workspace"
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {(mode === 'login' || mode === 'register') && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 pl-10 pr-11 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1.5 w-8 h-8 flex items-center justify-center text-slate-400"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-2 pt-1 text-xs text-slate-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                Accept Terms of Service (v2026.1)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={privacyAccepted} onChange={(e) => setPrivacyAccepted(e.target.checked)} />
                Accept Privacy Policy (v2026.1)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />
                Consent to AI Document Processing (v2026.1)
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} />
                Receive product updates (Optional)
              </label>
            </div>
          )}

          {mode === 'reset' && resetRequested && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Reset Token</label>
                <input
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Paste token from email"
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">New Password (min 8 chars)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 font-semibold text-sm text-white flex items-center justify-center gap-2"
          >
            {mode === 'register' ? <UserPlus className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
            {busy
              ? 'Authenticating...'
              : mode === 'login'
              ? adminMode
                ? 'Sign In as Administrator'
                : 'Sign In to OmniDoc'
              : mode === 'register'
              ? 'Create Shared Account'
              : resetRequested
              ? 'Confirm Password Reset'
              : 'Send Reset Instructions'}
          </button>
        </form>

        {/* Backend Environment Selector */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3">
          <button
            type="button"
            onClick={() => setShowEnvConfig((v) => !v)}
            className="w-full flex items-center justify-between text-xs text-slate-300"
          >
            <span className="flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              Backend: <strong className="uppercase">{selectedEnv}</strong>
            </span>
            <span className="text-indigo-400">{showEnvConfig ? 'Hide' : 'Configure'}</span>
          </button>

          {showEnvConfig && (
            <div className="mt-3 space-y-2.5 pt-3 border-t border-slate-800">
              <div className="grid grid-cols-3 gap-1.5">
                {(['production', 'staging', 'development'] as AppEnvironment[]).map((env) => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => {
                      setSelectedEnv(env);
                      setCustomUrl(DEFAULT_URLS[env]);
                    }}
                    className={`py-2 rounded-lg text-[11px] font-medium capitalize border ${
                      selectedEnv === env
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {env}
                  </button>
                ))}
              </div>
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleSaveEnv}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 text-xs font-medium text-white"
                >
                  Apply &amp; Test Connection
                </button>
                {healthText && <span className="text-[11px] text-emerald-400">{healthText}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
