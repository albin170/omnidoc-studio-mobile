import React, { useEffect, useState } from 'react';
import { Bot, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { offlineStore } from '../services/offlineStore';
import { BackendDocument } from '../types';

export const AiAssistantScreen: React.FC<{ onToast: (type: 'info' | 'success' | 'error', message: string) => void }> = ({
  onToast,
}) => {
  const { isOnline } = useAuth();
  const [docs, setDocs] = useState<BackendDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [mode, setMode] = useState<'rag' | 'agent'>('rag');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

  useEffect(() => {
    offlineStore.getCachedDocuments().then((d) => {
      setDocs(d);
      if (d[0]) setSelectedDocId(d[0].id);
    });
    if (isOnline) {
      apiClient
        .listDocuments()
        .then((d) => {
          setDocs(d);
          if (d[0]) setSelectedDocId((prev) => prev || d[0].id);
        })
        .catch(() => {});
    }
  }, [isOnline]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!isOnline) {
      onToast('error', 'AI querying requires connectivity to the OmniDoc backend.');
      return;
    }
    const q = prompt.trim();
    setPrompt('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    try {
      if (mode === 'rag') {
        if (selectedDocId) {
          await apiClient.indexDocumentRag(selectedDocId).catch(() => {});
        }
        const res = await apiClient.queryRag(q, selectedDocId ? [selectedDocId] : []);
        const citationsText =
          Array.isArray(res.citations) && res.citations.length > 0
            ? `\n\nSources: ${res.citations.map((c: any) => c.filename || c.document_id).join(', ')}`
            : '';
        setMessages((prev) => [...prev, { role: 'assistant', text: `${res.answer || 'No answer returned.'}${citationsText}` }]);
      } else {
        const res = await apiClient.executeAgent(q, selectedDocId ? [selectedDocId] : [], 'single');
        const reply = res.summary || res.final_output || res.output || JSON.stringify(res, null, 2);
        setMessages((prev) => [...prev, { role: 'assistant', text: String(reply) }]);
      }
    } catch (err: any) {
      const msg = err?.message || 'AI request failed';
      onToast('error', msg);
      setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pb-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl">
          <button
            onClick={() => setMode('rag')}
            className={`py-2 rounded-lg text-xs font-semibold ${mode === 'rag' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
          >
            Document RAG Q&amp;A
          </button>
          <button
            onClick={() => setMode('agent')}
            className={`py-2 rounded-lg text-xs font-semibold ${mode === 'agent' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
          >
            OmniCore Agent
          </button>
        </div>

        <select
          value={selectedDocId}
          onChange={(e) => setSelectedDocId(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
        >
          <option value="">All Vault Documents</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2.5 min-h-[240px]">
        {messages.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
            <Sparkles className="w-7 h-7 mx-auto mb-2 text-violet-400" />
            Ask a question about your uploaded documents or trigger an OmniCore agent analysis.
          </div>
        ) : (
          messages.map((m, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-2xl text-xs whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white ml-8'
                  : 'bg-slate-900 border border-slate-800 text-slate-200 mr-4'
              }`}
            >
              {m.role === 'assistant' && <Bot className="w-3.5 h-3.5 text-violet-400 mb-1" />}
              {m.text}
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={mode === 'rag' ? 'Ask about this document...' : 'Give agent an objective...'}
          className="flex-1 h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !prompt.trim()}
          className="w-11 h-11 rounded-xl bg-violet-600 text-white flex items-center justify-center disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
