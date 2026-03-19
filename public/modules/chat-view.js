/**
 * chat-view.js - Conversation message rendering for Claude Code History Viewer
 *
 * Renders user and assistant message turns in the chat detail view.
 * Handles merged assistant turns (#9) and lazy loading / pagination (#8).
 */

window.ChatView = (function () {
  // Internal state
  let _messages = [];       // All messages loaded so far (oldest first)
  let _currentPage = 1;
  let _totalPages = 1;
  let _totalMessages = 0;

  // DOM references (resolved lazily on init)
  let messagesContainer;
  let loadMoreTop;
  let loadMoreBtn;

  /**
   * Initialize the chat-view module: cache DOM elements, bind listeners.
   */
  function init() {
    messagesContainer = document.getElementById('messagesContainer');
    loadMoreTop = document.getElementById('loadMoreTop');
    loadMoreBtn = document.getElementById('loadMoreBtn');

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', loadMore);
    }
  }

  /**
   * Render messages into the chat view.
   * @param {Array} messages - array of user/assistant message objects
   * @param {object} opts - { page, totalPages, totalMessages }
   */
  function render(messages, opts) {
    opts = opts || {};
    _messages = messages || [];
    _currentPage = opts.page || 1;
    _totalPages = opts.totalPages || 1;
    _totalMessages = opts.totalMessages || _messages.length;

    // Clear container
    messagesContainer.innerHTML = '';

    // Render each message turn
    _messages.forEach(function (msg) {
      if (msg.type === 'user') {
        if (!msg.text || !msg.text.trim()) return;
        messagesContainer.appendChild(createUserTurn(msg));
      } else if (msg.type === 'assistant') {
        messagesContainer.appendChild(createAssistantTurn(msg));
      }
    });

    // Show or hide load-more button
    updateLoadMoreButton();

    // Bind toggle events for thinking/tool blocks
    bindToggleEvents(messagesContainer);

    // Scroll to top of messages container after initial render
    var chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.scrollTop = 0;
    }
  }

  /**
   * Load earlier messages (next page) and prepend them.
   */
  async function loadMore() {
    if (_currentPage >= _totalPages) return;

    var App = window.App;
    if (!App || !App.state) return;

    var nextPage = _currentPage + 1;
    var pid = App.state.currentProjectId;
    var sid = App.state.currentSessionId;

    if (!pid || !sid) return;

    try {
      var data = await App.api(
        '/api/projects/' + encodeURIComponent(pid) +
        '/sessions/' + encodeURIComponent(sid) +
        '?page=' + nextPage + '&pageSize=30'
      );

      if (!data || !data.messages || data.messages.length === 0) return;

      // Remember scroll position so we can preserve it after prepending
      var chatMessages = document.getElementById('chatMessages');
      var prevScrollHeight = chatMessages.scrollHeight;

      // Build a document fragment with the older messages
      var fragment = document.createDocumentFragment();
      data.messages.forEach(function (msg) {
        if (msg.type === 'user') {
          if (!msg.text || !msg.text.trim()) return;
          fragment.appendChild(createUserTurn(msg));
        } else if (msg.type === 'assistant') {
          fragment.appendChild(createAssistantTurn(msg));
        }
      });

      // Bind toggle events on the new fragment elements before inserting
      bindToggleEvents(fragment);

      // Prepend older messages to the top
      messagesContainer.insertBefore(fragment, messagesContainer.firstChild);

      // Restore scroll position (keep the user looking at the same content)
      chatMessages.scrollTop = chatMessages.scrollHeight - prevScrollHeight;

      // Update state
      _currentPage = nextPage;
      _messages = data.messages.concat(_messages);
      _totalPages = data.totalPages || _totalPages;

      updateLoadMoreButton();
    } catch (err) {
      console.error('Failed to load more messages:', err);
    }
  }

  /**
   * Return the current messages in a clean format for export.
   * @returns {Array}
   */
  function getMessagesForExport() {
    return _messages.map(function (msg) {
      if (msg.type === 'user') {
        return {
          type: 'user',
          text: msg.text || '',
          timestamp: msg.timestamp || null,
        };
      }
      return {
        type: 'assistant',
        model: msg.model || 'Claude',
        timestamp: msg.timestamp || null,
        usage: msg.usage || null,
        blocks: (msg.blocks || []).map(function (b) {
          if (b.type === 'text') return { type: 'text', text: b.text || '' };
          if (b.type === 'thinking') return { type: 'thinking', text: b.thinking || b.text || '' };
          if (b.type === 'tool_use') return { type: 'tool_use', name: b.name || '', input: b.input || {} };
          return b;
        }),
      };
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Show or hide the load-more button based on pagination state.
   */
  function updateLoadMoreButton() {
    if (!loadMoreTop) return;
    if (_currentPage < _totalPages) {
      loadMoreTop.classList.remove('hidden');
    } else {
      loadMoreTop.classList.add('hidden');
    }
  }

  /**
   * Create a user turn element.
   */
  function createUserTurn(msg) {
    var div = document.createElement('div');
    div.className = 'message-turn';

    var timeStr = msg.timestamp ? formatTime(msg.timestamp) : '';

    div.innerHTML =
      '<div class="turn-header">' +
        '<span class="message-role user">User</span>' +
        '<span class="message-time">' + escapeHtml(timeStr) + '</span>' +
      '</div>' +
      '<div class="turn-body user-body">' + renderMarkdown(msg.text || '') + '</div>';

    return div;
  }

  /**
   * Create an assistant turn element.
   */
  function createAssistantTurn(msg) {
    var div = document.createElement('div');
    div.className = 'message-turn';

    var modelName = msg.model || 'Claude';
    var timeStr = msg.timestamp ? formatTime(msg.timestamp) : '';
    var totalOutputTokens = (msg.usage && msg.usage.output_tokens) ? msg.usage.output_tokens : 0;
    var tokenStr = totalOutputTokens ? formatNumber(totalOutputTokens) + ' tokens' : '';

    var headerHtml =
      '<div class="turn-header">' +
        '<span class="message-role assistant">' + escapeHtml(modelName) + '</span>' +
        '<span class="message-time">' + escapeHtml(timeStr) + '</span>' +
        (tokenStr ? '<span class="token-info">' + tokenStr + '</span>' : '') +
      '</div>';

    var bodyHtml = '<div class="turn-body assistant-body">';
    if (msg.blocks && msg.blocks.length > 0) {
      msg.blocks.forEach(function (block) {
        if (block.type === 'text' && block.text) {
          bodyHtml += renderMarkdown(block.text);
        } else if (block.type === 'thinking') {
          var thinkingText = block.thinking || block.text || '';
          if (thinkingText) {
            bodyHtml += createThinkingBlock(thinkingText);
          }
        } else if (block.type === 'tool_use') {
          bodyHtml += createToolBlock(block);
        }
      });
    }
    bodyHtml += '</div>';

    div.innerHTML = headerHtml + bodyHtml;
    return div;
  }

  /**
   * Create HTML for a collapsible thinking block.
   */
  function createThinkingBlock(text) {
    var preview = text.substring(0, 100).replace(/\n/g, ' ');
    return (
      '<div class="thinking-block">' +
        '<div class="thinking-toggle">' +
          '<span class="arrow">&#9654;</span>' +
          '<span>Thinking: ' + escapeHtml(preview) + (text.length > 100 ? '...' : '') + '</span>' +
        '</div>' +
        '<div class="thinking-content">' + escapeHtml(text) + '</div>' +
      '</div>'
    );
  }

  /**
   * Create HTML for a collapsible tool use block.
   */
  function createToolBlock(block) {
    var inputStr = block.input ? JSON.stringify(block.input, null, 2) : '';
    return (
      '<div class="tool-block">' +
        '<div class="tool-toggle">' +
          '<span class="arrow">&#9654;</span>' +
          '<span>Tool: ' + escapeHtml(block.name || 'unknown') + '</span>' +
        '</div>' +
        '<div class="tool-content"><pre>' + escapeHtml(inputStr) + '</pre></div>' +
      '</div>'
    );
  }

  /**
   * Bind click-to-toggle events for all thinking/tool blocks within a container.
   * @param {HTMLElement|DocumentFragment} container
   */
  function bindToggleEvents(container) {
    // Use querySelectorAll on the container (works for both elements and fragments
    // once they are in the DOM; for fragments we bind before insertion by iterating children)
    var thinkingToggles = container.querySelectorAll('.thinking-toggle');
    var toolToggles = container.querySelectorAll('.tool-toggle');

    thinkingToggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var content = toggle.nextElementSibling;
        var arrow = toggle.querySelector('.arrow');
        if (content) content.classList.toggle('show');
        if (arrow) arrow.classList.toggle('open');
      });
    });

    toolToggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var content = toggle.nextElementSibling;
        var arrow = toggle.querySelector('.arrow');
        if (content) content.classList.toggle('show');
        if (arrow) arrow.classList.toggle('open');
      });
    });
  }

  // -----------------------------------------------------------------------
  // Utility wrappers (delegate to App helpers when available)
  // -----------------------------------------------------------------------

  function escapeHtml(str) {
    if (window.App && typeof window.App.escapeHtml === 'function') {
      return window.App.escapeHtml(str);
    }
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    if (window.App && typeof window.App.formatTime === 'function') {
      return window.App.formatTime(ts);
    }
    try {
      var d = new Date(ts);
      return d.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return ts;
    }
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(text);
    }
    return '<p>' + escapeHtml(text) + '</p>';
  }

  function formatNumber(n) {
    if (typeof n !== 'number') return String(n);
    return n.toLocaleString('en-US');
  }

  return {
    init: init,
    render: render,
    loadMore: loadMore,
    getMessagesForExport: getMessagesForExport,
  };
})();
