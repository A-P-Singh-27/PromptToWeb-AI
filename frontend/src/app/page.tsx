'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  Home as HomeIcon, 
  LayoutGrid, 
  Terminal, 
  Code2, 
  Settings, 
  MoreVertical, 
  Play, 
  Loader2, 
  Download, 
  Eye, 
  FileCode, 
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Layers,
  Search,
  Globe,
  Key,
  ShieldCheck,
  HardDrive,
  Clock,
  ExternalLink,
  Trash2,
  Server,
  Zap,
  Activity,
  Check,
  AlertCircle,
  RefreshCw,
  Sliders,
  Database
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

interface StreamLog {
  id: string;
  type: 'status' | 'plan' | 'action' | 'file_created' | 'observation' | 'output' | 'error';
  message: string;
  timestamp: string;
  filepath?: string;
}

interface SavedSession {
  sessionId: string;
  prompt: string;
  timestamp: string;
  status: string;
  filesCount: number;
  clientIp?: string;
}

const ALL_GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Recommended)', desc: 'Next-gen multimodal, fast & high intelligence' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', desc: 'Ultra-lightweight & low latency' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: 'Fast, high-throughput lightweight model' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: 'Complex reasoning & deep code synthesis' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Advanced reasoning model' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', desc: 'High intelligence experimental preview' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', desc: 'Latest flash model' },
];

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientIp, setClientIp] = useState<string>('127.0.0.1');
  const [logs, setLogs] = useState<StreamLog[]>([]);
  const [statusMessage, setStatusMessage] = useState('Idle');
  const [currentStep, setCurrentStep] = useState<string>('Ready to build');
  const [progressPercent, setProgressPercent] = useState(0);

  const [files, setFiles] = useState<{ [filename: string]: string }>({});
  const [activeTab, setActiveTab] = useState<string>('index.html');
  const [activeView, setActiveView] = useState<'preview' | 'code'>('preview');
  const [activeNav, setActiveNav] = useState<'build' | 'overview' | 'settings'>('build');
  const [filterMode, setFilterMode] = useState<'active' | 'delivered'>('active');

  const [deliveredSessions, setDeliveredSessions] = useState<SavedSession[]>([]);
  
  // Fully functional settings state
  const [customApiKey, setCustomApiKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.0-flash');
  const [autoLoadPreview, setAutoLoadPreview] = useState<boolean>(true);
  const [autoSaveHistory, setAutoSaveHistory] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load settings & sessions on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('cursor_gemini_api_key') || '';
    setCustomApiKey(savedKey);

    const savedModel = localStorage.getItem('cursor_model') || 'gemini-2.0-flash';
    setSelectedModel(savedModel);

    const savedAutoPreview = localStorage.getItem('cursor_auto_preview') !== 'false';
    setAutoLoadPreview(savedAutoPreview);

    const savedAutoHistory = localStorage.getItem('cursor_auto_history') !== 'false';
    setAutoSaveHistory(savedAutoHistory);

    fetchDeliveredSessions();
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchDeliveredSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (res.ok) {
        const data = await res.json();
        setDeliveredSessions(data.sessions || []);
        if (data.clientIp) setClientIp(data.clientIp);
      }
    } catch (e) {
      console.error('Error fetching delivered sessions:', e);
    }
  };

  const fetchWorkspaceFiles = async (sid: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/workspace/${sid}/files`);
      if (res.ok) {
        const data = await res.json();
        if (data.files && Object.keys(data.files).length > 0) {
          setFiles(data.files);
          const fNames = Object.keys(data.files);
          const targetTab = fNames.includes('index.html') ? 'index.html' : fNames[0];
          setActiveTab(targetTab);
        }
      }
    } catch (e) {
      console.error('Error fetching workspace files:', e);
    }
  };

  const loadDeliveredSession = (sid: string, sessionPrompt: string, view: 'preview' | 'code' = 'preview') => {
    setFiles({});
    setSessionId(sid);
    setPrompt(sessionPrompt);
    setFilterMode('active');
    setActiveNav('build');
    setActiveView(view);
    fetchWorkspaceFiles(sid);
    showToast(`Loaded session #${sid.slice(-6)}`);
  };

  // Functional Settings Handlers
  const handleSaveSettings = () => {
    const trimmedKey = customApiKey.trim();
    localStorage.setItem('cursor_gemini_api_key', trimmedKey);
    localStorage.setItem('cursor_model', selectedModel);
    localStorage.setItem('cursor_auto_preview', autoLoadPreview ? 'true' : 'false');
    localStorage.setItem('cursor_auto_history', autoSaveHistory ? 'true' : 'false');
    showToast('Settings saved successfully!');
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('cursor_gemini_api_key');
    setCustomApiKey('');
    showToast('Custom API key removed. Restored system key.');
  };

  const handleResetAllSettings = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      localStorage.clear();
      setCustomApiKey('');
      setSelectedModel('gemini-2.0-flash');
      setAutoLoadPreview(true);
      setAutoSaveHistory(true);
      showToast('All settings reset to defaults.');
    }
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    const newSessionId = `session_${Date.now()}`;
    setSessionId(newSessionId);
    setIsGenerating(true);
    setLogs([]);
    setFiles({});
    setProgressPercent(15);
    setStatusMessage('Initializing');
    setCurrentStep('Connecting to Gemini AI Engine...');

    try {
      const payload: any = { 
        prompt: prompt.trim(), 
        sessionId: newSessionId 
      };

      // Only pass custom model if custom API key is present
      if (customApiKey.trim()) {
        payload.apiKey = customApiKey.trim();
        payload.model = selectedModel;
      }

      const response = await fetch(`${API_BASE}/api/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      if (!reader) throw new Error('Failed to attach stream reader');

      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === 'init') {
                setStatusMessage('Connected');
                if (event.clientIp) setClientIp(event.clientIp);
                setProgressPercent(25);
              } else if (event.type === 'status') {
                setStatusMessage('Brain Thinking');
                setCurrentStep(event.message || '🧠 Brain Thinking: Reasoning & analyzing request...');
                addLog('status', event.message || '🧠 Brain Thinking...');
              } else if (event.type === 'plan') {
                setStatusMessage('Planning');
                setCurrentStep(event.message || '📋 Planning Architecture...');
                setProgressPercent(45);
                addLog('plan', event.message || `📋 Plan: ${event.content}`);
              } else if (event.type === 'action') {
                const fname = event.targetFile || event.input?.filepath || event.function;
                const stateTitle = 
                  event.state === 'writing_js' ? 'Writing JavaScript' :
                  event.state === 'writing_html' ? 'Writing HTML' :
                  event.state === 'writing_css' ? 'Writing CSS' : 'Writing File';
                setStatusMessage(stateTitle);
                setCurrentStep(event.message || `✏️ Writing workspace/${fname}...`);
                setProgressPercent(75);
                addLog('action', event.message || `✏️ Action: Writing ${fname}`);
              } else if (event.type === 'file_created') {
                addLog('file_created', `📄 Created: ${event.filepath} (${event.lines} lines)`);
                fetchWorkspaceFiles(newSessionId);
              } else if (event.type === 'output') {
                setStatusMessage('Completed');
                setCurrentStep('App successfully generated!');
                setProgressPercent(100);
                addLog('output', `🎉 ${event.content}`);
                fetchWorkspaceFiles(newSessionId);
                fetchDeliveredSessions();
                if (autoLoadPreview) setActiveView('preview');
              } else if (event.type === 'done') {
                setIsGenerating(false);
                fetchWorkspaceFiles(newSessionId);
                fetchDeliveredSessions();
              }
            } catch (err) {
              console.warn('Stream JSON parse error:', err);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Stream Error:', err);
      setStatusMessage('Error');
      setCurrentStep('Failed to connect to API');
      addLog('error', `❌ Error: ${err.message}`);
      setIsGenerating(false);
      setProgressPercent(0);
    }
  };

  const addLog = (type: StreamLog['type'], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        type,
        message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ]);
  };

  const handleDownloadZip = (sid?: string) => {
    const targetSession = sid || sessionId || 'default';
    window.open(`${API_BASE}/api/workspace/${targetSession}/download`, '_blank');
  };

  const getPreviewSrcDoc = () => {
    const html = files['index.html'] || files['index.htm'] || `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: system-ui, sans-serif; background: #f8fafc; color: #334155; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: white; padding: 40px; border-radius: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; border: 1px solid #e2e8f0; }
          h2 { color: #0f172a; margin-top: 0; }
          p { color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Ready to Render</h2>
          <p>Enter a prompt on the left to build and preview your web application in real-time.</p>
        </div>
      </body>
      </html>
    `;
    const css = files['style.css'] || files['styles.css'] || '';
    const js = files['app.js'] || files['script.js'] || '';

    let bundle = html;
    if (css) bundle = bundle.replace('</head>', `<style>${css}</style></head>`);
    if (js) bundle = bundle.replace('</body>', `<script>${js}</script></body>`);
    return bundle;
  };

  const samplePrompts = [
    "Expense tracker with dashboard & CRUD",
    "Weather app with search & forecast",
    "Interactive quiz app with timer",
    "Todo app with priority tags"
  ];

  return (
    <div className="h-screen max-h-screen w-screen bg-[#f3f4f6] text-gray-900 flex p-3 md:p-4 gap-4 font-sans overflow-hidden relative">
      
      {/* Notification Toast */}
      {toastMessage && (
        <div className="absolute top-4 right-6 z-50 bg-black text-white px-5 py-3 rounded-2xl shadow-xl border border-gray-800 text-xs font-bold flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-[#d2f837]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Left Floating Sidebar (Icon Nav - LogOut Removed) */}
      <aside className="w-16 h-full bg-white rounded-3xl border border-gray-200/80 shadow-sm flex flex-col items-center py-5 justify-between shrink-0">
        <div className="flex flex-col items-center gap-6">
          {/* Logo Icon */}
          <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center text-white shadow-md">
            <Box className="w-5 h-5" />
          </div>

          {/* Navigation Icons */}
          <nav className="flex flex-col items-center gap-3">
            <button 
              onClick={() => setActiveNav('build')}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                activeNav === 'build' ? 'bg-gray-100 text-black border border-gray-200 font-bold shadow-xs' : 'text-gray-400 hover:text-gray-700'
              }`}
              title="Agent Builder"
            >
              <HomeIcon className="w-5 h-5" />
            </button>

            <button 
              onClick={() => setActiveNav('overview')}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                activeNav === 'overview' ? 'bg-gray-100 text-black border border-gray-200 font-bold shadow-xs' : 'text-gray-400 hover:text-gray-700'
              }`}
              title="Overview Dashboard"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>

            <button 
              onClick={() => setActiveNav('settings')}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                activeNav === 'settings' ? 'bg-gray-100 text-black border border-gray-200 font-bold shadow-xs' : 'text-gray-400 hover:text-gray-700'
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </nav>
        </div>

        {/* Device IP Badge at bottom of sidebar */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-[9px] font-bold flex items-center justify-center text-center leading-none" title={`Device IP: ${clientIp}`}>
            IP
          </div>
        </div>
      </aside>

      {/* 2. Main Layout Container */}
      <div className="flex-1 h-full flex flex-col lg:flex-row gap-4 overflow-hidden min-w-0">
        
        {/* VIEW 1: AGENT BUILDER (Home) */}
        {activeNav === 'build' && (
          <>
            {/* Left Column: Prompt Input & Stream Tracking Panel */}
            <div className="w-full lg:w-[420px] xl:w-[440px] h-full flex flex-col gap-3 shrink-0 min-h-0 overflow-hidden">
              
              {/* Header & Prompt Form Card */}
              <div className="bg-white rounded-3xl p-5 border border-gray-200/80 shadow-sm flex flex-col gap-4 shrink-0">
                <div className="flex justify-between items-center">
                  <h1 className="text-xl font-bold tracking-tight text-gray-900">App Builder</h1>
                  <div className="flex items-center gap-1.5 bg-gray-100 px-3 py-1 rounded-full text-[10px] font-bold text-gray-600">
                    <Globe className="w-3 h-3 text-gray-500" />
                    <span>{clientIp}</span>
                  </div>
                </div>

                {/* Filter Pills (On the way vs Delivered) */}
                <div className="bg-gray-100 p-1 rounded-2xl flex gap-1">
                  <button 
                    onClick={() => setFilterMode('active')}
                    className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${
                      filterMode === 'active' ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    On the way
                  </button>
                  <button 
                    onClick={() => {
                      setFilterMode('delivered');
                      fetchDeliveredSessions();
                    }}
                    className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${
                      filterMode === 'delivered' ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    Delivered ({deliveredSessions.length})
                  </button>
                </div>

                {filterMode === 'active' ? (
                  <>
                    {/* Prompt Form */}
                    <form onSubmit={handleGenerate} className="flex flex-col gap-2.5">
                      <div className="relative">
                        <input
                          type="text"
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="Describe your app prompt..."
                          className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-black transition-colors"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={isGenerating || !prompt.trim()}
                          className="flex-1 bg-black hover:bg-gray-800 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-2xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Building App...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-white" />
                              <span>Start Building</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>

                    {/* Sample Prompt Chips */}
                    <div className="flex flex-wrap gap-1">
                      {samplePrompts.map((sp, idx) => (
                        <button
                          key={idx}
                          onClick={() => setPrompt(sp)}
                          className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-2.5 py-1 rounded-full transition-all"
                        >
                          + {sp.split(' ')[0]} {sp.split(' ')[1]}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  /* Delivered Projects List (Reference Image Style) */
                  <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                    {deliveredSessions.length === 0 ? (
                      <div className="text-center py-4 text-xs text-gray-400">
                        No delivered projects yet for device {clientIp}.
                      </div>
                    ) : (
                      deliveredSessions.map((ds) => (
                        <div 
                          key={ds.sessionId}
                          onClick={() => loadDeliveredSession(ds.sessionId, ds.prompt)}
                          className="p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200/80 rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-gray-900 block truncate">{ds.prompt}</span>
                            <span className="text-[10px] text-gray-400 block mt-0.5">#{ds.sessionId.slice(-8)} • {new Date(ds.timestamp).toLocaleDateString()}</span>
                          </div>
                          <span className="bg-[#d2f837] text-black text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase shrink-0">
                            DELIVERED
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Active Generation Tracking Card */}
              <div className="bg-white rounded-3xl p-5 border border-gray-200/80 shadow-sm flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
                
                {/* Session Header */}
                <div className="flex justify-between items-start border-b border-gray-100 pb-3 shrink-0">
                  <div>
                    <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                      <span>Agent Session</span>
                      <span className="text-[11px] text-gray-400 font-normal">#{sessionId ? sessionId.slice(-6) : '98018'}</span>
                    </h2>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate max-w-[240px]">
                      {prompt ? prompt : 'No active build'}
                    </p>
                  </div>

                  {/* Status Badge with Emojis & Animated Pulse */}
                  <div className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 shadow-2xs ${
                    isGenerating ? 'bg-[#d2f837] text-black border border-black/10' : 
                    Object.keys(files).length > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {isGenerating ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-black animate-ping" />
                        <span>
                          {statusMessage.includes('Thinking') ? '🧠 THINKING' :
                           statusMessage.includes('Planning') ? '📋 PLANNING' :
                           statusMessage.includes('JavaScript') ? '✏️ WRITING JS' :
                           statusMessage.includes('HTML') ? '📝 WRITING HTML' :
                           statusMessage.includes('CSS') ? '🎨 WRITING CSS' :
                           '⚙️ IN TRANSIT'}
                        </span>
                      </>
                    ) : Object.keys(files).length > 0 ? (
                      '🎉 DELIVERED'
                    ) : (
                      'IDLE'
                    )}
                  </div>
                </div>

                {/* Progress Bar & Animated Step Label */}
                <div className="space-y-1.5 shrink-0">
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200/60">
                    <div 
                      className="bg-[#d2f837] h-full rounded-full transition-all duration-500 shadow-xs" 
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-gray-700 font-bold">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isGenerating && (
                        <span className="animate-spin text-black shrink-0">⏳</span>
                      )}
                      <span className="truncate">{currentStep}</span>
                    </div>
                    <span className="text-gray-400 font-mono shrink-0">{progressPercent}%</span>
                  </div>
                </div>

                {/* Data Grid Summary */}
                <div className="grid grid-cols-4 gap-1 bg-gray-50 p-2.5 rounded-2xl border border-gray-100 text-center shrink-0">
                  <div>
                    <span className="block text-[9px] text-gray-400 uppercase font-bold">Engine</span>
                    <span className="text-[11px] font-bold text-gray-800">
                      {customApiKey.trim() ? selectedModel.split('-')[1] || 'Gemini' : 'Gemini'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-gray-400 uppercase font-bold">Status</span>
                    <span className="text-[11px] font-bold text-gray-800">{statusMessage}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-gray-400 uppercase font-bold">Files</span>
                    <span className="text-[11px] font-bold text-gray-800">{Object.keys(files).length}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-gray-400 uppercase font-bold">Key</span>
                    <span className="text-[11px] font-bold text-emerald-600">{customApiKey.trim() ? 'Custom' : 'System'}</span>
                  </div>
                </div>

                {/* Terminal Stream Feed */}
                <div className="flex-1 bg-gray-50 rounded-2xl border border-gray-200/60 p-3 font-mono text-[11px] overflow-y-auto space-y-1.5 min-h-0">
                  {logs.length === 0 ? (
                    <div className="text-center py-6 text-gray-400">
                      <Terminal className="w-5 h-5 mx-auto mb-1 opacity-40" />
                      <p className="text-[10px]">Live reasoning feed will appear here...</p>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="flex items-start gap-1.5 leading-relaxed">
                        <span className="text-gray-400 select-none text-[9px] pt-0.5">{log.timestamp}</span>
                        <span className={
                          log.type === 'plan' ? 'text-purple-700 font-bold' :
                          log.type === 'action' ? 'text-blue-600 font-semibold' :
                          log.type === 'file_created' ? 'text-emerald-600 font-bold' :
                          log.type === 'output' ? 'text-black font-extrabold' :
                          log.type === 'error' ? 'text-rose-600 font-bold' :
                          'text-gray-700'
                        }>
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={terminalEndRef} />
                </div>

              </div>
            </div>

            {/* Right Column: Live App Render Sandbox & Code Inspection Panel */}
            <div className="flex-1 h-full flex flex-col gap-3 min-h-0 overflow-hidden min-w-0">
              
              {/* Main Workspace Card Container */}
              <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm flex flex-col flex-1 h-full min-h-0 overflow-hidden">
                
                {/* Top Control Bar */}
                <div className="p-3 md:p-4 border-b border-gray-100 flex flex-wrap justify-between items-center gap-2 bg-white shrink-0">
                  
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-gray-900 tracking-tight">
                      Live App Workspace
                    </h2>
                  </div>

                  {/* View Switcher Pills */}
                  <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-2xl">
                    <button
                      onClick={() => setActiveView('preview')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeView === 'preview' ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Sandbox Preview</span>
                    </button>
                    <button
                      onClick={() => setActiveView('code')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeView === 'code' ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      <span>Code Viewer</span>
                    </button>
                  </div>

                </div>

                {/* Code Tabs */}
                {activeView === 'code' && Object.keys(files).length > 0 && (
                  <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200/60 flex items-center gap-1.5 overflow-x-auto shrink-0">
                    {Object.keys(files).map((fname) => (
                      <button
                        key={fname}
                        onClick={() => setActiveTab(fname)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          activeTab === fname ? 'bg-white text-black border border-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        <FileCode className="w-3.5 h-3.5 text-gray-700" />
                        <span>{fname}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Render Sandbox or Code Viewer Body */}
                <div className="flex-1 bg-[#f9fafb] relative min-h-0 overflow-hidden">
                  {activeView === 'preview' ? (
                    <iframe
                      key={`${sessionId || 'default'}-${Object.keys(files).join('-')}`}
                      srcDoc={getPreviewSrcDoc()}
                      title="Live Sandbox App"
                      className="w-full h-full border-none bg-white"
                      sandbox="allow-scripts allow-modals allow-same-origin"
                    />
                  ) : (
                    <pre className="w-full h-full p-4 overflow-auto font-mono text-xs text-gray-800 leading-relaxed bg-white">
                      <code>{files[activeTab] || '// Select a generated file above to view code'}</code>
                    </pre>
                  )}
                </div>

                {/* Bottom Floating Status & Download Bar */}
                <div className="p-3 md:p-4 bg-white border-t border-gray-100 flex flex-wrap justify-between items-center gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <div>
                      <span className="text-xs font-bold text-gray-900 block">
                        Session ID: {sessionId ? sessionId : 'session_default'}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {Object.keys(files).length > 0 ? `${Object.keys(files).length} files ready to export` : 'Awaiting generation'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadZip()}
                      disabled={Object.keys(files).length === 0}
                      className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-100 disabled:opacity-40 text-black px-5 py-2 rounded-full text-xs font-bold transition-all shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download ZIP</span>
                    </button>
                  </div>
                </div>

              </div>

            </div>
          </>
        )}

        {/* VIEW 2: ENTERPRISE OVERVIEW DASHBOARD */}
        {activeNav === 'overview' && (
          <div className="flex-1 h-full flex flex-col gap-4 overflow-y-auto p-1 pr-2 min-w-0">
            
            {/* Enterprise Header Banner */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center font-bold text-xl shadow-md">
                  <Activity className="w-6 h-6 text-[#d2f837]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-black tracking-tight text-gray-900">Developer Control Center</h1>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-300/60">
                      LIVE NODE
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Client Device Node: <span className="font-bold text-gray-900">{clientIp}</span> • Architecture: Express API + Gemini Agent</p>
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto">
                <button 
                  onClick={() => setActiveNav('build')}
                  className="flex-1 md:flex-none bg-black hover:bg-gray-800 text-white font-bold text-xs px-5 py-3 rounded-2xl transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Create New App</span>
                </button>
                <button 
                  onClick={fetchDeliveredSessions}
                  className="border border-gray-300 hover:bg-gray-100 text-gray-800 font-bold text-xs px-4 py-3 rounded-2xl transition-all flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sync Registry</span>
                </button>
              </div>
            </div>

            {/* Metric KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-gray-200/80 shadow-sm flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">Delivered Projects</span>
                  <span className="w-7 h-7 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">
                    <Box className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-3">
                  <span className="text-3xl font-black text-gray-900 tracking-tight">{deliveredSessions.length}</span>
                  <span className="text-[11px] text-emerald-600 font-bold block mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3" /> 100% Build Health
                  </span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-gray-200/80 shadow-sm flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">Primary Model</span>
                  <span className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                    <Cpu className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-3">
                  <span className="text-xl font-black text-gray-900 tracking-tight truncate block">
                    {customApiKey.trim() ? selectedModel : 'gemini-2.0-flash'}
                  </span>
                  <span className="text-[11px] text-gray-500 font-medium block mt-1">
                    {customApiKey.trim() ? 'Custom API Key Active' : 'System Default Key Active'}
                  </span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-gray-200/80 shadow-sm flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">IPC Event Pipeline</span>
                  <span className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                    <Zap className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-3">
                  <span className="text-xl font-black text-emerald-600 tracking-tight block">SSE Streaming</span>
                  <span className="text-[11px] text-gray-500 font-medium block mt-1">Express API Process Bridge</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-gray-200/80 shadow-sm flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">Device Segregation</span>
                  <span className="w-7 h-7 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                    <Globe className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-3">
                  <span className="text-lg font-black text-gray-900 tracking-tight truncate block">{clientIp}</span>
                  <span className="text-[11px] text-gray-500 font-medium block mt-1">Session Isolated Storage</span>
                </div>
              </div>
            </div>

            {/* Enterprise Gallery Section */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Delivered Applications Gallery</h2>
                  <p className="text-xs text-gray-500">Access, preview, and download all projects built for device IP {clientIp}</p>
                </div>
                <span className="bg-gray-100 text-gray-700 text-xs font-bold px-3 py-1 rounded-full">
                  {deliveredSessions.length} Projects
                </span>
              </div>

              {deliveredSessions.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-xs">
                  No generated projects delivered yet. Switch to Builder to create your first app!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {deliveredSessions.map((ds) => (
                    <div key={ds.sessionId} className="p-5 bg-gray-50 border border-gray-200/80 rounded-3xl flex flex-col justify-between gap-4 hover:border-gray-300 transition-all shadow-xs">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[11px] font-mono font-bold text-gray-400">#{ds.sessionId.slice(-8)}</span>
                          <span className="bg-[#d2f837] text-black text-[9px] font-extrabold px-2.5 py-0.5 rounded-full uppercase">
                            DELIVERED
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-gray-900 line-clamp-2 leading-snug">{ds.prompt}</h3>
                        
                        <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-400">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(ds.timestamp).toLocaleDateString()}</span>
                          <span className="flex items-center gap-1"><FileCode className="w-3 h-3" /> HTML/CSS/JS</span>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-3 border-t border-gray-200/60">
                        <button 
                          onClick={() => loadDeliveredSession(ds.sessionId, ds.prompt, 'preview')}
                          className="flex-1 bg-black hover:bg-gray-800 text-white text-xs font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Preview App</span>
                        </button>
                        <button 
                          onClick={() => loadDeliveredSession(ds.sessionId, ds.prompt, 'code')}
                          className="border border-gray-300 hover:bg-gray-200 text-gray-800 text-xs font-bold px-3 py-2 rounded-xl transition-all"
                          title="Inspect Code"
                        >
                          <Code2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDownloadZip(ds.sessionId)}
                          className="border border-gray-300 hover:bg-gray-200 text-gray-800 text-xs font-bold px-3 py-2 rounded-xl transition-all"
                          title="Download ZIP"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Architecture Visualizer Card */}
            <div className="bg-gradient-to-br from-slate-900 to-black text-white rounded-3xl p-6 border border-gray-800 shadow-lg">
              <div className="flex items-center gap-2 font-bold text-sm text-[#d2f837] mb-3">
                <Sliders className="w-4 h-4" />
                <span>Enterprise Agent Architecture</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                The agent engine runs asynchronously. Express.js spawns the Python ReAct loop process, which communicates directly with Gemini LLM APIs, executes filesystem tools in isolated workspace directories, and streams SSE events to the Next.js 14 frontend.
              </p>
            </div>

          </div>
        )}

        {/* VIEW 3: FULLY FUNCTIONAL SETTINGS DASHBOARD */}
        {activeNav === 'settings' && (
          <div className="flex-1 h-full flex flex-col gap-4 overflow-y-auto p-1 pr-2 min-w-0">
            
            {/* Header */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-black text-gray-900">Agent Configuration & Preferences</h1>
                <p className="text-xs text-gray-500 mt-1">Manage API credentials, primary model fallback, auto-preview, and local workspace storage.</p>
              </div>
              <button 
                onClick={handleSaveSettings}
                className="bg-black hover:bg-gray-800 text-white text-xs font-bold px-6 py-2.5 rounded-2xl transition-all shadow-sm flex items-center gap-2"
              >
                <Check className="w-4 h-4 text-[#d2f837]" />
                <span>Save All Settings</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              
              {/* 1. API Credentials Setting Card */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2 font-bold text-gray-900 text-sm">
                    <Key className="w-4 h-4 text-purple-600" />
                    <span>Gemini API Credential Settings</span>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                    customApiKey.trim() ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {customApiKey.trim() ? 'CUSTOM KEY ACTIVE' : 'DEFAULT SYSTEM KEY'}
                  </span>
                </div>

                <p className="text-xs text-gray-500 leading-relaxed">
                  Provide your custom Google AI Studio key (`AIzaSy...`). When a custom API key is active, your selected primary model will be targeted. Without a key, the system default key (`gemini-2.0-flash`) is used automatically.
                </p>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-gray-700">Custom Gemini API Key</label>
                  <input 
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="Enter AIzaSy... API Key"
                    className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-xs font-mono font-medium text-gray-900 focus:outline-none focus:border-black transition-colors"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={handleSaveSettings}
                    className="bg-black hover:bg-gray-800 text-white font-bold text-xs px-5 py-2.5 rounded-2xl transition-all"
                  >
                    Save Key
                  </button>
                  {customApiKey && (
                    <button 
                      onClick={handleClearApiKey}
                      className="border border-gray-300 hover:bg-gray-100 text-gray-700 font-bold text-xs px-4 py-2.5 rounded-2xl transition-all"
                    >
                      Clear & Use System Key
                    </button>
                  )}
                </div>
              </div>

              {/* 2. Model Selection Setting Card */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2 font-bold text-gray-900 text-sm">
                    <Cpu className="w-4 h-4 text-indigo-600" />
                    <span>Preferred Primary Gemini Model</span>
                  </div>
                </div>

                {/* Important Notice requirement */}
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-[11px] text-amber-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold">Model Selection Rule:</strong> Custom model selection requires your personal <strong>Custom Gemini API Key</strong>. Without a custom key, the default server system key (<code className="bg-amber-100 px-1 py-0.5 rounded font-mono">gemini-2.0-flash</code>) will be used automatically.
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-gray-700">Select Primary Model Target</label>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-xs font-medium text-gray-900 focus:outline-none focus:border-black transition-colors"
                  >
                    {ALL_GEMINI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-[11px] text-gray-400 italic">
                  {ALL_GEMINI_MODELS.find(m => m.id === selectedModel)?.desc}
                </p>

                <div className="pt-2">
                  <button 
                    onClick={handleSaveSettings}
                    className="w-full bg-black hover:bg-gray-800 text-white font-bold text-xs py-2.5 rounded-2xl transition-all"
                  >
                    Save Model Preference
                  </button>
                </div>
              </div>

              {/* 3. Automation & UI Preferences Card */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-2 font-bold text-gray-900 text-sm border-b border-gray-100 pb-3">
                  <Sliders className="w-4 h-4 text-emerald-600" />
                  <span>Workspace Automation Preferences</span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">Auto-switch to Sandbox Preview</span>
                    <span className="text-[11px] text-gray-400">Automatically switch workspace view to Live Preview when build completes</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={autoLoadPreview}
                    onChange={(e) => {
                      setAutoLoadPreview(e.target.checked);
                      localStorage.setItem('cursor_auto_preview', e.target.checked ? 'true' : 'false');
                    }}
                    className="w-4 h-4 accent-black cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">Auto-Sync Session Registry</span>
                    <span className="text-[11px] text-gray-400">Save session metadata to server registry for IP {clientIp}</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={autoSaveHistory}
                    onChange={(e) => {
                      setAutoSaveHistory(e.target.checked);
                      localStorage.setItem('cursor_auto_history', e.target.checked ? 'true' : 'false');
                    }}
                    className="w-4 h-4 accent-black cursor-pointer"
                  />
                </div>
              </div>

              {/* 4. Device Management & Reset Settings Card */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200/80 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-2 font-bold text-gray-900 text-sm border-b border-gray-100 pb-3">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>Device & Reset Options</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/60">
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Client IP</span>
                    <span className="font-bold text-gray-900 mt-1 block">{clientIp}</span>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/60">
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Delivered Apps</span>
                    <span className="font-bold text-gray-900 mt-1 block">{deliveredSessions.length} Saved</span>
                  </div>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={handleResetAllSettings}
                    className="w-full border border-rose-300 hover:bg-rose-50 text-rose-700 font-bold text-xs py-2.5 rounded-2xl transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Reset All Settings & Clear Cache</span>
                  </button>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>

    </div>
  );
}
