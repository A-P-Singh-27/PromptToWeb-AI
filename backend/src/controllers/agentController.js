const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
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

// 1. SSE Stream Controller: Spawns cursor.py and streams JSON events live
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

    const pythonProcess = spawn(pythonCmd, args, {
        cwd: PROJECT_ROOT,
        env: envVars
    });

    let stdoutBuffer = '';
    let filesCount = 0;

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
        updateSessionInRegistry(sessionId, { status: code === 0 ? 'delivered' : 'failed' });
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'done', code, signal, sessionId })}\n\n`);
            res.end();
        }
    });

    pythonProcess.on('error', (err) => {
        console.error('[AgentController] Process spawn error:', err);
        updateSessionInRegistry(sessionId, { status: 'failed', error: err.message });
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        }
    });

    req.on('close', () => {
        if (!pythonProcess.killed && pythonProcess.exitCode === null) {
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
