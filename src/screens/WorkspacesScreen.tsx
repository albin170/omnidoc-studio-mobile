import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  FolderPlus,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice } from '../services/nativeBridge';
import {
  BackendDocument,
  WorkspaceChatMessageItem,
  WorkspaceInvitationItem,
  WorkspaceMemberItem,
  WorkspaceSharedDocumentItem,
  WorkspaceSummary,
} from '../types';

export const WorkspacesScreen: React.FC<{
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}> = ({ onToast }) => {
  const { isOnline, user } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'docs' | 'members' | 'chat'>('docs');
  const [invitations, setInvitations] = useState<WorkspaceInvitationItem[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberItem[]>([]);
  const [sharedDocs, setSharedDocs] = useState<WorkspaceSharedDocumentItem[]>([]);
  const [messages, setMessages] = useState<WorkspaceChatMessageItem[]>([]);
  const [vaultDocs, setVaultDocs] = useState<BackendDocument[]>([]);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [newWsName, setNewWsName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'commenter' | 'viewer'>('editor');
  const [shareDocId, setShareDocId] = useState('');
  const [sharePerm, setSharePerm] = useState<'view' | 'comment' | 'edit'>('edit');
  const [chatDraft, setChatDraft] = useState('');

  const activeWs = workspaces.find((w) => w.id === selectedId) || workspaces[0] || null;
  const canManageMembers = Boolean(activeWs && (activeWs.my_role === 'owner' || activeWs.my_role === 'admin'));
  const canShareDocs = Boolean(
    activeWs && (activeWs.my_role === 'owner' || activeWs.my_role === 'admin' || activeWs.my_role === 'editor')
  );

  const loadWorkspaces = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const [wsList, myInvites, docs] = await Promise.all([
        apiClient.listWorkspaces(),
        apiClient.listMyInvitations().catch(() => []),
        apiClient.listDocuments().catch(() => []),
      ]);
      setWorkspaces(wsList);
      setInvitations(myInvites);
      setVaultDocs(docs);
      if (docs.length > 0) {
        setShareDocId((prev) => prev || docs[0].id);
      }
      setSelectedId((prev) => (prev && wsList.some((w) => w.id === prev) ? prev : wsList[0]?.id || null));
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [isOnline, onToast]);

  const loadActiveWorkspaceDetails = useCallback(
    async (wsId: string) => {
      if (!isOnline) return;
      try {
        const [mems, docs, msgs] = await Promise.all([
          apiClient.listWorkspaceMembers(wsId),
          apiClient.listWorkspaceDocuments(wsId),
          apiClient.listWorkspaceMessages(wsId),
        ]);
        setMembers(mems);
        setSharedDocs(docs);
        setMessages(msgs);
        await apiClient.markWorkspaceMessagesRead(wsId).catch(() => {});
      } catch (err: any) {
        onToast('error', err?.message || 'Failed to load workspace details');
      }
    },
    [isOnline, onToast]
  );

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (activeWs?.id) {
      void loadActiveWorkspaceDetails(activeWs.id);
    }
  }, [activeWs?.id, loadActiveWorkspaceDetails]);

  if (!isOnline) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2">
        <Users className="w-8 h-8 mx-auto text-slate-500" />
        <p className="text-sm font-semibold text-slate-200">Workspaces Require Connectivity</p>
        <p className="text-xs text-slate-400">
          Reconnect to sync shared team workspaces, member permissions, and invitations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="bg-indigo-950/50 border border-indigo-500/40 rounded-2xl p-3.5 space-y-2">
          <p className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Pending Workspace Invitations ({invitations.length})
          </p>
          {invitations.map((inv) => (
            <div key={inv.id} className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-100 truncate">{inv.workspace_name || inv.workspace_id}</p>
                <p className="text-[11px] text-slate-400">Role: {inv.role}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await apiClient.acceptWorkspaceInvitation(inv.id);
                      onToast('success', 'Joined workspace.');
                      await loadWorkspaces();
                    } catch (err: any) {
                      onToast('error', err?.message || 'Accept failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  aria-label="Accept invitation"
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-xs font-semibold text-white flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await apiClient.rejectWorkspaceInvitation(inv.id);
                      onToast('info', 'Invitation declined.');
                      await loadWorkspaces();
                    } catch (err: any) {
                      onToast('error', err?.message || 'Decline failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  aria-label="Decline invitation"
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Workspace Picker & Create */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-300 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-indigo-400" /> Shared Workspaces
          </h2>
          <button
            type="button"
            onClick={loadWorkspaces}
            aria-label="Refresh workspaces"
            className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newWsName.trim()) return;
            setBusy(true);
            try {
              const created = await apiClient.createWorkspace(newWsName.trim());
              setNewWsName('');
              setSelectedId(created.id);
              onToast('success', `Created workspace "${created.name}".`);
              await loadWorkspaces();
            } catch (err: any) {
              onToast('error', err?.message || 'Workspace creation failed');
            } finally {
              setBusy(false);
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            placeholder="New team workspace name..."
            aria-label="New team workspace name"
            className="flex-1 h-9 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
          />
          <button
            type="submit"
            disabled={busy || !newWsName.trim()}
            className="h-9 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center gap-1 disabled:opacity-40"
          >
            <FolderPlus className="w-3.5 h-3.5" /> Create
          </button>
        </form>

        {workspaces.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-1">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => setSelectedId(ws.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border shrink-0 ${
                  activeWs?.id === ws.id
                    ? 'bg-indigo-600 border-indigo-400 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                {ws.name} ({ws.my_role})
              </button>
            ))}
          </div>
        )}
      </div>

      {activeWs && (
        <>
          <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
            {[
              { id: 'docs', label: `Docs (${sharedDocs.length})` },
              { id: 'members', label: `Members (${members.length})` },
              { id: 'chat', label: `Chat (${messages.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as 'docs' | 'members' | 'chat')}
                className={`py-2 rounded-lg text-xs font-semibold ${
                  subTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {subTab === 'docs' && (
            <div className="space-y-3">
              {canShareDocs && vaultDocs.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-300">Share Vault Document to {activeWs.name}</p>
                  <div className="flex gap-2">
                    <select
                      aria-label="Select vault document to share"
                      value={shareDocId}
                      onChange={(e) => setShareDocId(e.target.value)}
                      className="flex-1 h-9 px-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                    >
                      {vaultDocs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.filename}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Share permission"
                      value={sharePerm}
                      onChange={(e) => setSharePerm(e.target.value as 'view' | 'comment' | 'edit')}
                      className="h-9 px-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                    >
                      <option value="edit">Edit</option>
                      <option value="comment">Comment</option>
                      <option value="view">View</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy || !shareDocId}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await apiClient.shareDocumentToWorkspace(activeWs.id, shareDocId, sharePerm);
                          onToast('success', 'Document shared to workspace.');
                          await loadActiveWorkspaceDetails(activeWs.id);
                        } catch (err: any) {
                          onToast('error', err?.message || 'Share failed');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="h-9 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white"
                    >
                      Share
                    </button>
                  </div>
                </div>
              )}

              {sharedDocs.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center text-xs text-slate-400">
                  No documents shared in this workspace yet.
                </div>
              ) : (
                sharedDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-100 truncate">{doc.filename}</p>
                        <p className="text-[11px] text-slate-400">
                          {doc.file_format.toUpperCase()} · {formatFileSize(doc.file_size)} ·{' '}
                          <span className="uppercase text-cyan-300">{doc.permission}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const blob = await apiClient.downloadWorkspaceDocument(activeWs.id, doc.document_id);
                            const saved = await saveFileToDevice(blob, doc.filename);
                            onToast('success', `Saved to ${saved.path}`);
                          } catch (err: any) {
                            onToast('error', err?.message || 'Download failed');
                          }
                        }}
                        aria-label={`Download ${doc.filename}`}
                        className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-cyan-300"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {canShareDocs && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiClient.unshareWorkspaceDocument(activeWs.id, doc.document_id);
                              onToast('info', 'Removed shared document.');
                              await loadActiveWorkspaceDetails(activeWs.id);
                            } catch (err: any) {
                              onToast('error', err?.message || 'Remove failed');
                            }
                          }}
                          aria-label={`Unshare ${doc.filename}`}
                          className="w-8 h-8 rounded-lg bg-rose-950/60 flex items-center justify-center text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {subTab === 'members' && (
            <div className="space-y-3">
              {canManageMembers && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!inviteEmail.trim()) return;
                    setBusy(true);
                    try {
                      await apiClient.inviteWorkspaceMember(activeWs.id, inviteEmail.trim(), inviteRole);
                      setInviteEmail('');
                      onToast('success', 'Workspace invitation sent.');
                      await loadActiveWorkspaceDetails(activeWs.id);
                    } catch (err: any) {
                      onToast('error', err?.message || 'Invite failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2"
                >
                  <p className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-cyan-400" /> Invite Organization Member
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@company.com"
                      aria-label="Member email to invite"
                      className="flex-1 h-9 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                    />
                    <select
                      aria-label="Member role"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as any)}
                      className="h-9 px-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                    >
                      <option value="editor">Editor</option>
                      <option value="commenter">Commenter</option>
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="submit"
                      disabled={busy || !inviteEmail.trim()}
                      className="h-9 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white"
                    >
                      Invite
                    </button>
                  </div>
                </form>
              )}

              {members.map((m) => (
                <div
                  key={m.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100 truncate">
                      {m.full_name} {m.user_id === user?.userId ? '(You)' : ''}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-semibold uppercase text-cyan-300 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> {m.role}
                    </span>
                    {canManageMembers && m.role !== 'owner' && m.user_id !== user?.userId && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiClient.removeWorkspaceMember(activeWs.id, m.user_id);
                            onToast('info', `Removed ${m.full_name}.`);
                            await loadActiveWorkspaceDetails(activeWs.id);
                          } catch (err: any) {
                            onToast('error', err?.message || 'Remove member failed');
                          }
                        }}
                        aria-label={`Remove ${m.email}`}
                        className="w-7 h-7 rounded-lg bg-rose-950/60 text-rose-300 flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {subTab === 'chat' && (
            <div className="space-y-3">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2 max-h-64 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 space-y-1">
                    <MessageSquare className="w-6 h-6 mx-auto text-slate-600" />
                    <p>No workspace discussion messages yet.</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-0.5">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span className="font-semibold text-indigo-300">{msg.sender_name}</span>
                        <span>{new Date(msg.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-slate-200 whitespace-pre-wrap">{msg.body}</p>
                    </div>
                  ))
                )}
              </div>

              {activeWs.my_role !== 'viewer' && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!chatDraft.trim()) return;
                    setBusy(true);
                    try {
                      await apiClient.postWorkspaceMessage(activeWs.id, chatDraft.trim());
                      setChatDraft('');
                      await loadActiveWorkspaceDetails(activeWs.id);
                    } catch (err: any) {
                      onToast('error', err?.message || 'Failed to post message');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder="Post collaboration update..."
                    aria-label="Workspace chat message"
                    className="flex-1 h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={busy || !chatDraft.trim()}
                    aria-label="Send workspace message"
                    className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
