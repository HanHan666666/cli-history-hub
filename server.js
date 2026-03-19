const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3456;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// In-memory cache: keyed by absolute file path, stores { mtime, data }
// ---------------------------------------------------------------------------
const sessionCache = new Map();

// ---------------------------------------------------------------------------
// XML tag stripping for user messages
// ---------------------------------------------------------------------------
const XML_STRIP_TAGS = [
  'local-command-caveat',
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'system-reminder',
];

function stripXmlTags(text) {
  if (typeof text !== 'string') return '';
  let cleaned = text;
  for (const tag of XML_STRIP_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g'), '');
  }
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// Read sidecar meta file for a session
// ---------------------------------------------------------------------------
function readSidecarMeta(projectDir, sessionId) {
  const metaPath = path.join(projectDir, 'session-meta', `${sessionId}.json`);
  try {
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

// ---------------------------------------------------------------------------
// Write sidecar meta file for a session
// ---------------------------------------------------------------------------
function writeSidecarMeta(projectDir, sessionId, meta) {
  const metaDir = path.join(projectDir, 'session-meta');
  if (!fs.existsSync(metaDir)) {
    fs.mkdirSync(metaDir, { recursive: true });
  }
  const metaPath = path.join(metaDir, `${sessionId}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

// ---------------------------------------------------------------------------
// Extract session metadata from a .jsonl file (with caching by mtime)
// ---------------------------------------------------------------------------
function extractSessionMeta(filePath, sessionId, projectDir) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let firstPrompt = null;
    let customNameFromJsonl = null;
    let created = null;
    let modified = null;
    let gitBranch = null;
    let projectPath = null;
    let messageCount = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      // Track timestamps
      if (obj.timestamp) {
        const ts = obj.timestamp;
        if (!created || ts < created) created = ts;
        if (!modified || ts > modified) modified = ts;
      }

      // Extract git branch and project path
      if (!gitBranch && obj.gitBranch) gitBranch = obj.gitBranch;
      if (!projectPath && obj.cwd) projectPath = obj.cwd;

      // Extract session rename from system messages
      if (obj.type === 'system' && obj.subtype === 'local_command' &&
          typeof obj.content === 'string' && obj.content.includes('Session renamed to:')) {
        const match = obj.content.match(/Session renamed to:\s*(.+?)(?:<|$)/);
        if (match) customNameFromJsonl = match[1].trim();
      }

      // Extract first user prompt
      if (obj.type === 'user' && obj.message && !obj.isMeta && !firstPrompt) {
        const c = obj.message.content;
        if (typeof c === 'string') {
          const cleaned = stripXmlTags(c);
          if (cleaned) firstPrompt = cleaned;
        } else if (Array.isArray(c)) {
          const text = stripXmlTags(
            c.filter(b => b.type === 'text').map(b => b.text).join('\n')
          );
          if (text) firstPrompt = text;
        }
      }

      // Count user and assistant messages
      if ((obj.type === 'user' && obj.message && !obj.isMeta) ||
          (obj.type === 'assistant' && obj.message)) {
        messageCount++;
      }
    }

    // Read sidecar meta for custom name, tags, favorite
    const sidecar = readSidecarMeta(projectDir, sessionId);
    const customName = sidecar.customName || customNameFromJsonl || null;
    const tags = sidecar.tags || [];
    const isFavorite = sidecar.isFavorite || false;

    return {
      sessionId,
      firstPrompt: firstPrompt || 'No prompt',
      customName,
      displayName: customName || (firstPrompt ? firstPrompt.substring(0, 100) : 'Untitled'),
      messageCount,
      created,
      modified,
      gitBranch,
      projectPath,
      tags,
      isFavorite,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scan all sessions for a project directory (with caching)
// ---------------------------------------------------------------------------
function scanProjectSessions(projectDir) {
  let files;
  try {
    files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const sessions = [];
  for (const file of files) {
    const sessionId = file.replace('.jsonl', '');
    const filePath = path.join(projectDir, file);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const cacheKey = filePath;
    const cached = sessionCache.get(cacheKey);

    // Also check sidecar mtime so tag/fav/name changes invalidate
    const sidecarPath = path.join(projectDir, 'session-meta', `${sessionId}.json`);
    let sidecarMtime = 0;
    try { sidecarMtime = fs.statSync(sidecarPath).mtimeMs; } catch { /* no sidecar */ }

    if (cached && cached.mtime === stat.mtimeMs && cached.sidecarMtime === sidecarMtime) {
      if (cached.data && cached.data.messageCount > 0) sessions.push(cached.data);
      continue;
    }

    const meta = extractSessionMeta(filePath, sessionId, projectDir);
    sessionCache.set(cacheKey, { mtime: stat.mtimeMs, sidecarMtime, data: meta });
    if (meta && meta.messageCount > 0) {
      sessions.push(meta);
    }
  }

  return sessions.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
}

// ---------------------------------------------------------------------------
// Get real project path by scanning jsonl files for cwd field
// ---------------------------------------------------------------------------
function getProjectPath(projectDir) {
  let files;
  try {
    files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return null;
  }

  for (const jf of files.slice(0, 5)) {
    try {
      const content = fs.readFileSync(path.join(projectDir, jf), 'utf-8');
      for (const line of content.split('\n').slice(0, 30)) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        if (obj.cwd) return obj.cwd;
      }
    } catch { /* continue */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse all messages from a jsonl file, merge consecutive assistant turns
// ---------------------------------------------------------------------------
function parseSessionMessages(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rawMessages = [];
  let customNameFromJsonl = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Extract rename
    if (obj.type === 'system' && obj.subtype === 'local_command' &&
        typeof obj.content === 'string' && obj.content.includes('Session renamed to:')) {
      const match = obj.content.match(/Session renamed to:\s*(.+?)(?:<|$)/);
      if (match) customNameFromJsonl = match[1].trim();
    }

    // User messages (non-meta)
    if (obj.type === 'user' && obj.message && !obj.isMeta) {
      rawMessages.push(formatUserMessage(obj));
    }
    // Assistant messages
    else if (obj.type === 'assistant' && obj.message) {
      rawMessages.push(formatAssistantMessage(obj));
    }
  }

  // Merge consecutive assistant messages into turns
  const merged = [];
  for (const msg of rawMessages) {
    if (msg.type === 'assistant' && merged.length > 0 && merged[merged.length - 1].type === 'assistant') {
      const prev = merged[merged.length - 1];
      // Merge blocks
      prev.blocks = (prev.blocks || []).concat(msg.blocks || []);
      // Use later timestamp
      if (msg.timestamp && (!prev.timestamp || msg.timestamp > prev.timestamp)) {
        prev.timestamp = msg.timestamp;
      }
      // Use later model if present
      if (msg.model) prev.model = msg.model;
      // Aggregate usage
      if (msg.usage) {
        if (!prev.usage) {
          prev.usage = { ...msg.usage };
        } else {
          prev.usage.input_tokens = (prev.usage.input_tokens || 0) + (msg.usage.input_tokens || 0);
          prev.usage.output_tokens = (prev.usage.output_tokens || 0) + (msg.usage.output_tokens || 0);
          prev.usage.cache_creation_input_tokens = (prev.usage.cache_creation_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0);
          prev.usage.cache_read_input_tokens = (prev.usage.cache_read_input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0);
        }
      }
      // Merge gitBranch
      if (msg.gitBranch && !prev.gitBranch) prev.gitBranch = msg.gitBranch;
    } else {
      merged.push(msg);
    }
  }

  return { messages: merged, customNameFromJsonl };
}

function formatUserMessage(obj) {
  const msg = {
    type: 'user',
    uuid: obj.uuid,
    timestamp: obj.timestamp,
  };
  const content = obj.message?.content;
  if (typeof content === 'string') {
    msg.text = stripXmlTags(content);
  } else if (Array.isArray(content)) {
    msg.text = stripXmlTags(
      content.filter(c => c.type === 'text').map(c => c.text).join('\n')
    );
  } else {
    msg.text = '';
  }
  return msg;
}

function formatAssistantMessage(obj) {
  const msg = {
    type: 'assistant',
    uuid: obj.uuid,
    timestamp: obj.timestamp,
    model: obj.message?.model || null,
    usage: obj.message?.usage || null,
    gitBranch: obj.gitBranch || null,
    blocks: [],
  };

  const content = obj.message?.content;
  if (Array.isArray(content)) {
    msg.blocks = content.map(block => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      } else if (block.type === 'thinking') {
        return { type: 'thinking', thinking: block.thinking || '' };
      } else if (block.type === 'tool_use') {
        return { type: 'tool_use', name: block.name, input: block.input };
      } else if (block.type === 'tool_result') {
        return { type: 'tool_result', content: block.content };
      }
      return { type: block.type || 'unknown' };
    });
  } else if (typeof content === 'string') {
    msg.blocks = [{ type: 'text', text: content }];
  }

  return msg;
}

// ---------------------------------------------------------------------------
// List all project directories
// ---------------------------------------------------------------------------
function listProjectDirs() {
  try {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        dirName: e.name,
        dirPath: path.join(PROJECTS_DIR, e.name),
      }));
  } catch {
    return [];
  }
}

// ===========================================================================
// API ENDPOINTS
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. GET /api/projects
// ---------------------------------------------------------------------------
app.get('/api/projects', (req, res) => {
  try {
    const projectDirs = listProjectDirs();
    const projects = [];

    for (const { dirName, dirPath } of projectDirs) {
      const sessions = scanProjectSessions(dirPath);
      const sessionCount = sessions.length;
      if (sessionCount === 0) continue;

      const projectPath = getProjectPath(dirPath);
      const displayPath = projectPath || dirName.replace(/^-/, '/').replace(/-/g, '/');

      projects.push({
        id: dirName,
        name: displayPath,
        shortName: displayPath.split('/').filter(Boolean).slice(-2).join('/') || dirName,
        sessionCount,
      });
    }

    projects.sort((a, b) => b.sessionCount - a.sessionCount);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. GET /api/projects/:pid/sessions-full
// ---------------------------------------------------------------------------
app.get('/api/projects/:pid/sessions-full', (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.pid);
    if (!fs.existsSync(projectDir)) return res.json([]);
    const sessions = scanProjectSessions(projectDir);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3. GET /api/projects/:pid/sessions/:sid?page=1&pageSize=30
// ---------------------------------------------------------------------------
app.get('/api/projects/:pid/sessions/:sid', (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.pid);
    const jsonlPath = path.join(projectDir, `${req.params.sid}.jsonl`);
    if (!fs.existsSync(jsonlPath)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { messages, customNameFromJsonl } = parseSessionMessages(jsonlPath);

    // Sidecar meta
    const sidecar = readSidecarMeta(projectDir, req.params.sid);
    const customName = sidecar.customName || customNameFromJsonl || null;
    const tags = sidecar.tags || [];
    const isFavorite = sidecar.isFavorite || false;

    const totalMessages = messages.length;

    // Pagination: page 1 = most recent messages
    const pageParam = req.query.page ? parseInt(req.query.page, 10) : null;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize, 10) : 30;

    if (pageParam !== null && pageParam > 0) {
      const totalPages = Math.max(1, Math.ceil(totalMessages / pageSize));
      const page = Math.min(pageParam, totalPages);

      // page 1 = most recent, page N = oldest
      // Calculate the slice from the end
      const endIdx = totalMessages - (page - 1) * pageSize;
      const startIdx = Math.max(0, endIdx - pageSize);
      const sliced = messages.slice(startIdx, endIdx);

      return res.json({
        customName,
        tags,
        isFavorite,
        messages: sliced,
        totalMessages,
        page,
        pageSize,
        totalPages,
      });
    }

    // No pagination — return all
    res.json({
      customName,
      tags,
      isFavorite,
      messages,
      totalMessages,
      page: 1,
      pageSize: totalMessages,
      totalPages: 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 4. PUT /api/projects/:pid/sessions/:sid/meta
// ---------------------------------------------------------------------------
app.put('/api/projects/:pid/sessions/:sid/meta', (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.pid);
    const jsonlPath = path.join(projectDir, `${req.params.sid}.jsonl`);
    if (!fs.existsSync(jsonlPath)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { customName, tags, isFavorite } = req.body;
    const existing = readSidecarMeta(projectDir, req.params.sid);

    if (customName !== undefined) existing.customName = customName;
    if (tags !== undefined) existing.tags = tags;
    if (isFavorite !== undefined) existing.isFavorite = isFavorite;
    existing.updatedAt = new Date().toISOString();

    writeSidecarMeta(projectDir, req.params.sid, existing);

    // Invalidate cache for this session
    const cacheKey = jsonlPath;
    sessionCache.delete(cacheKey);

    res.json({ ok: true, meta: existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. GET /api/search?q=keyword&project=projectId
// ---------------------------------------------------------------------------
app.get('/api/search', (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) {
      return res.status(400).json({ error: 'q parameter is required' });
    }

    const projectFilter = req.query.project || null;
    const MAX_RESULTS = 50;
    const results = [];

    const projectDirs = listProjectDirs();
    const targetDirs = projectFilter
      ? projectDirs.filter(p => p.dirName === projectFilter)
      : projectDirs;

    outer:
    for (const { dirName, dirPath } of targetDirs) {
      const projectPath = getProjectPath(dirPath);
      const projectName = projectPath || dirName.replace(/^-/, '/').replace(/-/g, '/');

      let files;
      try {
        files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      for (const file of files) {
        if (results.length >= MAX_RESULTS) break outer;

        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(dirPath, file);
        let content;
        try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

        // Get session display name
        const sidecar = readSidecarMeta(dirPath, sessionId);
        let sessionName = sidecar.customName || null;

        for (const line of content.split('\n')) {
          if (results.length >= MAX_RESULTS) break;
          if (!line.trim()) continue;

          let obj;
          try { obj = JSON.parse(line); } catch { continue; }

          // Extract rename for session name fallback
          if (!sessionName && obj.type === 'system' && obj.subtype === 'local_command' &&
              typeof obj.content === 'string' && obj.content.includes('Session renamed to:')) {
            const match = obj.content.match(/Session renamed to:\s*(.+?)(?:<|$)/);
            if (match) sessionName = match[1].trim();
          }

          let searchText = null;

          if (obj.type === 'user' && obj.message && !obj.isMeta) {
            const c = obj.message.content;
            if (typeof c === 'string') {
              searchText = stripXmlTags(c);
            } else if (Array.isArray(c)) {
              searchText = stripXmlTags(
                c.filter(b => b.type === 'text').map(b => b.text).join('\n')
              );
            }
          } else if (obj.type === 'assistant' && obj.message) {
            const c = obj.message.content;
            if (Array.isArray(c)) {
              searchText = c
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join('\n');
            } else if (typeof c === 'string') {
              searchText = c;
            }
          }

          if (searchText) {
            const lowerText = searchText.toLowerCase();
            const idx = lowerText.indexOf(query);
            if (idx !== -1) {
              const contextStart = Math.max(0, idx - 50);
              const contextEnd = Math.min(searchText.length, idx + query.length + 50);
              const matchContext = (contextStart > 0 ? '...' : '') +
                searchText.substring(contextStart, contextEnd) +
                (contextEnd < searchText.length ? '...' : '');

              results.push({
                projectId: dirName,
                projectName,
                sessionId,
                sessionName: sessionName || sessionId.substring(0, 8),
                matchContext,
                timestamp: obj.timestamp || null,
              });
            }
          }
        }
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 6. GET /api/stats?project=projectId
// ---------------------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  try {
    const projectFilter = req.query.project || null;
    const projectDirs = listProjectDirs();
    const targetDirs = projectFilter
      ? projectDirs.filter(p => p.dirName === projectFilter)
      : projectDirs;

    const totalTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    let totalSessions = 0;
    let totalMessages = 0;

    const dailyMap = new Map(); // date string -> { input, output }
    const byProjectMap = new Map(); // projectId -> { projectName, input, output }
    const byModelMap = new Map(); // model -> { count, output }

    // Determine the 30-day window
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const { dirName, dirPath } of targetDirs) {
      const projectPath = getProjectPath(dirPath);
      const projectName = projectPath || dirName.replace(/^-/, '/').replace(/-/g, '/');

      let files;
      try {
        files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      let projectInput = 0;
      let projectOutput = 0;
      let projectSessionCount = 0;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        let content;
        try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

        let sessionHasMessages = false;

        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }

          // Count user + assistant messages
          if ((obj.type === 'user' && obj.message && !obj.isMeta) ||
              (obj.type === 'assistant' && obj.message)) {
            totalMessages++;
            sessionHasMessages = true;
          }

          // Aggregate usage from assistant messages
          if (obj.type === 'assistant' && obj.message && obj.message.usage) {
            const usage = obj.message.usage;
            const inputTok = usage.input_tokens || 0;
            const outputTok = usage.output_tokens || 0;
            const cachCreation = usage.cache_creation_input_tokens || 0;
            const cachRead = usage.cache_read_input_tokens || 0;

            totalTokens.input += inputTok;
            totalTokens.output += outputTok;
            totalTokens.cacheCreation += cachCreation;
            totalTokens.cacheRead += cachRead;

            projectInput += inputTok;
            projectOutput += outputTok;

            // Daily aggregation (last 30 days only)
            if (obj.timestamp) {
              const ts = new Date(obj.timestamp);
              if (ts >= thirtyDaysAgo) {
                const dateStr = ts.toISOString().split('T')[0];
                const existing = dailyMap.get(dateStr) || { input: 0, output: 0 };
                existing.input += inputTok;
                existing.output += outputTok;
                dailyMap.set(dateStr, existing);
              }
            }

            // By model
            const model = obj.message.model || 'unknown';
            const modelEntry = byModelMap.get(model) || { count: 0, output: 0 };
            modelEntry.count += 1;
            modelEntry.output += outputTok;
            byModelMap.set(model, modelEntry);
          }
        }

        if (sessionHasMessages) {
          projectSessionCount++;
        }
      }

      totalSessions += projectSessionCount;

      if (projectInput > 0 || projectOutput > 0) {
        byProjectMap.set(dirName, {
          projectId: dirName,
          projectName,
          input: projectInput,
          output: projectOutput,
        });
      }
    }

    // Build daily array sorted by date
    const daily = Array.from(dailyMap.entries())
      .map(([date, vals]) => ({ date, input: vals.input, output: vals.output }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Build byProject array sorted by total descending
    const byProject = Array.from(byProjectMap.values())
      .sort((a, b) => (b.input + b.output) - (a.input + a.output));

    // Build byModel array sorted by count descending
    const byModel = Array.from(byModelMap.entries())
      .map(([model, vals]) => ({ model, count: vals.count, output: vals.output }))
      .sort((a, b) => b.count - a.count);

    res.json({
      totalTokens,
      totalSessions,
      totalMessages,
      daily,
      byProject,
      byModel,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 7. GET /api/tags
// ---------------------------------------------------------------------------
app.get('/api/tags', (req, res) => {
  try {
    const allTags = new Set();
    const projectDirs = listProjectDirs();

    for (const { dirPath } of projectDirs) {
      const metaDir = path.join(dirPath, 'session-meta');
      let metaFiles;
      try {
        metaFiles = fs.readdirSync(metaDir).filter(f => f.endsWith('.json'));
      } catch { continue; }

      for (const mf of metaFiles) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(metaDir, mf), 'utf-8'));
          if (Array.isArray(meta.tags)) {
            for (const tag of meta.tags) {
              if (typeof tag === 'string' && tag.trim()) {
                allTags.add(tag.trim());
              }
            }
          }
        } catch { /* ignore */ }
      }
    }

    res.json({ tags: Array.from(allTags).sort() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// Start server
// ===========================================================================
app.listen(PORT, () => {
  console.log(`Claude History Viewer running at http://localhost:${PORT}`);
  console.log(`Reading data from: ${CLAUDE_DIR}`);
});
