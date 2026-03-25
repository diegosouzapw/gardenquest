let refreshInterval = null;
let currentUser = null;
let isRefreshing = false;
let opsModalOpen = false;
let opsModalResolver = null;
let opsModalPreviouslyFocusedElement = null;
let opsToastTimeout = null;

const TABLE_COLUMNS = {
    siteLogsTableBody: 6,
    gameLogsTableBody: 6,
    activeSessionsTableBody: 6,
    agentHealthTableBody: 8,
    deadLetterTableBody: 8,
};

document.addEventListener('DOMContentLoaded', () => {
    setupOpsModal();
    document.getElementById('dashboardLoginBtn').addEventListener('click', loginDashboard);
    document.getElementById('dashboardLogoutBtn').addEventListener('click', logoutDashboard);
    initializeDashboard();
});

async function initializeDashboard() {
    const user = await checkAuth();
    currentUser = user;

    if (!user) {
        showLoginOverlay();
        return;
    }

    const result = await fetchDashboardData();

    if (result.ok) {
        showDashboard();
        startDashboard();
        return;
    }

    if (result.reason === 'forbidden') {
        showForbiddenOverlay(user.email || result.email || '');
        return;
    }

    showLoginOverlay();
}

function loginDashboard() {
    loginWithGoogle('/dashboard.html');
}

async function fetchDashboardData() {
    if (isRefreshing) {
        return { ok: true, reason: 'skipped' };
    }

    isRefreshing = true;
    try {
        const API_URL = typeof window.API_URL === 'string' ? window.API_URL : 'http://localhost:8080';
        const [dashboardRes, opsRes] = await Promise.all([
            fetch(`${API_URL}/api/v1/system/dashboard`, { credentials: 'include' }),
            fetch(`${API_URL}/api/v1/system/ops-dashboard`, { credentials: 'include' }),
        ]);

        if (dashboardRes.status === 401 || opsRes.status === 401) {
            stopDashboard();
            return { ok: false, reason: 'unauthenticated' };
        }

        if (dashboardRes.status === 403 || opsRes.status === 403) {
            const payload = await safeReadJson(dashboardRes.status === 403 ? dashboardRes : opsRes);
            stopDashboard();
            return {
                ok: false,
                reason: 'forbidden',
                email: payload?.email || currentUser?.email || '',
            };
        }

        if (!dashboardRes.ok || !opsRes.ok) throw new Error('Network error');

        const data = await dashboardRes.json();
        const ops = await opsRes.json();
        updateStats(data, ops);
        renderLogsTable('siteLogsTableBody', data.recentSiteLogs, 'Nenhum log do site encontrado.');
        renderLogsTable('gameLogsTableBody', data.recentGameLogs, 'Nenhum evento do jogo encontrado.');
        renderSessionTable(ops.recentSessions || []);
        renderAgentHealthTable(ops.agentHealth || []);
        renderDeadLetterTable(ops.deadLetters || []);
        return { ok: true };
    } catch (e) {
        console.error('Failed to load dashboard:', e);
        setTableMessage('siteLogsTableBody', 'Erro ao carregar logs do site. Verifique a conexao com o backend.', '#4ade80');
        setTableMessage('gameLogsTableBody', 'Erro ao carregar logs do jogo. Verifique a conexao com o backend.', '#4ade80');
        setTableMessage('activeSessionsTableBody', 'Erro ao carregar sessoes ativas.', '#4ade80');
        setTableMessage('agentHealthTableBody', 'Erro ao carregar saude dos agents.', '#4ade80');
        setTableMessage('deadLetterTableBody', 'Erro ao carregar dead letters.', '#4ade80');
        return { ok: false, reason: 'error' };
    } finally {
        isRefreshing = false;
    }
}

function startDashboard() {
    if (!refreshInterval) {
        refreshInterval = setInterval(async () => {
            const result = await fetchDashboardData();

            if (!result.ok) {
                if (result.reason === 'forbidden') {
                    showForbiddenOverlay(currentUser?.email || result.email || '');
                } else if (result.reason === 'unauthenticated') {
                    showLoginOverlay();
                }
            }
        }, 10000);
    }
}

function stopDashboard() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

function showDashboard() {
    hideAuthError();
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('dashboardContainer').style.display = 'block';
}

function showLoginOverlay() {
    stopDashboard();
    currentUser = null;
    document.getElementById('authTitle').textContent = 'Painel Restrito';
    document.getElementById('authCopy').textContent = 'Entre com a conta Google autorizada para acessar o dashboard administrativo.';
    document.getElementById('dashboardLoginBtn').hidden = false;
    document.getElementById('dashboardLogoutBtn').hidden = true;
    document.getElementById('dashboardContainer').style.display = 'none';
    document.getElementById('authOverlay').style.display = 'flex';
    hideAuthError();
    window.requestAnimationFrame(() => {
        const loginButton = document.getElementById('dashboardLoginBtn');
        if (loginButton && !loginButton.hidden) {
            loginButton.focus();
        }
    });
}

function showForbiddenOverlay(email) {
    stopDashboard();
    const labelEmail = email ? ` (${email})` : '';

    document.getElementById('authTitle').textContent = 'Acesso Negado';
    document.getElementById('authCopy').textContent = `A conta autenticada${labelEmail} nao esta na allowlist administrativa.`;
    document.getElementById('dashboardLoginBtn').hidden = true;
    document.getElementById('dashboardLogoutBtn').hidden = false;
    document.getElementById('dashboardContainer').style.display = 'none';
    document.getElementById('authOverlay').style.display = 'flex';
    showAuthError('Use a conta Google autorizada para entrar.');
    window.requestAnimationFrame(() => {
        const switchAccountButton = document.getElementById('dashboardLogoutBtn');
        if (switchAccountButton && !switchAccountButton.hidden) {
            switchAccountButton.focus();
        }
    });
}

async function logoutDashboard() {
    try {
        const API_URL = typeof window.API_URL === 'string' ? window.API_URL : 'http://localhost:8080';
        await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) {
        console.error('Dashboard logout error:', err);
    }

    window.location.replace('dashboard.html');
}

function showAuthError(message) {
    const errorNode = document.getElementById('authError');
    errorNode.textContent = message;
    errorNode.style.display = 'block';
}

function hideAuthError() {
    const errorNode = document.getElementById('authError');
    errorNode.textContent = '';
    errorNode.style.display = 'none';
}

async function safeReadJson(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

function setupOpsModal() {
    const modalBackdrop = document.getElementById('opsModalBackdrop');
    const cancelButton = document.getElementById('opsModalCancelBtn');
    const confirmButton = document.getElementById('opsModalConfirmBtn');

    if (!modalBackdrop || !cancelButton || !confirmButton) {
        return;
    }

    cancelButton.addEventListener('click', () => {
        resolveOpsModal(false);
    });

    confirmButton.addEventListener('click', () => {
        resolveOpsModal(true);
    });

    modalBackdrop.addEventListener('click', (event) => {
        if (event.target === modalBackdrop) {
            resolveOpsModal(false);
        }
    });

    document.addEventListener('keydown', handleOpsModalKeydown);
}

function handleOpsModalKeydown(event) {
    if (!opsModalOpen) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        resolveOpsModal(false);
        return;
    }

    if (event.key !== 'Tab') {
        return;
    }

    const dialog = document.getElementById('opsModalDialog');
    if (!dialog) {
        return;
    }

    const focusableNodes = Array.from(
        dialog.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    ).filter((node) => !node.hasAttribute('hidden'));

    if (focusableNodes.length < 1) {
        event.preventDefault();
        return;
    }

    const firstNode = focusableNodes[0];
    const lastNode = focusableNodes[focusableNodes.length - 1];

    if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode.focus();
        return;
    }

    if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode.focus();
    }
}

function resolveOpsModal(confirmed) {
    if (!opsModalOpen) {
        return;
    }

    const modalBackdrop = document.getElementById('opsModalBackdrop');
    if (modalBackdrop) {
        modalBackdrop.hidden = true;
    }

    document.body.classList.remove('ops-modal-open');
    opsModalOpen = false;

    const resolver = opsModalResolver;
    opsModalResolver = null;

    if (opsModalPreviouslyFocusedElement && typeof opsModalPreviouslyFocusedElement.focus === 'function') {
        opsModalPreviouslyFocusedElement.focus();
    }
    opsModalPreviouslyFocusedElement = null;

    if (typeof resolver === 'function') {
        resolver(Boolean(confirmed));
    }
}

function confirmAdminAction({
    title = 'Confirmar acao',
    description = 'Tem certeza que deseja continuar?',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    confirmTone = 'warn',
} = {}) {
    const modalBackdrop = document.getElementById('opsModalBackdrop');
    const modalTitle = document.getElementById('opsModalTitle');
    const modalDescription = document.getElementById('opsModalDescription');
    const cancelButton = document.getElementById('opsModalCancelBtn');
    const confirmButton = document.getElementById('opsModalConfirmBtn');

    if (!modalBackdrop || !modalTitle || !modalDescription || !cancelButton || !confirmButton) {
        console.error('Admin confirmation modal is unavailable.');
        return Promise.resolve(false);
    }

    modalTitle.textContent = title;
    modalDescription.textContent = description;
    cancelButton.textContent = cancelLabel;
    confirmButton.textContent = confirmLabel;
    confirmButton.dataset.tone = confirmTone;

    opsModalPreviouslyFocusedElement = document.activeElement;
    modalBackdrop.hidden = false;
    document.body.classList.add('ops-modal-open');
    opsModalOpen = true;

    window.requestAnimationFrame(() => {
        confirmButton.focus();
    });

    return new Promise((resolve) => {
        opsModalResolver = resolve;
    });
}

function showOpsToast(message, tone = 'info') {
    const region = document.getElementById('opsToastRegion');
    if (!region) {
        return;
    }

    const toast = document.createElement('div');
    toast.className = `ops-toast ${tone}`;
    toast.textContent = String(message || '');
    toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');

    region.replaceChildren(toast);
    window.requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    if (opsToastTimeout) {
        window.clearTimeout(opsToastTimeout);
    }

    opsToastTimeout = window.setTimeout(() => {
        toast.classList.remove('visible');
        window.setTimeout(() => {
            if (region.contains(toast)) {
                region.removeChild(toast);
            }
        }, 220);
    }, 3200);
}

function updateStats(data, ops) {
    document.getElementById('uniqueIPS').textContent = data.uniqueVisitors || 0;

    let totalViews = 0;
    let totalConnects = 0;
    let totalGameEvents = 0;

    if (Array.isArray(data.siteMetrics)) {
        data.siteMetrics.forEach(metric => {
            if (metric.event === 'page_view') totalViews += metric.count;
            if (metric.event === 'connect') totalConnects += metric.count;
        });
    }

    if (Array.isArray(data.gameMetrics)) {
        data.gameMetrics.forEach(metric => {
            totalGameEvents += metric.count;
        });
    }

    const quarantineCount = Array.isArray(ops?.agentHealth)
        ? ops.agentHealth.filter(item => item?.quarantinedUntil && new Date(item.quarantinedUntil).getTime() > Date.now()).length
        : 0;

    document.getElementById('totalViews').textContent = totalViews;
    document.getElementById('totalConnects').textContent = totalConnects;
    document.getElementById('totalGameEvents').textContent = totalGameEvents;
    document.getElementById('activeSessions').textContent = ops?.sessionOverview?.activeCount || 0;
    document.getElementById('quarantinedAgents').textContent = quarantineCount;
    document.getElementById('pendingQueue').textContent = ops?.queueOverview?.pendingCount || 0;
    document.getElementById('deadLetterCount').textContent = ops?.queueOverview?.deadLetterCount || 0;
}

function renderLogsTable(tbodyId, logs, emptyMessage) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    tbody.replaceChildren();

    if (!Array.isArray(logs) || logs.length === 0) {
        setTableMessage(tbodyId, emptyMessage);
        return;
    }

    logs.forEach(log => {
        const tr = document.createElement('tr');
        const userIdentity = formatUserIdentity(log);

        tr.appendChild(createCell(formatLogTimestamp(log.timestamp)));
        tr.appendChild(createCell(log.event || '-', { strong: true }));
        tr.appendChild(createCell(log.ip || '-'));
        tr.appendChild(createCell(userIdentity, { title: userIdentity === '-' ? '' : userIdentity }));
        tr.appendChild(createCell(log.details || '-', {
            title: log.details || '',
            styles: { fontSize: '0.82em', color: '#cbd5e1', maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
        }));
        tr.appendChild(createCell(log.userAgent || '-', {
            title: log.userAgent || '',
            styles: { fontSize: '0.8em', color: '#888', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
        }));

        tbody.appendChild(tr);
    });
}

function renderSessionTable(items) {
    const tbody = document.getElementById('activeSessionsTableBody');
    if (!tbody) return;
    tbody.replaceChildren();
    if (!Array.isArray(items) || items.length === 0) {
        setTableMessage('activeSessionsTableBody', 'Nenhuma sessao ativa encontrada.');
        return;
    }
    items.forEach(item => {
        const tr = document.createElement('tr');
        tr.appendChild(createCell(formatLogTimestamp(item.lastSeenAt)));
        tr.appendChild(createCell(item.userName || '-', { strong: true }));
        tr.appendChild(createCell(item.userEmail || '-'));
        tr.appendChild(createCell(item.ip || '-'));
        tr.appendChild(createCell(item.userAgent || '-', { title: item.userAgent || '', styles: { maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));
        tr.appendChild(createActionsCell([
            makeActionButton(
                'Revogar',
                'warn',
                () => postAdminAction(`/api/v1/system/sessions/${encodeURIComponent(item.id)}/revoke`, {}),
                false,
                {
                    confirm: {
                        title: 'Revogar sessao ativa',
                        description: `Deseja revogar a sessao ${item.id}? O usuario precisara entrar novamente.`,
                        confirmLabel: 'Revogar sessao',
                        cancelLabel: 'Cancelar',
                        confirmTone: 'danger',
                    },
                    successMessage: 'Sessao revogada com sucesso.',
                }
            ),
        ]));
        tbody.appendChild(tr);
    });
}

function renderAgentHealthTable(items) {
    const tbody = document.getElementById('agentHealthTableBody');
    if (!tbody) return;
    tbody.replaceChildren();
    if (!Array.isArray(items) || items.length === 0) {
        setTableMessage('agentHealthTableBody', 'Nenhum agent encontrado.');
        return;
    }
    items.forEach(item => {
        const tr = document.createElement('tr');
        tr.appendChild(createCell(item.name || item.id || '-', { strong: true }));
        tr.appendChild(createCell(item.mode || '-'));
        tr.appendChild(createCell(item.status || '-'));
        tr.appendChild(createCell(String(item.failureCount || 0)));
        tr.appendChild(createCell(String(item.suspiciousCount || 0)));
        tr.appendChild(createCell(formatLogTimestamp(item.quarantinedUntil)));
        tr.appendChild(createCell(item.lastReason || item.lastErrorCode || '-', { title: item.lastReason || item.lastErrorCode || '' }));
        tr.appendChild(createActionsCell([
            makeActionButton(
                'Pause',
                'warn',
                () => postAdminAction(`/api/v1/system/agents/${encodeURIComponent(item.id)}/pause`, {}),
                item.status === 'paused',
                {
                    confirm: {
                        title: 'Pausar agent',
                        description: `Deseja pausar o agent ${item.name || item.id}?`,
                        confirmLabel: 'Pausar',
                        cancelLabel: 'Cancelar',
                        confirmTone: 'danger',
                    },
                    successMessage: 'Agent pausado.',
                }
            ),
            makeActionButton(
                'Resume',
                'ok',
                () => postAdminAction(`/api/v1/system/agents/${encodeURIComponent(item.id)}/resume`, {}),
                item.status === 'active',
                {
                    confirm: {
                        title: 'Retomar agent',
                        description: `Deseja retomar o agent ${item.name || item.id}?`,
                        confirmLabel: 'Retomar',
                        cancelLabel: 'Cancelar',
                        confirmTone: 'ok',
                    },
                    successMessage: 'Agent retomado.',
                }
            ),
            makeActionButton(
                'Limpar quarentena',
                'neutral',
                () => postAdminAction(`/api/v1/system/agents/${encodeURIComponent(item.id)}/clear-quarantine`, {}),
                false,
                {
                    confirm: {
                        title: 'Limpar quarentena',
                        description: `Deseja remover o estado de quarentena do agent ${item.name || item.id}?`,
                        confirmLabel: 'Limpar',
                        cancelLabel: 'Cancelar',
                        confirmTone: 'warn',
                    },
                    successMessage: 'Quarentena removida.',
                }
            ),
        ]));
        tbody.appendChild(tr);
    });
}

function renderDeadLetterTable(items) {
    const tbody = document.getElementById('deadLetterTableBody');
    if (!tbody) return;
    tbody.replaceChildren();
    if (!Array.isArray(items) || items.length === 0) {
        setTableMessage('deadLetterTableBody', 'Nenhum item em dead letter.');
        return;
    }

    items.forEach(item => {
        const tr = document.createElement('tr');
        tr.appendChild(createCell(String(item.id || '-'), { strong: true }));
        tr.appendChild(createCell(item.commandType || '-'));
        tr.appendChild(createCell(`${item.actorType || '-'} · ${item.actorId || '-'}`));
        tr.appendChild(createCell(`${item.attempts || 0}/${item.maxAttempts || 0}`));
        tr.appendChild(createCell(item.lastErrorCode || '-', { title: item.lastErrorCode || '' }));
        tr.appendChild(createCell(formatLogTimestamp(item.completedAt || item.createdAt)));
        tr.appendChild(createCell(summarizePayload(item.resultJson || item.payloadJson || {}), {
            title: JSON.stringify(item.resultJson || item.payloadJson || {}).slice(0, 500),
            styles: { maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
        }));
        tr.appendChild(createActionsCell([
            makeActionButton(
                'Retry',
                'ok',
                () => postAdminAction(`/api/v1/system/queue/${encodeURIComponent(item.id)}/retry`, { resetAttempts: true }),
                false,
                {
                    confirm: {
                        title: 'Retentar comando em dead letter',
                        description: `Deseja reenfileirar o comando ${item.id}?`,
                        confirmLabel: 'Retentar',
                        cancelLabel: 'Cancelar',
                        confirmTone: 'warn',
                    },
                    successMessage: 'Comando reenfileirado.',
                }
            ),
        ]));
        tbody.appendChild(tr);
    });
}

function summarizePayload(payload) {
    if (!payload || typeof payload !== 'object') return '-';
    const text = JSON.stringify(payload);
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function formatLogTimestamp(value) {
    if (!value) return '-';
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '-' : value.toLocaleString('pt-BR');
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

function formatUserIdentity(log) {
    const name = log?.userName || log?.user_name || null;
    const id = log?.userId || log?.user_id || null;
    if (name && id) return `${name} · ${id}`;
    return name || id || '-';
}

function createCell(text, options = {}) {
    const td = document.createElement('td');
    const value = text == null || text === '' ? '-' : String(text);
    if (options.strong) {
        const strong = document.createElement('strong');
        strong.textContent = value;
        td.appendChild(strong);
    } else {
        td.textContent = value;
    }
    if (options.title) td.title = options.title;
    if (options.styles) Object.assign(td.style, options.styles);
    return td;
}

function createActionsCell(buttons) {
    const td = document.createElement('td');
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexWrap = 'wrap';
    wrapper.style.gap = '8px';
    buttons.forEach(button => wrapper.appendChild(button));
    td.appendChild(wrapper);
    return td;
}

function makeActionButton(label, variant, handler, disabled = false, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = Boolean(disabled);
    button.className = `ops-btn ${variant}`;
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        const previousLabel = button.textContent;
        button.textContent = '...';
        try {
            if (options.confirm) {
                const confirmed = await confirmAdminAction(options.confirm);
                if (!confirmed) {
                    return;
                }
            }

            await handler();

            if (options.successMessage) {
                showOpsToast(options.successMessage, 'success');
            }
        } catch (error) {
            console.error('Dashboard action error:', error);
            showOpsToast(error?.message || 'Falha ao executar a acao administrativa.', 'error');
        } finally {
            button.textContent = previousLabel;
            button.disabled = Boolean(disabled);
        }
    });
    return button;
}

async function postAdminAction(path, body) {
    const API_URL = typeof window.API_URL === 'string' ? window.API_URL : 'http://localhost:8080';
    const response = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body || {}),
    });

    if (!response.ok) {
        const payload = await safeReadJson(response);
        throw new Error(payload?.error || `Erro ${response.status}`);
    }

    await fetchDashboardData();
}

function setTableMessage(tbodyId, message, color = '#cbd5e1') {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = TABLE_COLUMNS[tbodyId] || 6;
    td.style.textAlign = 'center';
    td.style.color = color;
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
}
