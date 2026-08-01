const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { generateStream, getSessionsList, getWorkspaceFiles, downloadZip } = require('./controllers/agentController');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors({ origin: '*' }));
app.use(express.json());

// API Routes
app.post('/api/generate/stream', generateStream);
app.get('/api/sessions', getSessionsList);
app.get('/api/workspace/:sessionId/files', getWorkspaceFiles);
app.get('/api/workspace/files', (req, res) => getWorkspaceFiles({ ...req, params: { sessionId: 'default' } }, res));
app.get('/api/workspace/:sessionId/download', downloadZip);
app.get('/api/workspace/download', (req, res) => downloadZip({ ...req, params: { sessionId: 'default' } }, res));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start Server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`🚀 Cursor Agent Express Backend running on port ${PORT}`);
        console.log(`🔗 API Base: http://localhost:${PORT}`);
        console.log(`==================================================`);
    });
}

module.exports = app;
