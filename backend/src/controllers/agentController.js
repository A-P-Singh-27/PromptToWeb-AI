const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CURSOR_SCRIPT = path.join(PROJECT_ROOT, 'cursor.py');

// Dynamic workspace directory for Serverless (Vercel/Lambda) vs Local Environment
const getWorkspaceBaseDir = () => {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        return path.join(os.tmpdir(), 'workspace');
    }
    return path.join(PROJECT_ROOT, 'workspace');
};

const getRegistryFilePath = () => path.join(getWorkspaceBaseDir(), 'registry.json');

// Find virtualenv python executable if available
const venvPythonWin = path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe');
const venvPythonLinux = path.join(PROJECT_ROOT, 'venv', 'bin', 'python');

const getPythonExecutable = () => {
    if (fs.existsSync(venvPythonWin)) return venvPythonWin;
    if (fs.existsSync(venvPythonLinux)) return venvPythonLinux;
    
    const linuxCandidates = [
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        '/var/lang/bin/python3',
        'python3',
        'python'
    ];
    for (const cand of linuxCandidates) {
        try {
            if (fs.existsSync(cand)) return cand;
        } catch (e) {}
    }
    return process.platform === 'win32' ? 'python' : 'python3';
};

const getClientIp = (req) => {
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    return rawIp === '::1' || rawIp === '::ffff:127.0.0.1' ? '127.0.0.1' : rawIp;
};

// Session Registry helpers
const getRegistry = () => {
    try {
        const regFile = getRegistryFilePath();
        if (fs.existsSync(regFile)) {
            return JSON.parse(fs.readFileSync(regFile, 'utf-8'));
        }
    } catch (e) {
        console.error('[Registry Read Error]:', e);
    }
    return [];
};

const saveRegistry = (registry) => {
    try {
        const baseDir = getWorkspaceBaseDir();
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
        fs.writeFileSync(getRegistryFilePath(), JSON.stringify(registry, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Registry Save Error]:', e);
    }
};

const updateSessionInRegistry = (sessionId, data) => {
    const registry = getRegistry();
    const idx = registry.findIndex(item => item.sessionId === sessionId);
    if (idx >= 0) {
        registry[idx] = { ...registry[idx], ...data, updatedAt: new Date().toISOString() };
    } else {
        registry.unshift({
            sessionId,
            timestamp: new Date().toISOString(),
            status: 'in_progress',
            filesCount: 0,
            ...data
        });
    }
    saveRegistry(registry);
};

// Native Node.js ReAct Agent Fallback for Vercel Serverless Function Environments
const BASE_NATIVE_MODELS = ['gemini-3.5-flash'];

const callGeminiOpenAiApiWithRetry = async (messages, userApiKey, userModel, sseRes, maxRetriesPerModel = 3) => {
    const apiKey = userApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in server environment or Settings tab.');
    }

    let modelList = [...BASE_NATIVE_MODELS];
    if (userModel && userModel.trim()) {
        const target = userModel.trim();
        modelList = [target, ...BASE_NATIVE_MODELS.filter(m => m !== target)];
    }

    let lastError = null;

    for (const targetModel of modelList) {
        for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
            try {
                if (sseRes && !sseRes.writableEnded) {
                    sseRes.write(`data: ${JSON.stringify({ 
                        type: 'status', 
                        state: 'thinking', 
                        message: `🧠 Brain Thinking: Analyzing request with model '${targetModel}'...` 
                    })}\n\n`);
                }

                const result = await new Promise((resolve, reject) => {
                    const payload = JSON.stringify({
                        model: targetModel,
                        response_format: { type: "json_object" },
                        messages
                    });

                    const reqOptions = {
                        hostname: 'generativelanguage.googleapis.com',
                        port: 443,
                        path: `/v1beta/openai/chat/completions`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Length': Buffer.byteLength(payload)
                        }
                    };

                    const req = https.request(reqOptions, (res) => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    resolve(JSON.parse(body));
                                } catch (e) {
                                    reject(new Error(`Invalid JSON response from model '${targetModel}': ${body}`));
                                }
                            } else {
                                const errObj = new Error(`API HTTP Error ${res.statusCode}: ${body}`);
                                errObj.statusCode = res.statusCode;
                                errObj.responseBody = body;
                                reject(errObj);
                            }
                        });
                    });

                    req.on('error', err => reject(err));
                    req.write(payload);
                    req.end();
                });

                return result; // Successful response!
            } catch (err) {
                lastError = err;
                const errStr = String(err.responseBody || err.message || '');
                const is429 = err.statusCode === 429 || errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED');
                const is404 = err.statusCode === 404 || errStr.includes('404') || errStr.includes('NOT_FOUND');

                if (is429) {
                    const waitSec = attempt * 3;
                    console.warn(`[AgentController] Rate limit 429 on '${targetModel}'. Retrying in ${waitSec}s (Attempt ${attempt}/${maxRetriesPerModel})...`);
                    if (sseRes && !sseRes.writableEnded) {
                        sseRes.write(`data: ${JSON.stringify({ 
                            type: 'status', 
                            state: 'rate_limit', 
                            message: `⏳ Free tier rate limit reached on '${targetModel}'. Auto-retrying in ${waitSec}s (Attempt ${attempt}/${maxRetriesPerModel})...` 
                        })}\n\n`);
                    }
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                } else if (is404) {
                    console.warn(`[AgentController] Model '${targetModel}' not available (404). Switching to fallback model...`);
                    if (sseRes && !sseRes.writableEnded) {
                        sseRes.write(`data: ${JSON.stringify({ 
                            type: 'status', 
                            state: 'fallback', 
                            message: `🔄 Model '${targetModel}' unavailable. Switching to fallback model...` 
                        })}\n\n`);
                    }
                    break; // Break inner retry loop to try next model in modelList
                } else {
                    throw err; // Non-retryable error
                }
            }
        }
    }

    throw new Error(`Google AI Studio Free Tier Quota Exceeded on models. Please try again in a moment or enter your personal API Key in Settings. Details: ${lastError?.message || lastError}`);
};

const runNativeJsAgentLoop = async (req, res, { prompt, sessionId, workspaceDir, apiKey, model }) => {
    console.log(`[AgentController] Running Native JS ReAct Agent Fallback for session ${sessionId}...`);

    const systemPrompt = `
You are an expert AI Coding Agent specialized in building web applications and software projects locally.
You operate in an autonomous loop: plan -> action -> observe -> output.

Environment & Setup:
- Default Workspace Path: ${workspaceDir}
- All generated code files MUST be written into the workspace directory using the write_file tool.

Guidelines for Web Projects (HTML, CSS, JS):
1. Create modern, beautiful, responsive, accessible, and error-free applications.
2. Modularize files clearly:
   - index.html (Semantic structure, UTF-8 charset, viewport meta tag, linked CSS/JS).
   - style.css (Clean CSS with color variables, flex/grid layouts, hover effects, mobile media queries).
   - app.js (Robust JavaScript with event listeners, state management, full CRUD operations, and localStorage persistence).
3. When writing code via write_file, provide COMPLETE code without placeholders or comments like '// rest of code...'.

JSON Output Rules:
Respond STRICTLY with a single valid JSON object adhering to one of these formats:

Plan step:
{
    "step": "plan",
    "content": "Step-by-step description of what you plan to do"
}

Action step:
{
    "step": "action",
    "function": "write_file",
    "input": {
        "filepath": "index.html",
        "content": "<!DOCTYPE html>..."
    }
}

Output step (when finished):
{
    "step": "output",
    "content": "User summary message explaining the created application, file locations in workspace, and how to view it."
}
`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
    ];

    let filesCount = 0;

    try {
        while (true) {
            if (res.writableEnded) break;

            let apiResponse;
            try {
                apiResponse = await callGeminiOpenAiApiWithRetry(messages, apiKey, model, res);
            } catch (err) {
                console.error('[Native JS Agent Error]:', err);
                res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
                updateSessionInRegistry(sessionId, { status: 'failed', error: err.message });
                res.end();
                return;
            }

            const rawContent = apiResponse.choices[0].message.content;
            let parsed;
            try {
                parsed = JSON.parse(rawContent);
            } catch (e) {
                messages.push({ role: "user", content: "Your previous output was not valid JSON. Please reply strictly in JSON format." });
                continue;
            }

            const step = parsed.step;

            if (step === 'plan') {
                const planContent = parsed.content;
                res.write(`data: ${JSON.stringify({
                    type: 'plan',
                    state: 'planning',
                    content: planContent,
                    message: `📋 Planning Architecture: ${planContent.slice(0, 100)}...`
                })}\n\n`);
                messages.push({ role: "assistant", content: JSON.stringify(parsed) });
                continue;
            }

            if (step === 'action') {
                const fnName = parsed.function;
                const toolInput = parsed.input;
                const filepath = toolInput?.filepath || 'file';
                const fileContent = toolInput?.content || '';

                let state = 'executing';
                let stateMsg = `⚙️ Executing tool '${fnName}'...`;

                if (filepath.endsWith('.js')) {
                    state = 'writing_js';
                    stateMsg = `✏️ Writing JavaScript Logic: Crafting workspace/${filepath} (CRUD & interactivity)...`;
                } else if (filepath.endsWith('.html')) {
                    state = 'writing_html';
                    stateMsg = `📝 Writing HTML Structure: Crafting workspace/${filepath} (UI markup & layout)...`;
                } else if (filepath.endsWith('.css')) {
                    state = 'writing_css';
                    stateMsg = `🎨 Writing CSS Styling: Crafting workspace/${filepath} (styling & responsive design)...`;
                }

                res.write(`data: ${JSON.stringify({
                    type: 'action',
                    state,
                    function: fnName,
                    input: toolInput,
                    message: stateMsg,
                    targetFile: filepath
                })}\n\n`);

                messages.push({ role: "assistant", content: JSON.stringify(parsed) });

                let obsOutput = '';
                if (fnName === 'write_file') {
                    try {
                        const targetPath = path.join(workspaceDir, filepath);
                        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                        fs.writeFileSync(targetPath, fileContent, 'utf-8');

                        filesCount++;
                        updateSessionInRegistry(sessionId, { filesCount });
                        const lines = fileContent.split('\n').length;
                        res.write(`data: ${JSON.stringify({ type: 'file_created', filepath, lines })}\n\n`);
                        obsOutput = `File '${filepath}' successfully created/updated in workspace (${lines} lines).`;
                    } catch (err) {
                        obsOutput = `Error writing file '${filepath}': ${err.message}`;
                    }
                } else {
                    obsOutput = `Tool '${fnName}' executed.`;
                }

                res.write(`data: ${JSON.stringify({ type: 'observation', output: obsOutput })}\n\n`);
                messages.push({ role: "assistant", content: JSON.stringify({ step: "observe", output: obsOutput }) });
                continue;
            }

            if (step === 'output') {
                const outputText = parsed.content;
                updateSessionInRegistry(sessionId, { status: 'delivered', filesCount });
                res.write(`data: ${JSON.stringify({
                    type: 'output',
                    state: 'completed',
                    content: outputText,
                    message: "🎉 Build Completed: All application files generated and ready!"
                })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'done', code: 0, sessionId })}\n\n`);
                res.end();
                break;
            }
        }
    } catch (e) {
        console.error('[Native JS Agent Exception]:', e);
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
            res.end();
        }
    }
};

// 1. SSE Stream Controller: Spawns cursor.py or activates Native JS Agent Fallback
const generateStream = (req, res) => {
    const { prompt, sessionId: userSessionId, apiKey, model } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    const sessionId = userSessionId || uuidv4();
    const clientIp = getClientIp(req);
    const workspaceDir = path.join(getWorkspaceBaseDir(), sessionId);

    // Register session
    updateSessionInRegistry(sessionId, {
        prompt,
        clientIp,
        status: 'in_progress',
        filesCount: 0
    });

    // Ensure session workspace folder exists inside writable directory (/tmp on Vercel)
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Prepare SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    // Send initial session event
    res.write(`data: ${JSON.stringify({ type: 'init', sessionId, workspaceDir, clientIp })}\n\n`);

    const pythonCmd = getPythonExecutable();
    const args = [
        CURSOR_SCRIPT,
        '--prompt', prompt,
        '--session', sessionId,
        '--json-stream'
    ];

    if (model && apiKey && apiKey.trim()) {
        args.push('--model', model);
    }

    console.log(`[AgentController] Spawning (${clientIp}): ${pythonCmd} ${args.join(' ')}`);

    const envVars = { ...process.env, PYTHONUNBUFFERED: '1' };
    if (apiKey && apiKey.trim()) {
        envVars.GEMINI_API_KEY = apiKey.trim();
    }

    let pythonProcess;
    try {
        pythonProcess = spawn(pythonCmd, args, {
            cwd: PROJECT_ROOT,
            env: envVars
        });
    } catch (spawnErr) {
        console.warn('[AgentController] Direct spawn exception, using Native JS Agent Fallback:', spawnErr.message);
        return runNativeJsAgentLoop(req, res, { prompt, sessionId, workspaceDir, apiKey, model });
    }

    let stdoutBuffer = '';
    let filesCount = 0;
    let fallbackActivated = false;

    pythonProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop(); // keep last partial line

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                try {
                    const eventData = JSON.parse(trimmed);
                    if (eventData.type === 'file_created') {
                        filesCount++;
                        updateSessionInRegistry(sessionId, { filesCount });
                    } else if (eventData.type === 'output') {
                        updateSessionInRegistry(sessionId, { status: 'delivered', filesCount });
                    }
                    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
                } catch (e) {
                    res.write(`data: ${JSON.stringify({ type: 'log', message: trimmed })}\n\n`);
                }
            }
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        const errText = data.toString('utf-8').trim();
        if (errText) {
            console.error(`[Python stderr]: ${errText}`);
            res.write(`data: ${JSON.stringify({ type: 'stderr', message: errText })}\n\n`);
        }
    });

    pythonProcess.on('close', (code, signal) => {
        console.log(`[AgentController] Python process finished (Code: ${code}, Signal: ${signal || 'none'})`);
        if (!fallbackActivated) {
            updateSessionInRegistry(sessionId, { status: code === 0 ? 'delivered' : 'failed' });
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({ type: 'done', code, signal, sessionId })}\n\n`);
                res.end();
            }
        }
    });

    pythonProcess.on('error', (err) => {
        console.error('[AgentController] Process spawn error:', err.message);
        if (err.code === 'ENOENT' && !fallbackActivated) {
            fallbackActivated = true;
            console.log('[AgentController] Python binary missing in Vercel serverless environment. Activating Native JS Agent Fallback...');
            runNativeJsAgentLoop(req, res, { prompt, sessionId, workspaceDir, apiKey, model });
        } else if (!res.writableEnded) {
            updateSessionInRegistry(sessionId, { status: 'failed', error: err.message });
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        }
    });

    req.on('close', () => {
        if (pythonProcess && !pythonProcess.killed && pythonProcess.exitCode === null) {
            console.log(`[AgentController] Stream connection closed by client for session ${sessionId}`);
        }
    });
};

// 2. Get Sessions List (Filtered by Client IP & Session ID)
const getSessionsList = (req, res) => {
    const clientIp = getClientIp(req);
    const registry = getRegistry();
    
    // Filter sessions matching client IP (or all if local testing)
    const userSessions = registry.filter(s => s.clientIp === clientIp || clientIp === '127.0.0.1' || !s.clientIp);
    res.json({
        clientIp,
        sessions: userSessions
    });
};

// 3. Get Workspace Files Controller
const getWorkspaceFiles = (req, res) => {
    const { sessionId } = req.params;
    let targetDir = getWorkspaceBaseDir();
    if (sessionId && sessionId !== 'default') {
        targetDir = path.join(getWorkspaceBaseDir(), sessionId);
    }

    if (!fs.existsSync(targetDir)) {
        return res.json({ sessionId, files: {} });
    }

    try {
        const filesMap = {};
        const readRecursive = (dir, relDir = '') => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const relPath = relDir ? path.join(relDir, item) : item;
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    readRecursive(fullPath, relPath);
                } else if (!item.endsWith('.json')) {
                    const normalizedRelPath = relPath.replace(/\\/g, '/');
                    filesMap[normalizedRelPath] = fs.readFileSync(fullPath, 'utf-8');
                }
            }
        };

        readRecursive(targetDir);
        res.json({ sessionId, files: filesMap });
    } catch (e) {
        res.status(500).json({ error: `Error reading files: ${e.message}` });
    }
};

// 4. Download Zip Controller
const downloadZip = (req, res) => {
    const { sessionId } = req.params;
    let targetDir = getWorkspaceBaseDir();
    if (sessionId && sessionId !== 'default') {
        targetDir = path.join(getWorkspaceBaseDir(), sessionId);
    }

    if (!fs.existsSync(targetDir)) {
        return res.status(404).send('Workspace directory not found or still generating.');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="project_${sessionId || 'workspace'}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
        console.error('[Archive Error]:', err);
        res.status(500).send({ error: err.message });
    });

    archive.pipe(res);
    archive.directory(targetDir, false);
    archive.finalize();
};

module.exports = {
    generateStream,
    getSessionsList,
    getWorkspaceFiles,
    downloadZip
};
