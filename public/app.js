/**
 * Claude Code History Viewer - Main Application
 *
 * Orchestrates modules: Router, Search, ChatView, Stats, Features
 * Exposes window.App for module interop.
 */
(function () {
  'use strict';

  // =========================================================================
  // Application state
  // =========================================================================
  const state = {
    currentProjectId: null,
    currentSessionId: null,
    projects: [],
    sessions: [],
    filteredSessions: [],
    currentMessages: [],
    currentSessionMeta: {},
  };

  // =========================================================================
  // DOM element cache
  // =========================================================================
  const $ = (sel) => document.querySelector(sel);
  const dom = {};

  function cacheDom() {
    dom.projectList = $('#projectList');
    dom.welcomeView = $('#welcomeView');
    dom.sessionListView = $('#sessionListView');
    dom.chatView = $('#chatView');
    dom.statsView = $('#statsView');
    dom.sessionListTitle = $('#sessionListTitle');
    dom.sessionCount = $('#sessionCount');
    dom.branchFilter = $('#branchFilter');
    dom.sessionSearchInput = $('#sessionSearchInput');
    dom.sessionList = $('#sessionList');
    dom.chatTitle = $('#chatTitle');
    dom.chatMeta = $('#chatMeta');
    dom.chatTags = $('#chatTags');
    dom.chatMessages = $('#chatMessages');
    dom.messagesContainer = $('#messagesContainer');
    dom.backBtn = $('#backBtn');
    dom.renameBtn = $('#renameBtn');
    dom.tagBtn = $('#tagBtn');
    dom.exportBtn = $('#exportBtn');
    dom.favoriteBtn = $('#favoriteBtn');
    dom.globalSearchBtn = $('#globalSearchBtn');
    dom.statsBtn = $('#statsBtn');
    dom.statsBackBtn = $('#statsBackBtn');
    dom.toast = $('#toast');
  }

  // =========================================================================
  // Helper utilities
  // =========================================================================

  /**
   * Fetch wrapper that returns parsed JSON. Throws on non-ok responses.
   */
  async function api(path, options) {
    const url = path.startsWith('/') ? path : '/' + path;
    const resp = await fetch(url, options);
    if (!resp.ok) {
      let errMsg = resp.statusText;
      try {
        const body = await resp.json();
        errMsg = body.error || errMsg;
      } catch (_e) { /* ignore parse error */ }
      throw new Error(errMsg);
    }
    return resp.json();
  }

  /**
   * Escape HTML to prevent XSS in user-provided content.
   */
  function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  /**
   * Format an ISO date string to zh-CN locale YYYY/MM/DD.
   */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '/' + mm + '/' + dd;
  }

  /**
   * Format an ISO date string to MM/DD HH:mm.
   */
  function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return mm + '/' + dd + ' ' + hh + ':' + min;
  }

  // =========================================================================
  // View management
  // =========================================================================

  const VIEW_IDS = {
    welcome: 'welcomeView',
    sessions: 'sessionListView',
    chat: 'chatView',
    stats: 'statsView',
  };

  /**
   * Show one view, hide the others.
   */
  function showView(name) {
    for (const key of Object.keys(VIEW_IDS)) {
      const el = document.getElementById(VIEW_IDS[key]);
      if (!el) continue;
      if (key === name) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  }

  // =========================================================================
  // Toast notification
  // =========================================================================
  let toastTimer = null;

  function showToast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      dom.toast.classList.add('hidden');
      toastTimer = null;
    }, 3000);
  }

  // =========================================================================
  // Smart title logic (#10)
  // =========================================================================

  var GENERIC_NAMES = [
    'hi', 'hello', 'hey', 'test', 'no prompt', 'untitled',
    'help', 'ok', 'yes', 'no', 'thanks', 'please', 'hola',
  ];

  /**
   * Determine the best display title for a session.
   * If displayName is generic and firstPrompt provides better context, prefer that.
   */
  function smartTitle(session) {
    var displayName = session.displayName || '';
    var customName = session.customName || null;
    var firstPrompt = session.firstPrompt || '';

    // If there is a customName, always prefer it
    if (customName) return customName;

    // Check if displayName is generic
    var nameLower = displayName.trim().toLowerCase();
    var isGeneric =
      !nameLower ||
      GENERIC_NAMES.indexOf(nameLower) !== -1 ||
      (nameLower.split(/\s+/).length === 1 && nameLower.length <= 6);

    if (isGeneric && firstPrompt && firstPrompt !== 'No prompt') {
      var trimmed = firstPrompt.trim();
      if (trimmed.length > 10) {
        return trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
      }
    }

    return displayName || 'Untitled';
  }

  // =========================================================================
  // Time grouping helpers (#1)
  // =========================================================================

  /**
   * Determine which time group a date falls into relative to now.
   */
  function getTimeGroup(dateStr) {
    if (!dateStr) return 'Earlier';

    var now = new Date();
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Earlier';

    // Strip time to compare calendar dates
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diffMs = today.getTime() - target.getTime();
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This Week';
    if (diffDays < 30) return 'This Month';
    return 'Earlier';
  }

  var TIME_GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'This Month', 'Earlier'];

  // =========================================================================
  // Project list (#1)
  // =========================================================================

  async function loadProjects() {
    try {
      var projects = await api('/api/projects');
      state.projects = projects;
      renderProjectList();
    } catch (err) {
      console.error('Failed to load projects:', err);
      showToast('Failed to load projects');
    }
  }

  function renderProjectList() {
    if (!dom.projectList) return;
    dom.projectList.innerHTML = '';

    for (var i = 0; i < state.projects.length; i++) {
      var proj = state.projects[i];
      var item = document.createElement('div');
      item.className = 'project-item';
      if (proj.id === state.currentProjectId) {
        item.classList.add('active');
      }
      item.innerHTML =
        '<span class="project-name">' + escapeHtml(proj.shortName || proj.name) + '</span>' +
        '<span class="badge">' + escapeHtml(String(proj.sessionCount)) + '</span>';
      item.title = proj.name;
      item.dataset.id = proj.id;
      (function (pid) {
        item.addEventListener('click', function () { selectProject(pid); });
      })(proj.id);
      dom.projectList.appendChild(item);
    }
  }

  // =========================================================================
  // Project selection & session loading
  // =========================================================================

  async function selectProject(projectId) {
    state.currentProjectId = projectId;
    state.currentSessionId = null;

    // Update active state in sidebar
    renderProjectList();

    // Navigate via router (only if not already driven by router)
    if (!window.App._routerDriven && window.Router && window.Router.navigate) {
      window.Router.navigate('#/project/' + encodeURIComponent(projectId));
    }

    await loadSessions(projectId);
    showView('sessions');
  }

  async function loadSessions(projectId) {
    try {
      var sessions = await api('/api/projects/' + encodeURIComponent(projectId) + '/sessions-full');
      state.sessions = sessions;
      state.filteredSessions = sessions;

      // Update header
      var project = null;
      for (var i = 0; i < state.projects.length; i++) {
        if (state.projects[i].id === projectId) { project = state.projects[i]; break; }
      }
      if (dom.sessionListTitle) {
        dom.sessionListTitle.textContent = project ? (project.shortName || project.name) : projectId;
      }

      // Populate branch filter
      populateBranchFilter(sessions);

      // Reset search input
      if (dom.sessionSearchInput) {
        dom.sessionSearchInput.value = '';
      }

      // Reset branch filter
      if (dom.branchFilter) {
        dom.branchFilter.value = '';
      }

      applyFilters();
    } catch (err) {
      console.error('Failed to load sessions:', err);
      showToast('Failed to load sessions');
    }
  }

  // =========================================================================
  // Branch filter (#3)
  // =========================================================================

  function populateBranchFilter(sessions) {
    if (!dom.branchFilter) return;

    // Collect unique branches
    var branchSet = {};
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].gitBranch) {
        branchSet[sessions[i].gitBranch] = true;
      }
    }

    // Reset options
    dom.branchFilter.innerHTML = '<option value="">All Branches</option>';
    var sorted = Object.keys(branchSet).sort();
    for (var j = 0; j < sorted.length; j++) {
      var opt = document.createElement('option');
      opt.value = sorted[j];
      opt.textContent = sorted[j];
      dom.branchFilter.appendChild(opt);
    }
  }

  // =========================================================================
  // Session search & filter (#4)
  // =========================================================================

  function applyFilters() {
    var searchTerm = (dom.sessionSearchInput ? dom.sessionSearchInput.value : '').trim().toLowerCase();
    var branchValue = dom.branchFilter ? dom.branchFilter.value : '';

    var filtered = state.sessions;

    // Branch filter
    if (branchValue) {
      filtered = filtered.filter(function (s) { return s.gitBranch === branchValue; });
    }

    // Text search filter: match against displayName, firstPrompt, customName, tags
    if (searchTerm) {
      filtered = filtered.filter(function (s) {
        var parts = [
          s.displayName || '',
          s.firstPrompt || '',
          s.customName || '',
        ];
        if (s.tags && s.tags.length) {
          for (var i = 0; i < s.tags.length; i++) {
            parts.push(s.tags[i]);
          }
        }
        var haystack = parts.join(' ').toLowerCase();
        return haystack.indexOf(searchTerm) !== -1;
      });
    }

    state.filteredSessions = filtered;

    // Update session count badge
    if (dom.sessionCount) {
      dom.sessionCount.textContent = filtered.length;
    }

    renderSessionList();
  }

  // =========================================================================
  // Session list rendering with time grouping & favorites (#1, #6)
  // =========================================================================

  function renderSessionList() {
    if (!dom.sessionList) return;
    dom.sessionList.innerHTML = '';

    var sessions = state.filteredSessions;
    if (!sessions || sessions.length === 0) {
      dom.sessionList.innerHTML = '<div class="empty-state">No sessions found.</div>';
      return;
    }

    // Separate favorited and non-favorited sessions (#6)
    var pinned = [];
    var rest = [];
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].isFavorite) {
        pinned.push(sessions[i]);
      } else {
        rest.push(sessions[i]);
      }
    }

    // Build time groups for the non-pinned sessions
    var groups = {};
    for (var g = 0; g < TIME_GROUP_ORDER.length; g++) {
      groups[TIME_GROUP_ORDER[g]] = [];
    }

    for (var k = 0; k < rest.length; k++) {
      var group = getTimeGroup(rest[k].modified);
      if (!groups[group]) groups[group] = [];
      groups[group].push(rest[k]);
    }

    // Render pinned group first (if any)
    if (pinned.length > 0) {
      renderTimeGroup(dom.sessionList, 'Pinned', pinned);
    }

    // Render each time group
    for (var t = 0; t < TIME_GROUP_ORDER.length; t++) {
      var groupName = TIME_GROUP_ORDER[t];
      var groupSessions = groups[groupName];
      if (!groupSessions || groupSessions.length === 0) continue;
      renderTimeGroup(dom.sessionList, groupName, groupSessions);
    }
  }

  function renderTimeGroup(container, groupName, sessions) {
    var groupEl = document.createElement('div');
    groupEl.className = 'time-group';

    var headerEl = document.createElement('div');
    headerEl.className = 'time-group-header';
    headerEl.textContent = groupName;
    groupEl.appendChild(headerEl);

    for (var i = 0; i < sessions.length; i++) {
      var card = createSessionCard(sessions[i]);
      groupEl.appendChild(card);
    }

    container.appendChild(groupEl);
  }

  function createSessionCard(session) {
    var card = document.createElement('div');
    card.className = 'session-card';
    (function (sid) {
      card.addEventListener('click', function () { openSession(sid); });
    })(session.sessionId);

    var title = smartTitle(session);

    // Show subtitle only if firstPrompt differs meaningfully from the title
    var subtitle = null;
    if (session.firstPrompt &&
        session.firstPrompt !== 'No prompt' &&
        title !== session.firstPrompt &&
        title !== (session.firstPrompt.length > 80 ? session.firstPrompt.substring(0, 80) + '...' : session.firstPrompt)) {
      subtitle = session.firstPrompt;
    }

    // Build card HTML
    var html = '<div class="session-card-header">';

    // Favorite star (#6) - only show if favorited
    if (session.isFavorite) {
      html += '<span class="session-star favorited">&#9733;</span>';
    }

    // Title
    html += '<span class="session-title">' + escapeHtml(title) + '</span>';
    html += '</div>';

    // Subtitle (first prompt preview, only if different from title)
    if (subtitle) {
      var truncatedSubtitle = subtitle.length > 120 ? subtitle.substring(0, 120) + '...' : subtitle;
      html += '<div class="session-subtitle">' + escapeHtml(truncatedSubtitle) + '</div>';
    }

    // Meta row: date, message count, branch
    html += '<div class="session-meta">';
    html += '<span class="session-date">' + escapeHtml(formatTime(session.modified)) + '</span>';
    html += '<span class="session-msg-count">' + escapeHtml(String(session.messageCount || 0)) + ' messages</span>';
    if (session.gitBranch) {
      html += '<span class="session-branch">' + escapeHtml(session.gitBranch) + '</span>';
    }
    html += '</div>';

    // Tags
    if (session.tags && session.tags.length > 0) {
      html += '<div class="session-tags">';
      for (var i = 0; i < session.tags.length; i++) {
        html += '<span class="tag">' + escapeHtml(session.tags[i]) + '</span>';
      }
      html += '</div>';
    }

    card.innerHTML = html;
    return card;
  }

  // =========================================================================
  // Open a session (chat view) (#7)
  // =========================================================================

  async function openSession(sessionId) {
    if (!state.currentProjectId) return;

    state.currentSessionId = sessionId;

    // Navigate via router (#9)
    if (!window.App._routerDriven && window.Router && window.Router.navigate) {
      window.Router.navigate('#/project/' + encodeURIComponent(state.currentProjectId) + '/session/' + encodeURIComponent(sessionId));
    }

    try {
      var data = await api(
        '/api/projects/' + encodeURIComponent(state.currentProjectId) +
        '/sessions/' + encodeURIComponent(sessionId)
      );

      state.currentMessages = data.messages || [];
      state.currentSessionMeta = {
        customName: data.customName,
        tags: data.tags || [],
        isFavorite: data.isFavorite || false,
        totalMessages: data.totalMessages,
        page: data.page,
        totalPages: data.totalPages,
      };

      // Find session info from loaded sessions list
      var sessionInfo = null;
      for (var i = 0; i < state.sessions.length; i++) {
        if (state.sessions[i].sessionId === sessionId) {
          sessionInfo = state.sessions[i];
          break;
        }
      }
      if (!sessionInfo) sessionInfo = {};

      // Set up chat header
      setupChatHeader(sessionInfo, data);

      // Render messages via ChatView module
      if (window.ChatView && window.ChatView.render) {
        window.ChatView.render(state.currentMessages, {
          page: data.page,
          totalPages: data.totalPages,
          totalMessages: data.totalMessages,
        });
      } else if (dom.messagesContainer) {
        // Fallback: basic rendering if ChatView module is not loaded
        dom.messagesContainer.innerHTML = '';
        renderMessagesFallback(state.currentMessages);
      }

      showView('chat');

      // Scroll to bottom of chat
      if (dom.chatMessages) {
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
      }
    } catch (err) {
      console.error('Failed to open session:', err);
      showToast('Failed to load conversation');
    }
  }

  /**
   * Fallback message renderer when ChatView module is not loaded.
   */
  function renderMessagesFallback(messages) {
    if (!dom.messagesContainer) return;
    dom.messagesContainer.innerHTML = '';
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var el = document.createElement('div');
      el.className = 'message ' + (msg.type === 'user' ? 'user-msg' : 'assistant-msg');

      var headerHtml = '<div class="message-header">' +
        '<span class="message-role ' + escapeHtml(msg.type) + '">' +
        (msg.type === 'user' ? 'User' : (msg.model || 'Claude')) +
        '</span>' +
        '<span class="message-time">' + (msg.timestamp ? formatTime(msg.timestamp) : '') + '</span>' +
        '</div>';

      var bodyHtml = '<div class="message-body">';
      if (msg.type === 'user') {
        bodyHtml += renderMarkdown(msg.text || '');
      } else if (msg.blocks && msg.blocks.length > 0) {
        for (var j = 0; j < msg.blocks.length; j++) {
          var block = msg.blocks[j];
          if (block.type === 'text' && block.text) {
            bodyHtml += renderMarkdown(block.text);
          } else if (block.type === 'tool_use') {
            bodyHtml += '<div class="tool-block"><strong>Tool: ' + escapeHtml(block.name || 'unknown') + '</strong></div>';
          }
        }
      }
      bodyHtml += '</div>';

      el.innerHTML = headerHtml + bodyHtml;
      dom.messagesContainer.appendChild(el);
    }
  }

  /**
   * Minimal markdown renderer (fallback when ChatView is not loaded).
   */
  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(text);
    }
    return '<p>' + escapeHtml(text) + '</p>';
  }

  function setupChatHeader(sessionInfo, data) {
    // Title
    var title = smartTitle({
      displayName: sessionInfo.displayName || data.customName || 'Untitled',
      customName: data.customName,
      firstPrompt: sessionInfo.firstPrompt || '',
    });

    if (dom.chatTitle) {
      dom.chatTitle.textContent = title;
    }

    // Meta info
    if (dom.chatMeta) {
      var parts = [];
      if (sessionInfo.modified) parts.push(formatDate(sessionInfo.modified));
      if (data.totalMessages) parts.push(data.totalMessages + ' messages');
      if (sessionInfo.gitBranch) parts.push(sessionInfo.gitBranch);
      dom.chatMeta.textContent = parts.join(' | ');
    }

    // Tags
    if (dom.chatTags) {
      var tags = data.tags || [];
      if (tags.length > 0) {
        var tagsHtml = '';
        for (var i = 0; i < tags.length; i++) {
          tagsHtml += '<span class="tag">' + escapeHtml(tags[i]) + '</span>';
        }
        dom.chatTags.innerHTML = tagsHtml;
      } else {
        dom.chatTags.innerHTML = '';
      }
    }

    // Favorite button state (#6)
    updateFavoriteButton(data.isFavorite);
  }

  function updateFavoriteButton(isFavorite) {
    if (!dom.favoriteBtn) return;
    if (isFavorite) {
      dom.favoriteBtn.innerHTML = '&#9733;';
      dom.favoriteBtn.classList.add('favorited');
    } else {
      dom.favoriteBtn.innerHTML = '&#9734;';
      dom.favoriteBtn.classList.remove('favorited');
    }
  }

  // =========================================================================
  // Navigation helpers
  // =========================================================================

  function goBackToSessions() {
    state.currentSessionId = null;
    state.currentMessages = [];
    state.currentSessionMeta = {};

    if (state.currentProjectId) {
      if (window.Router && window.Router.navigate) {
        window.Router.navigate('#/project/' + encodeURIComponent(state.currentProjectId));
      }
      showView('sessions');
    } else {
      if (window.Router && window.Router.navigate) {
        window.Router.navigate('#/');
      }
      showView('welcome');
    }
  }

  async function refreshCurrentSession() {
    if (state.currentProjectId && state.currentSessionId) {
      await openSession(state.currentSessionId);
    }
  }

  // =========================================================================
  // Event binding (#8)
  // =========================================================================

  function bindEvents() {
    // Back button
    if (dom.backBtn) {
      dom.backBtn.addEventListener('click', goBackToSessions);
    }

    // Rename button
    if (dom.renameBtn) {
      dom.renameBtn.addEventListener('click', function () {
        if (window.Features && window.Features.openRenameModal) {
          window.Features.openRenameModal();
        }
      });
    }

    // Tag button
    if (dom.tagBtn) {
      dom.tagBtn.addEventListener('click', function () {
        if (window.Features && window.Features.openTagModal) {
          window.Features.openTagModal();
        }
      });
    }

    // Export button
    if (dom.exportBtn) {
      dom.exportBtn.addEventListener('click', function () {
        if (window.Features && window.Features.openExportModal) {
          window.Features.openExportModal();
        }
      });
    }

    // Favorite button
    if (dom.favoriteBtn) {
      dom.favoriteBtn.addEventListener('click', function () {
        if (window.Features && window.Features.toggleFavorite) {
          window.Features.toggleFavorite();
        }
      });
    }

    // Global search button
    if (dom.globalSearchBtn) {
      dom.globalSearchBtn.addEventListener('click', function () {
        if (window.Search && window.Search.open) {
          window.Search.open();
        }
      });
    }

    // Stats button
    if (dom.statsBtn) {
      dom.statsBtn.addEventListener('click', function () {
        if (window.Stats && window.Stats.show) {
          window.Stats.show();
        } else {
          showView('stats');
        }
      });
    }

    // Stats back button (handled by Stats.init() if module loaded)
    if (dom.statsBackBtn && !(window.Stats && window.Stats.init)) {
      dom.statsBackBtn.addEventListener('click', function () {
        if (state.currentSessionId) {
          showView('chat');
        } else if (state.currentProjectId) {
          showView('sessions');
        } else {
          showView('welcome');
        }
      });
    }

    // Branch filter change (#3)
    if (dom.branchFilter) {
      dom.branchFilter.addEventListener('change', applyFilters);
    }

    // Session search input (#4)
    if (dom.sessionSearchInput) {
      dom.sessionSearchInput.addEventListener('input', applyFilters);
    }
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  async function init() {
    cacheDom();
    bindEvents();

    // Initialize sub-modules
    if (window.ChatView && window.ChatView.init) window.ChatView.init();
    if (window.Stats && window.Stats.init) window.Stats.init();
    if (window.Search && window.Search.init) window.Search.init();
    if (window.Features && window.Features.init) window.Features.init();

    // Load project list
    await loadProjects();

    // Initialize router (#9)
    if (window.Router && window.Router.init) {
      window.Router.init();
    } else {
      // No router module -- show welcome
      showView('welcome');
    }
  }

  // =========================================================================
  // Expose window.App
  // =========================================================================

  window.App = {
    _routerDriven: false,
    state: state,
    api: api,
    showView: showView,
    showToast: showToast,
    loadProjects: loadProjects,
    selectProject: selectProject,
    loadSessions: loadSessions,
    openSession: openSession,
    goBackToSessions: goBackToSessions,
    refreshCurrentSession: refreshCurrentSession,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatTime: formatTime,
    updateFavoriteButton: updateFavoriteButton,
  };

  // =========================================================================
  // Boot
  // =========================================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
