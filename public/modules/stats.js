/**
 * stats.js - Token usage statistics panel for CLI History Hub
 *
 * Provides summary cards, a daily token usage bar chart (canvas-based),
 * and breakdown tables by project and model (#5).
 */

window.Stats = (function () {
  // DOM references (resolved lazily on init)
  let statsView;
  let statsBackBtn;
  let statsProjectFilter;
  let statsCards;
  let tokenChart;
  let statsBreakdown;
  let statsDaysFilter;

  const MODEL_PRICING = [
    { regex: /opus/i, in: 15, out: 75, color: '#a371f7' },
    { regex: /sonnet/i, in: 3, out: 15, color: '#58a6ff' },
    { regex: /haiku/i, in: 0.25, out: 1.25, color: '#d29922' },
    { regex: /synthetic/i, in: 0, out: 0, color: '#8b949e' }
  ];
  const DEFAULT_PRICING = { in: 3, out: 15, color: '#7ee787' };

  let modelChartMode = 'cost'; // 'cost' or 'tokens'
  let cachedByModelData = [];
  let currentDays = 30;
  let cachedStatsData = null;

  /**
   * Initialize the stats module: cache DOM elements, bind listeners.
   */
  function init() {
    statsView = document.getElementById('statsView');
    statsBackBtn = document.getElementById('statsBackBtn');
    statsProjectFilter = document.getElementById('statsProjectFilter');
    statsCards = document.getElementById('statsCards');
    tokenChart = document.getElementById('tokenChart');
    statsBreakdown = document.getElementById('statsBreakdown');
    statsDaysFilter = document.getElementById('statsDaysFilter');

    // Back button -> navigate back to previous view
    if (statsBackBtn) {
      statsBackBtn.addEventListener('click', function () {
        var App = window.App;
        if (!App) return;
        // Determine which view to return to based on current state
        if (App.state.currentSessionId) {
          App.showView('chat');
          if (window.Router) window.Router.navigate('#/project/' + encodeURIComponent(App.state.currentProjectId) + '/session/' + encodeURIComponent(App.state.currentSessionId));
        } else if (App.state.currentProjectId) {
          App.showView('sessions');
          if (window.Router) window.Router.navigate('#/project/' + encodeURIComponent(App.state.currentProjectId));
        } else {
          App.showView('welcome');
          if (window.Router) window.Router.navigate('#/');
        }
      });
    }

    // Project filter change -> re-fetch stats
    if (statsProjectFilter) {
      statsProjectFilter.addEventListener('change', function () {
        var projectId = statsProjectFilter.value || null;
        show(projectId, currentDays);
      });
    }
    
    // Days filter change -> re-fetch stats
    if (statsDaysFilter) {
      statsDaysFilter.addEventListener('change', function () {
        currentDays = parseInt(statsDaysFilter.value, 10) || 30;
        var projectId = statsProjectFilter ? (statsProjectFilter.value || null) : null;
        show(projectId, currentDays);
      });
    }
  }

  /**
   * Show the stats view and load data.
   * @param {string|null} projectId - optional project ID to filter
   * @param {number} days - number of days for daily chart (default 30)
   */
  async function show(projectId, days) {
    currentDays = days || 30;
    
    // Navigate to stats view
    if (window.App && typeof window.App.showView === 'function') {
      window.App.showView('stats');
    }

    // Update URL
    if (window.Router && window.Router.navigate) {
      var statsHash = projectId ? '#/stats/' + encodeURIComponent(projectId) : '#/stats';
      window.Router.navigate(statsHash);
    }

    // Populate project filter dropdown
    populateProjectFilter(projectId);
    
    // Set days filter value
    if (statsDaysFilter) {
      statsDaysFilter.value = String(currentDays);
    }

    // Fetch stats from API
    try {
      var url = '/api/stats?days=' + currentDays;
      if (projectId) {
        url += '&project=' + encodeURIComponent(projectId);
      }

      var data;
      if (window.App && typeof window.App.api === 'function') {
        data = await window.App.api(url);
      } else {
        var res = await fetch(url);
        data = await res.json();
      }
      
      cachedStatsData = data;

      renderSummaryCards(data);
      renderDailyChart(data.daily || []);
      renderBreakdown(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
      if (statsCards) {
        statsCards.innerHTML = '<p style="color: var(--text-muted);">Failed to load statistics.</p>';
      }
    }
  }

  // -----------------------------------------------------------------------
  // Populate project filter
  // -----------------------------------------------------------------------

  function populateProjectFilter(selectedProjectId) {
    if (!statsProjectFilter) return;

    var projects = (window.App && window.App.state && window.App.state.projects) || [];
    var currentValue = selectedProjectId !== undefined ? selectedProjectId : statsProjectFilter.value;

    statsProjectFilter.innerHTML = '<option value="">All Projects</option>';

    projects.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.shortName || p.name || p.id;
      statsProjectFilter.appendChild(opt);
    });

    if (currentValue) {
      statsProjectFilter.value = currentValue;
    }
  }

  // -----------------------------------------------------------------------
  // Render summary cards
  // -----------------------------------------------------------------------

  function renderSummaryCards(data) {
    if (!statsCards) return;

    var totalTokens = data.totalTokens || {};
    var inputTokens = totalTokens.input || 0;
    var outputTokens = totalTokens.output || 0;
    var cacheCreation = totalTokens.cacheCreation || 0;
    var cacheRead = totalTokens.cacheRead || 0;
    var totalSessions = data.totalSessions || 0;
    var totalMessages = data.totalMessages || 0;

    statsCards.innerHTML =
      createCard('Total Input Tokens', formatNumber(inputTokens)) +
      createCard('Total Output Tokens', formatNumber(outputTokens)) +
      createCard('Cache Creation', formatNumber(cacheCreation)) +
      createCard('Cache Read', formatNumber(cacheRead)) +
      createCard('Total Sessions', formatNumber(totalSessions)) +
      createCard('Total Messages', formatNumber(totalMessages));
  }

  function createCard(label, value) {
    return (
      '<div class="stats-card">' +
        '<div class="stats-card-value">' + value + '</div>' +
        '<div class="stats-card-label">' + escapeHtml(label) + '</div>' +
      '</div>'
    );
  }

  // -----------------------------------------------------------------------
  // Render daily token usage chart on canvas
  // -----------------------------------------------------------------------

  // Cached bar positions for tooltip handling
  var dailyBarPositions = [];
  var dailyData = [];

  /**
   * Render daily token usage chart on canvas (stacked bars: input + output)
   */
  function renderDailyChart(daily) {
    if (!tokenChart) return;

    var canvas = tokenChart;
    var ctx = canvas.getContext('2d');

    // Handle high-DPI displays
    var dpr = window.devicePixelRatio || 1;
    var displayWidth = canvas.clientWidth || 800;
    var displayHeight = canvas.clientHeight || 300;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    var width = displayWidth;
    var height = displayHeight;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Padding
    var padLeft = 70;
    var padRight = 20;
    var padTop = 20;
    var padBottom = 50;

    var chartWidth = width - padLeft - padRight;
    var chartHeight = height - padTop - padBottom;

    // If no data, show message and clear bar positions
    if (!daily || daily.length === 0) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No token usage data available', width / 2, height / 2);
      dailyBarPositions = [];
      dailyData = [];
      return;
    }

    // Cache daily data for tooltip
    dailyData = daily;

    // Calculate max total (input + output) for each day
    var maxVal = 0;
    for (var i = 0; i < daily.length; i++) {
      var total = (daily[i].input || 0) + (daily[i].output || 0);
      if (total > maxVal) maxVal = total;
    }
    if (maxVal === 0) maxVal = 1; // avoid division by zero

    // Round up max for nice Y-axis
    var niceMax = niceRoundUp(maxVal);

    var barCount = daily.length;
    var barGap = Math.max(1, Math.floor(chartWidth / barCount * 0.2));
    var barWidth = Math.max(2, Math.floor((chartWidth - barGap * barCount) / barCount));

    // Cache bar positions for tooltip
    dailyBarPositions = [];
    for (var j = 0; j < barCount; j++) {
      var inputVal = daily[j].input || 0;
      var outputVal = daily[j].output || 0;
      var totalVal = inputVal + outputVal;
      
      var inputH = (inputVal / niceMax) * chartHeight;
      var outputH = (outputVal / niceMax) * chartHeight;
      var totalH = inputH + outputH;
      
      var x = padLeft + j * (barWidth + barGap) + barGap / 2;
      var yOutput = padTop + chartHeight - totalH;
      var yInput = yOutput + outputH;
      
      dailyBarPositions.push({
        x: x,
        yOutput: yOutput,
        yInput: yInput,
        width: barWidth,
        inputHeight: inputH,
        outputHeight: outputH,
        totalHeight: totalH,
        input: inputVal,
        output: outputVal,
        cacheCreation: daily[j].cacheCreation || 0,
        cacheRead: daily[j].cacheRead || 0,
        date: daily[j].date || ''
      });
    }

    // Draw grid lines (5 horizontal lines)
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    var gridLines = 5;
    for (var g = 0; g <= gridLines; g++) {
      var yVal = (niceMax / gridLines) * g;
      var y = padTop + chartHeight - (yVal / niceMax) * chartHeight;

      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      // Y-axis label
      ctx.fillText(formatShortNumber(yVal), padLeft - 8, y);
    }

    // Draw stacked bars: output (blue) at bottom, input (green) on top
    for (var k = 0; k < dailyBarPositions.length; k++) {
      var bar = dailyBarPositions[k];
      
      // Output bar (blue) - bottom
      if (bar.outputHeight > 0) {
        ctx.fillStyle = '#58a6ff';
        ctx.fillRect(bar.x, bar.yInput, bar.width, bar.outputHeight);
      }
      
      // Input bar (green) - top
      if (bar.inputHeight > 0) {
        ctx.fillStyle = '#7ee787';
        ctx.fillRect(bar.x, bar.yOutput, bar.width, bar.inputHeight);
      }
    }

    // Draw X-axis labels (show every Nth date to avoid crowding)
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    var labelInterval = Math.max(1, Math.ceil(barCount / 6));
    for (var m = 0; m < barCount; m++) {
      if (m % labelInterval === 0 || m === barCount - 1) {
        var barInfo = dailyBarPositions[m];
        var xLabel = barInfo.x + barInfo.width / 2;
        var dateStr = daily[m].date || '';
        // Show MM/DD format
        var shortDate = dateStr.substring(5); // "2026-03-15" -> "03-15"
        ctx.fillText(shortDate, xLabel, padTop + chartHeight + 8);
      }
    }

    // Draw axes
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + chartHeight);
    ctx.lineTo(width - padRight, padTop + chartHeight);
    ctx.stroke();
    
    // Draw legend
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    var legendX = padLeft;
    var legendY = 8;
    
    // Output legend
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(legendX, legendY - 5, 12, 12);
    ctx.fillStyle = '#8b949e';
    ctx.fillText('Output', legendX + 16, legendY + 1);
    
    // Input legend
    ctx.fillStyle = '#7ee787';
    ctx.fillRect(legendX + 70, legendY - 5, 12, 12);
    ctx.fillStyle = '#8b949e';
    ctx.fillText('Input', legendX + 86, legendY + 1);

    // Setup tooltip for daily chart
    setupDailyChartTooltip(canvas);
  }

  /**
   * Setup tooltip for daily chart - hover to show values
   */
  function setupDailyChartTooltip(canvas) {
    // Remove existing tooltip if any
    var existingTooltip = document.getElementById('chartTooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    // Create tooltip element
    var tooltip = document.createElement('div');
    tooltip.id = 'chartTooltip';
    tooltip.style.cssText = 'position:absolute;display:none;background:rgba(22,27,34,0.95);color:#e6edf3;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;z-index:1000;border:1px solid #30363d;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
    document.body.appendChild(tooltip);

    var currentHoverBar = null;

    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;

      // Find which bar is being hovered
      var hoveredBar = null;
      for (var i = 0; i < dailyBarPositions.length; i++) {
        var bar = dailyBarPositions[i];
        if (x >= bar.x && x <= bar.x + bar.width &&
            y >= bar.yOutput && y <= bar.yOutput + bar.totalHeight) {
          hoveredBar = bar;
          break;
        }
      }

      if (hoveredBar) {
        if (currentHoverBar !== hoveredBar) {
          currentHoverBar = hoveredBar;
          // Show tooltip
          var dateStr = hoveredBar.date;
          var formattedDate = dateStr;
          if (dateStr.length === 10) {
            // Format: 2026-03-15 -> Mar 15, 2026
            var d = new Date(dateStr);
            formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }
          var tooltipHtml = '<div style="font-weight:600;margin-bottom:4px;">' + formattedDate + '</div>';
          tooltipHtml += '<div style="color:#58a6ff;">Output: ' + formatNumber(hoveredBar.output) + ' tokens</div>';
          tooltipHtml += '<div style="color:#7ee787;">Input: ' + formatNumber(hoveredBar.input) + ' tokens</div>';
          if (hoveredBar.cacheCreation > 0) {
            tooltipHtml += '<div style="color:#d29922;">Cache Creation: ' + formatNumber(hoveredBar.cacheCreation) + ' tokens</div>';
          }
          if (hoveredBar.cacheRead > 0) {
            tooltipHtml += '<div style="color:#a371f7;">Cache Read: ' + formatNumber(hoveredBar.cacheRead) + ' tokens</div>';
          }
          tooltip.innerHTML = tooltipHtml;
          tooltip.style.display = 'block';
        }
        // Position tooltip near cursor
        var tooltipX = e.clientX + 15;
        var tooltipY = e.clientY - 10;
        // Keep tooltip in viewport
        var tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipX + tooltipRect.width > window.innerWidth) {
          tooltipX = e.clientX - tooltipRect.width - 15;
        }
        if (tooltipY + tooltipRect.height > window.innerHeight) {
          tooltipY = e.clientY - tooltipRect.height - 10;
        }
        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
        canvas.style.cursor = 'pointer';
      } else {
        if (currentHoverBar !== null) {
          currentHoverBar = null;
          tooltip.style.display = 'none';
        }
        canvas.style.cursor = 'default';
      }
    });

    canvas.addEventListener('mouseleave', function() {
      currentHoverBar = null;
      tooltip.style.display = 'none';
      canvas.style.cursor = 'default';
    });
  }

  /**
   * Round up to a "nice" number for the Y-axis scale.
   */
  function niceRoundUp(val) {
    if (val <= 0) return 1;
    var magnitude = Math.pow(10, Math.floor(Math.log10(val)));
    var normalized = val / magnitude;
    var nice;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 5) nice = 5;
    else nice = 10;
    return nice * magnitude;
  }

  // -----------------------------------------------------------------------
  // Render breakdown tables
  // -----------------------------------------------------------------------

  function renderBreakdown(data) {
    if (!statsBreakdown) return;

    var byProject = data.byProject || [];
    var byModel = data.byModel || [];

    var html = '';

    // Export button
    html += '<div class="stats-export-section">';
    html += '<button id="exportStatsBtn" class="export-btn">Export to CSV</button>';
    html += '</div>';

    // By Project table
    html += '<div class="breakdown-section">';
    html += '<h3>By Project</h3>';
    if (byProject.length === 0) {
      html += '<p class="no-data">No project data</p>';
    } else {
      html += '<table class="breakdown-table">';
      html += '<thead><tr><th>Project</th><th>Input Tokens</th><th>Output Tokens</th></tr></thead>';
      html += '<tbody>';
      byProject.forEach(function (p) {
        html +=
          '<tr class="clickable-row" data-project="' + escapeHtml(p.projectId || '') + '">' +
            '<td title="' + escapeHtml(p.projectName || '') + '">' +
              escapeHtml(shortenProjectName(p.projectName || p.projectId || '')) +
            '</td>' +
            '<td>' + formatNumber(p.input || 0) + '</td>' +
            '<td>' + formatNumber(p.output || 0) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Model Analytics
    cachedByModelData = byModel;
    html += '<div class="breakdown-section model-analytics">';
    html += '<div class="model-analytics-header">';
    html += '<h3>Model Analytics</h3>';
    if (byModel.length > 0) {
      html += '<div class="chart-toggle">';
      html += '<button id="btnCostMode" class="toggle-btn ' + (modelChartMode === 'cost' ? 'active' : '') + '">Cost ($)</button>';
      html += '<button id="btnTokensMode" class="toggle-btn ' + (modelChartMode === 'tokens' ? 'active' : '') + '">Tokens</button>';
      html += '</div>';
    }
    html += '</div>';

    if (byModel.length === 0) {
      html += '<p class="no-data">No model data</p>';
    } else {
      html += '<div class="chart-container-donut">';
      html += '<div class="donut-canvas-wrapper">';
      html += '<canvas id="modelPieChart"></canvas>';
      html += '</div>';
      html += '<div id="modelLegend" class="model-legend"></div>';
      html += '</div>';
    }
    html += '</div>';

    statsBreakdown.innerHTML = html;

    if (byModel.length > 0) {
      drawModelDoughnut();
      
      var btnCost = document.getElementById('btnCostMode');
      var btnTokens = document.getElementById('btnTokensMode');
      
      if (btnCost && btnTokens) {
        btnCost.addEventListener('click', function() {
          if (modelChartMode === 'cost') return;
          modelChartMode = 'cost';
          btnCost.classList.add('active');
          btnTokens.classList.remove('active');
          drawModelDoughnut();
        });
        btnTokens.addEventListener('click', function() {
          if (modelChartMode === 'tokens') return;
          modelChartMode = 'tokens';
          btnTokens.classList.add('active');
          btnCost.classList.remove('active');
          drawModelDoughnut();
        });
      }
    }

    // Bind click events to project rows
    var rows = statsBreakdown.querySelectorAll('.clickable-row');
    rows.forEach(function(row) {
      row.addEventListener('click', function() {
        var pId = row.getAttribute('data-project');
        if (pId) {
          if (window.App && typeof window.App.selectProject === 'function') {
            window.App.selectProject(pId);
          } else {
            window.location.hash = '#/project/' + encodeURIComponent(pId);
          }
        }
      });
    });
    
    // Bind export button
    var exportBtn = document.getElementById('exportStatsBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        exportStatsToCSV(data);
      });
    }
  }

  /**
   * Export statistics to CSV file
   */
  function exportStatsToCSV(data) {
    var csv = [];
    
    // Summary section
    csv.push('CLI History Hub - Statistics Export');
    csv.push('Generated: ' + new Date().toISOString());
    csv.push('');
    
    // Total tokens
    csv.push('Summary');
    csv.push('Metric,Value');
    var totalTokens = data.totalTokens || {};
    csv.push('Total Input Tokens,' + (totalTokens.input || 0));
    csv.push('Total Output Tokens,' + (totalTokens.output || 0));
    csv.push('Total Cache Creation,' + (totalTokens.cacheCreation || 0));
    csv.push('Total Cache Read,' + (totalTokens.cacheRead || 0));
    csv.push('Total Sessions,' + (data.totalSessions || 0));
    csv.push('Total Messages,' + (data.totalMessages || 0));
    csv.push('');
    
    // Daily data
    csv.push('Daily Token Usage');
    csv.push('Date,Input Tokens,Output Tokens,Cache Creation,Cache Read');
    var daily = data.daily || [];
    daily.forEach(function(d) {
      csv.push([
        d.date || '',
        d.input || 0,
        d.output || 0,
        d.cacheCreation || 0,
        d.cacheRead || 0
      ].join(','));
    });
    csv.push('');
    
    // By Project
    csv.push('By Project');
    csv.push('Project ID,Project Name,Input Tokens,Output Tokens,Cache Creation,Cache Read');
    var byProject = data.byProject || [];
    byProject.forEach(function(p) {
      csv.push([
        '"' + (p.projectId || '').replace(/"/g, '""') + '"',
        '"' + (p.projectName || '').replace(/"/g, '""') + '"',
        p.input || 0,
        p.output || 0,
        p.cacheCreation || 0,
        p.cacheRead || 0
      ].join(','));
    });
    csv.push('');
    
    // By Model
    csv.push('By Model');
    csv.push('Model,Messages,Input Tokens,Output Tokens');
    var byModel = data.byModel || [];
    byModel.forEach(function(m) {
      csv.push([
        '"' + (m.model || '').replace(/"/g, '""') + '"',
        m.count || 0,
        m.input || 0,
        m.output || 0
      ].join(','));
    });
    
    // Create and download file
    var csvContent = csv.join('\n');
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    var url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'cli-history-stats-' + new Date().toISOString().split('T')[0] + '.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Cached slices for hover redraws (avoid recalculating on every hover)
  var cachedSlices = [];
  var cachedTotal = 0;

  /**
   * Build slices data from cachedByModelData and current mode.
   */
  function buildSlices() {
    var slices = [];
    var totalVal = 0;
    cachedByModelData.forEach(function(m) {
      var modelName = m.model || 'unknown';
      var pricing = DEFAULT_PRICING;
      for (var i = 0; i < MODEL_PRICING.length; i++) {
        if (MODEL_PRICING[i].regex.test(modelName)) {
          pricing = MODEL_PRICING[i];
          break;
        }
      }

      var val = 0;
      var labelVal = '';
      if (modelChartMode === 'cost') {
        var costIn = ((m.input || 0) / 1000000) * pricing.in;
        var costOut = ((m.output || 0) / 1000000) * pricing.out;
        val = costIn + costOut;
        labelVal = '$' + val.toFixed(2);
      } else {
        val = (m.input || 0) + (m.output || 0);
        labelVal = formatShortNumber(val) + ' Tkns';
      }

      if (val > 0) {
        slices.push({ model: modelName, val: val, labelVal: labelVal, color: pricing.color });
        totalVal += val;
      }
    });
    slices.sort(function(a, b) { return b.val - a.val; });
    cachedSlices = slices;
    cachedTotal = totalVal;
  }

  /**
   * Draw the Doughnut Chart on Canvas (only canvas, no DOM rebuild).
   */
  function drawDoughnutCanvas(hoverIndex) {
    var canvas = document.getElementById('modelPieChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // Handle HiDPI displays
    var dpr = window.devicePixelRatio || 1;
    var displaySize = 180;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    ctx.scale(dpr, dpr);

    var cx = displaySize / 2;
    var cy = displaySize / 2;
    var radius = cx - 5;
    var innerRadius = radius * 0.6;

    ctx.clearRect(0, 0, displaySize, displaySize);

    if (cachedTotal === 0) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No Data', cx, cy);
      return;
    }

    var startAngle = -Math.PI / 2;
    cachedSlices.forEach(function(slice, idx) {
      var sliceAngle = (slice.val / cachedTotal) * 2 * Math.PI;
      var endAngle = startAngle + sliceAngle;
      var isFaded = hoverIndex !== undefined && hoverIndex !== idx;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true);
      ctx.closePath();

      ctx.fillStyle = slice.color;
      ctx.globalAlpha = isFaded ? 0.2 : 1.0;
      ctx.fill();

      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = 2;
      ctx.stroke();

      startAngle = endAngle;
    });

    ctx.globalAlpha = 1.0;
  }

  /**
   * Build legend DOM and bind hover events (called once per data change).
   */
  function buildLegend() {
    var legendContainer = document.getElementById('modelLegend');
    if (!legendContainer) return;

    var html = '';
    cachedSlices.forEach(function(slice, idx) {
      var pct = cachedTotal > 0 ? ((slice.val / cachedTotal) * 100).toFixed(1) + '%' : '0%';
      html += '<div class="legend-item" data-idx="' + idx + '">';
      html += '<div class="legend-color" style="background-color:' + slice.color + ';"></div>';
      html += '<div class="legend-info">';
      html += '<span class="legend-model">' + escapeHtml(slice.model) + '</span>';
      html += '<span class="legend-detail">' + slice.labelVal + ' (' + pct + ')</span>';
      html += '</div></div>';
    });
    legendContainer.innerHTML = html;

    // Bind hover: only update canvas + opacity, no DOM rebuild
    var items = legendContainer.querySelectorAll('.legend-item');
    items.forEach(function(item) {
      item.addEventListener('mouseenter', function() {
        var idx = parseInt(item.getAttribute('data-idx'), 10);
        drawDoughnutCanvas(idx);
        updateLegendHighlight(idx);
      });
      item.addEventListener('mouseleave', function() {
        drawDoughnutCanvas();
        updateLegendHighlight();
      });
    });
  }

  /**
   * Update legend item opacity without rebuilding DOM.
   */
  function updateLegendHighlight(hoverIndex) {
    var legendContainer = document.getElementById('modelLegend');
    if (!legendContainer) return;
    var items = legendContainer.querySelectorAll('.legend-item');
    items.forEach(function(item) {
      var idx = parseInt(item.getAttribute('data-idx'), 10);
      if (hoverIndex !== undefined && hoverIndex !== idx) {
        item.style.opacity = '0.4';
      } else {
        item.style.opacity = '1';
      }
    });
  }

  /**
   * Full redraw: rebuild slices, draw canvas, rebuild legend.
   */
  function drawModelDoughnut() {
    buildSlices();
    drawDoughnutCanvas();
    buildLegend();
  }

  /**
   * Shorten a long project path for display.
   */
  function shortenProjectName(name) {
    if (!name) return '';
    var parts = name.split('/').filter(Boolean);
    if (parts.length > 2) {
      return parts.slice(-2).join('/');
    }
    return name;
  }

  // -----------------------------------------------------------------------
  // Utility helpers
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

  /**
   * Format a number with commas: e.g., 1234567 -> "1,234,567"
   */
  function formatNumber(n) {
    if (typeof n !== 'number') return String(n);
    return n.toLocaleString('en-US');
  }

  /**
   * Format a number with K/M suffix for chart labels.
   * e.g., 1200 -> "1.2K", 1500000 -> "1.5M"
   */
  function formatShortNumber(n) {
    if (n >= 1000000) {
      var m = n / 1000000;
      return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
    }
    if (n >= 1000) {
      var k = n / 1000;
      return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'K';
    }
    return String(Math.round(n));
  }

  return {
    init: init,
    show: show,
  };
})();
