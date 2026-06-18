document.addEventListener('DOMContentLoaded', () => {
    const state = {
        results: [],
        expanded: new Set(),
        filter: 'all',
        query: '',
        sort: 'original',
        lastRun: null,
        backendOnline: false
    };

    const els = {
        form: document.getElementById('creds-form'),
        runBtn: document.getElementById('run-btn'),
        clearBtn: document.getElementById('clear-btn'),
        runBtnLabel: document.querySelector('#run-btn .btn-label'),
        runSpinner: document.querySelector('#run-btn .spinner'),
        statusDot: document.getElementById('server-status-dot'),
        statusText: document.getElementById('server-status-text'),
        notice: document.getElementById('global-notice'),
        progressPanel: document.getElementById('progress-panel'),
        progressLabel: document.getElementById('progress-label'),
        runMeta: document.getElementById('run-meta'),
        emptyState: document.getElementById('empty-state'),
        resultsList: document.getElementById('results-list'),
        search: document.getElementById('result-search'),
        sort: document.getElementById('sort-select'),
        exportBtn: document.getElementById('export-btn'),
        statTotal: document.getElementById('stat-total'),
        statAllowed: document.getElementById('stat-allowed'),
        statDenied: document.getElementById('stat-denied'),
        statError: document.getElementById('stat-error'),
        modal: document.getElementById('quick-run-modal'),
        modalClose: document.getElementById('modal-close'),
        modalCancel: document.getElementById('modal-cancel'),
        modalTitle: document.getElementById('modal-title'),
        modalService: document.getElementById('modal-service'),
        executeForm: document.getElementById('execute-form'),
        executeAction: document.getElementById('execute-action'),
        executeParams: document.getElementById('execute-params'),
        executeJsonError: document.getElementById('execute-json-error'),
        executeSubmit: document.getElementById('execute-submit'),
        executeSubmitLabel: document.querySelector('#execute-submit .btn-label'),
        executeSpinner: document.querySelector('#execute-submit .spinner'),
        executeResult: document.getElementById('execute-result'),
        executeBadge: document.getElementById('execute-status-badge'),
        executeData: document.getElementById('execute-result-data')
    };

    init();

    function init() {
        checkBackend();
        bindEvents();
        updateSummary([]);
        renderResults();
    }

    function bindEvents() {
        els.form.addEventListener('submit', runAssessment);
        els.clearBtn.addEventListener('click', clearResults);
        els.search.addEventListener('input', () => {
            state.query = els.search.value.trim().toLowerCase();
            renderResults();
        });
        els.sort.addEventListener('change', () => {
            state.sort = els.sort.value;
            renderResults();
        });
        document.querySelectorAll('.filter-chip').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
                button.classList.add('active');
                state.filter = button.dataset.filter;
                renderResults();
            });
        });
        els.exportBtn.addEventListener('click', exportResults);
        els.resultsList.addEventListener('click', handleResultClick);
        els.modalClose.addEventListener('click', closeModal);
        els.modalCancel.addEventListener('click', closeModal);
        els.modal.addEventListener('click', (event) => {
            if (event.target === els.modal) closeModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
        });
        els.executeParams.addEventListener('input', validateExecuteJson);
        els.executeForm.addEventListener('submit', executeFollowUp);
    }

    async function checkBackend() {
        setConnectionState('pending', 'Checking backend');
        try {
            const response = await fetch('/api/health', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            state.backendOnline = true;
            setConnectionState('online', 'Backend ready');
        } catch (error) {
            state.backendOnline = false;
            setConnectionState('offline', 'Backend unavailable');
            showNotice('error', 'Backend unavailable. Start the Python server and refresh this page.');
        }
    }

    async function runAssessment(event) {
        event.preventDefault();
        hideNotice();

        const payload = getCredentials();
        const missing = [];
        if (!payload.access_key.trim()) missing.push('Access Key ID');
        if (!payload.secret_key.trim()) missing.push('Secret Access Key');

        if (missing.length) {
            showNotice('error', `Missing required value: ${missing.join(', ')}.`);
            return;
        }

        setRunLoading(true);
        state.expanded.clear();
        state.lastRun = {
            region: payload.region,
            startedAt: new Date()
        };
        renderLoading();

        try {
            const response = await fetch('/api/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            state.backendOnline = true;

            let body;
            try {
                body = await response.json();
            } catch {
                body = null;
            }

            if (!response.ok) {
                const detail = body && body.detail ? formatServerDetail(body.detail) : response.statusText;
                throw new Error(`Assessment failed (${response.status}): ${detail}`);
            }

            state.results = Array.isArray(body) ? body.map(normalizeResult) : [];
            state.lastRun.finishedAt = new Date();
            updateSummary(state.results);
            updateRunMeta();
            renderResults();

            const counts = countByStatus(state.results);
            if (counts.error > 0) {
                showNotice('warning', `${counts.error} check${counts.error === 1 ? '' : 's'} returned an error. Filter by Errors for the raw response.`);
            } else {
                hideNotice();
            }
        } catch (error) {
            if (error instanceof TypeError) state.backendOnline = false;
            state.results = [];
            updateSummary([]);
            renderResults();
            updateRunMeta('Run failed');
            showNotice('error', error.message || 'Assessment failed unexpectedly.');
        } finally {
            setRunLoading(false);
        }
    }

    function getCredentials() {
        return Object.fromEntries(new FormData(els.form).entries());
    }

    function normalizeResult(result, index) {
        const status = String(result.status || 'Error');
        return {
            id: `${result.service || 'unknown'}:${result.action || index}:${index}`,
            service: String(result.service || 'unknown'),
            action: String(result.action || 'unknown'),
            status,
            statusKey: status.toLowerCase(),
            message: String(result.message || ''),
            explanation: String(result.explanation || ''),
            data: result.data ?? null,
            next_steps: Array.isArray(result.next_steps) ? result.next_steps : [],
            originalIndex: index
        };
    }

    function renderLoading() {
        els.emptyState.classList.add('hidden');
        els.resultsList.classList.remove('hidden');
        els.exportBtn.disabled = true;
        els.resultsList.innerHTML = '';
        for (let index = 0; index < 5; index += 1) {
            const row = createEl('div', 'skeleton-row');
            row.append(
                createEl('div', 'skeleton-line wide'),
                createEl('div', 'skeleton-line'),
                createEl('div', 'skeleton-line short')
            );
            els.resultsList.appendChild(row);
        }
    }

    function renderResults() {
        const visible = getVisibleResults();
        els.resultsList.innerHTML = '';
        els.exportBtn.disabled = state.results.length === 0;

        if (state.results.length === 0) {
            els.emptyState.classList.remove('hidden');
            els.resultsList.classList.add('hidden');
            return;
        }

        els.emptyState.classList.add('hidden');
        els.resultsList.classList.remove('hidden');

        if (visible.length === 0) {
            const noMatches = createEl('div', 'no-matches');
            noMatches.append(
                createEl('h3', '', 'No matching checks'),
                createEl('p', '', 'Adjust the search or status filter.')
            );
            els.resultsList.appendChild(noMatches);
            return;
        }

        visible.forEach((result) => {
            els.resultsList.appendChild(renderResultCard(result));
        });
    }

    function renderResultCard(result) {
        const card = createEl('article', `result-card ${result.statusKey}`);
        card.dataset.id = result.id;

        const top = createEl('div', 'result-main');
        const left = createEl('div', 'result-title');
        left.append(
            createEl('span', 'service-pill', result.service),
            createEl('div', 'action-stack', [
                createEl('strong', '', result.action),
                createEl('span', '', statusSummary(result))
            ])
        );

        const right = createEl('div', 'result-actions');
        right.append(
            createBadge(result.statusKey, result.status),
            createIconButton(state.expanded.has(result.id) ? 'Collapse details' : 'Expand details', 'toggle-details', result.id, state.expanded.has(result.id))
        );
        top.append(left, right);
        card.appendChild(top);

        if (state.expanded.has(result.id)) {
            card.appendChild(renderDetails(result));
        }

        return card;
    }

    function renderDetails(result) {
        const details = createEl('div', 'result-details');

        const explainer = createEl('div', 'detail-section');
        explainer.append(
            createEl('h4', '', 'Check context'),
            createEl('p', '', result.explanation || 'No additional context was provided for this check.')
        );
        details.appendChild(explainer);

        const responseSection = createEl('div', 'detail-section');
        responseSection.append(createEl('h4', '', result.statusKey === 'allowed' ? 'AWS response' : 'AWS message'));
        const pre = createEl('pre', `code-block ${result.statusKey}`);
        pre.textContent = result.statusKey === 'allowed' && result.data !== null
            ? JSON.stringify(result.data, null, 2)
            : result.message || 'No response body was returned.';
        responseSection.appendChild(pre);

        if (result.statusKey === 'allowed' && result.data !== null) {
            const copy = createEl('button', 'mini-action', 'Copy JSON');
            copy.type = 'button';
            copy.dataset.action = 'copy-json';
            copy.dataset.id = result.id;
            responseSection.appendChild(copy);
        }

        details.appendChild(responseSection);

        if (result.next_steps.length > 0) {
            const next = createEl('div', 'detail-section follow-ups');
            next.appendChild(createEl('h4', '', 'Follow-up checks'));
            const list = createEl('div', 'step-list');
            result.next_steps.forEach((step) => {
                const button = createEl('button', 'step-action', step);
                button.type = 'button';
                button.dataset.action = 'follow-up';
                button.dataset.step = step;
                button.dataset.service = result.service;
                list.appendChild(button);
            });
            next.appendChild(list);
            details.appendChild(next);
        }

        return details;
    }

    function handleResultClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        if (button.dataset.action === 'toggle-details') {
            const id = button.dataset.id;
            if (state.expanded.has(id)) state.expanded.delete(id);
            else state.expanded.add(id);
            renderResults();
        }

        if (button.dataset.action === 'copy-json') {
            const result = state.results.find((item) => item.id === button.dataset.id);
            if (!result) return;
            copyText(JSON.stringify(result.data, null, 2));
            button.textContent = 'Copied';
            window.setTimeout(() => {
                button.textContent = 'Copy JSON';
            }, 1200);
        }

        if (button.dataset.action === 'follow-up') {
            openModal(button.dataset.step, button.dataset.service);
        }
    }

    function getVisibleResults() {
        const filtered = state.results.filter((result) => {
            const statusMatch = state.filter === 'all' || result.statusKey === state.filter;
            const haystack = `${result.service} ${result.action} ${result.status} ${result.message} ${result.explanation}`.toLowerCase();
            const searchMatch = !state.query || haystack.includes(state.query);
            return statusMatch && searchMatch;
        });

        return filtered.sort((a, b) => {
            if (state.sort === 'service') {
                return `${a.service}:${a.action}`.localeCompare(`${b.service}:${b.action}`);
            }
            if (state.sort === 'status') {
                const order = { allowed: 0, error: 1, denied: 2 };
                return (order[a.statusKey] ?? 9) - (order[b.statusKey] ?? 9) || a.originalIndex - b.originalIndex;
            }
            return a.originalIndex - b.originalIndex;
        });
    }

    function setRunLoading(isLoading) {
        els.runBtn.disabled = isLoading;
        els.runBtnLabel.textContent = isLoading ? 'Running checks' : 'Start checks';
        els.runSpinner.classList.toggle('hidden', !isLoading);
        els.progressPanel.classList.toggle('hidden', !isLoading);
        els.progressLabel.textContent = isLoading ? 'Waiting for AWS responses...' : '';
        if (isLoading) {
            setConnectionState('running', 'Assessment in progress');
        } else {
            setConnectionState(state.backendOnline ? 'online' : 'offline', state.backendOnline ? 'Backend ready' : 'Backend unavailable');
        }
    }

    function setConnectionState(kind, label) {
        els.statusDot.className = `dot ${kind}`;
        els.statusText.textContent = label;
    }

    function updateSummary(results) {
        const counts = countByStatus(results);
        setText(els.statTotal, results.length);
        setText(els.statAllowed, counts.allowed);
        setText(els.statDenied, counts.denied);
        setText(els.statError, counts.error);
    }

    function countByStatus(results) {
        return results.reduce((acc, result) => {
            const key = (result.statusKey || result.status || 'error').toLowerCase();
            if (key === 'allowed') acc.allowed += 1;
            else if (key === 'denied') acc.denied += 1;
            else acc.error += 1;
            return acc;
        }, { allowed: 0, denied: 0, error: 0 });
    }

    function updateRunMeta(overrideText) {
        if (overrideText) {
            els.runMeta.textContent = overrideText;
            return;
        }
        if (!state.lastRun || !state.lastRun.finishedAt) {
            els.runMeta.textContent = 'No assessment has been run.';
            return;
        }
        const time = state.lastRun.finishedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        els.runMeta.textContent = `Last run ${time} in ${state.lastRun.region}`;
    }

    function statusSummary(result) {
        if (result.statusKey === 'allowed') {
            return result.data === null ? 'Permission allowed.' : 'Permission allowed. Response data is available.';
        }
        if (result.statusKey === 'denied') {
            return summarizeAwsMessage(result.message) || 'AWS denied this permission.';
        }
        return summarizeAwsMessage(result.message) || 'The check returned an error.';
    }

    function summarizeAwsMessage(message) {
        if (!message) return '';
        const codeMatch = message.match(/\(([^)]+)\)/);
        if (codeMatch) return codeMatch[1];
        const firstSentence = message.split(/[.\n]/)[0];
        return firstSentence.length > 130 ? `${firstSentence.slice(0, 127)}...` : firstSentence;
    }

    function showNotice(type, message) {
        els.notice.className = `notice ${type}`;
        els.notice.textContent = message;
    }

    function hideNotice() {
        els.notice.className = 'notice hidden';
        els.notice.textContent = '';
    }

    function clearResults() {
        state.results = [];
        state.expanded.clear();
        state.query = '';
        state.filter = 'all';
        state.sort = 'original';
        state.lastRun = null;
        els.search.value = '';
        els.sort.value = 'original';
        document.querySelectorAll('.filter-chip').forEach((button) => {
            button.classList.toggle('active', button.dataset.filter === 'all');
        });
        hideNotice();
        updateSummary([]);
        updateRunMeta();
        renderResults();
    }

    function exportResults() {
        const blob = new Blob([JSON.stringify(state.results, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `aws-permission-assessment-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function openModal(action, service) {
        els.modalTitle.textContent = action;
        els.modalService.textContent = `${service || action.split(':')[0] || 'aws'} follow-up`;
        els.executeAction.value = action;
        els.executeParams.value = '{}';
        els.executeJsonError.classList.add('hidden');
        els.executeResult.classList.add('hidden');
        els.executeSubmit.disabled = false;
        els.modal.classList.remove('hidden');
        els.executeParams.focus();
    }

    function closeModal() {
        els.modal.classList.add('hidden');
    }

    function validateExecuteJson() {
        try {
            JSON.parse(els.executeParams.value || '{}');
            els.executeJsonError.classList.add('hidden');
            els.executeJsonError.textContent = '';
            els.executeSubmit.disabled = false;
            return true;
        } catch (error) {
            els.executeJsonError.textContent = `Invalid JSON: ${error.message}`;
            els.executeJsonError.classList.remove('hidden');
            els.executeSubmit.disabled = true;
            return false;
        }
    }

    async function executeFollowUp(event) {
        event.preventDefault();
        if (!validateExecuteJson()) return;

        const creds = getCredentials();
        const action = els.executeAction.value;
        const service = action.includes(':') ? action.split(':')[0] : 'sts';
        const payload = {
            ...creds,
            service,
            action,
            params_json: els.executeParams.value || '{}'
        };

        setExecuteLoading(true);
        els.executeResult.classList.add('hidden');

        try {
            const response = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            renderExecuteResult(result);

            if (!response.ok) {
                showNotice('error', `Follow-up action failed (${response.status}).`);
            }
        } catch (error) {
            renderExecuteResult({ status: 'Error', message: error.message, data: null });
        } finally {
            setExecuteLoading(false);
        }
    }

    function setExecuteLoading(isLoading) {
        els.executeSubmit.disabled = isLoading;
        els.executeSubmitLabel.textContent = isLoading ? 'Executing' : 'Execute';
        els.executeSpinner.classList.toggle('hidden', !isLoading);
    }

    function renderExecuteResult(result) {
        const status = String(result.status || 'Error');
        const statusKey = status.toLowerCase();
        els.executeResult.classList.remove('hidden');
        els.executeBadge.className = `badge ${statusKey}`;
        els.executeBadge.textContent = status;
        els.executeData.className = `code-block ${statusKey}`;
        els.executeData.textContent = statusKey === 'allowed'
            ? JSON.stringify(result.data ?? {}, null, 2)
            : String(result.message || 'No response body was returned.');
    }

    function createBadge(statusKey, text) {
        return createEl('span', `badge ${statusKey}`, text);
    }

    function createIconButton(label, action, id, expanded) {
        const button = createEl('button', 'icon-action');
        button.type = 'button';
        button.dataset.action = action;
        button.dataset.id = id;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-expanded', String(Boolean(expanded)));
        button.innerHTML = expanded
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
        return button;
    }

    function createEl(tag, className = '', content = null) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (Array.isArray(content)) node.append(...content);
        else if (content !== null) node.textContent = content;
        return node;
    }

    function setText(node, value) {
        node.textContent = String(value);
    }

    function formatServerDetail(detail) {
        if (typeof detail === 'string') return detail;
        return JSON.stringify(detail);
    }

    async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
});
