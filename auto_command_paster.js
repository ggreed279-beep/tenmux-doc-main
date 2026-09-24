// ══════════════════════════════════════════════════════
//  MODULE: AutoCommandPaster v2.5.4
//  Porta o "Grepolis Command Paster" (Kelsiito) para o
//  MultBot, mantendo toda a lógica original:
//   • Spam serial até acertar o segundo exato
//   • Calibração por desvio e RTT
//   • Lease entre abas
//   • Sync do Planeador nativo (attack_planer/attacks)
// ══════════════════════════════════════════════════════
var AutoCommandPaster = class extends MultUtil {
    VERSION = '2.5.4';
    PREFIX = '[CommandPaster]';

    CONFIG = Object.freeze({
        preflightLeadMs: 20_000,
        attemptLeadMs: 15_000,
        plannerRefreshMs: 1_000,
        ajaxTimeoutMs: 12_000,
        commandResolveTimeoutMs: 12_000,
        maximumRttMs: 2_000,
        earlyBiasMs: 120,
        maximumParallel: 1,
        spamGapMs: 20,
        maximumFailedAttempts: 200,
        timingCorrectionWindowMs: 10_000,
        leaseDurationMs: 7_000,
        leaseHeartbeatMs: 2_000,
        logLimit: 100,
    });

    DEFAULT_SETTINGS = Object.freeze({ attack: 0, support: 0, nc: 0 });

    TERMINAL_STATES = new Set(['confirmed', 'cancelled', 'failed', 'expired']);
    SUPPORTED_TYPES = new Set(['attack', 'support', 'revolt']);
    UNIT_KEY = /^[a-z][a-z0-9_]*$/;

    // Estado da instância
    _namespace = '';
    _storageKey = '';
    _leaseKey = '';
    _state = null;
    _ownerId = null;
    _activeSends = 0;
    _tickTimer = 0;
    _refreshTimer = 0;
    _leaseTimer = 0;
    _clockSyncPromise = null;
    _clockAnchor = null;
    _memoryLease = null;
    _stopped = false;
    _stopRequested = false;
    _ready = false;

    constructor(c, s) {
        super(c, s);
        this._ownerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this._state = this._blankState();

        let attempts = 0;
        const waitForGame = setInterval(() => {
            attempts++;
            if (uw.Game?.world_id && uw.Game?.player_id && uw.gpAjax) {
                clearInterval(waitForGame);
                try { this._initialize(); }
                catch (e) { this.console.log(`${this.PREFIX} init error: ${e?.message ?? e}`); }
            } else if (attempts >= 120) {
                clearInterval(waitForGame);
                this.console.log(`${this.PREFIX} APIs do Grepolis indisponíveis.`);
            }
        }, 500);
    }

    // ══════════════════════════════════════════════════
    //  UI
    // ══════════════════════════════════════════════════

    settings = () => {
        requestAnimationFrame(() => this._refreshStatus());
        const s = this._state?.settings || this.DEFAULT_SETTINGS;
        const opts = (cur) => Array.from({ length: 16 }, (_, v) =>
            `<option value="${v}"${Number(cur) === v ? ' selected' : ''}>${v}</option>`).join('');
        const dis = this._state?.armed ? ' disabled' : '';

        return (
            '<div class="game_border" style="margin-bottom:20px;">' +
            '<div class="game_border_top"></div><div class="game_border_bottom"></div>' +
            '<div class="game_border_left"></div><div class="game_border_right"></div>' +
            '<div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
            '<div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
            this.getTitleHtml('gcp_title', 'Command Paster', this.toggle, '', Boolean(this._state?.armed)) +
            '<div style="padding:6px 10px;font-size:11px;color:#5a3a0a;">' +
            'Envia comandos já guardados no <b>Planeador nativo</b> no segundo exato. ' +
            'Spam serial com calibração automática por desvio e RTT.' +
            '</div>' +
            '<div style="padding:6px 10px;display:flex;gap:14px;font-size:11px;font-weight:bold;">' +
            `<label>Ataque <select id="gcp_off_attack"${dis}>${opts(s.attack)}</select>s</label>` +
            `<label>Apoio <select id="gcp_off_support"${dis}>${opts(s.support)}</select>s</label>` +
            `<label>NC <select id="gcp_off_nc"${dis}>${opts(s.nc)}</select>s</label>` +
            '</div>' +
            '<div id="gcp_status" style="padding:0 10px 6px;font-size:11px;color:#5a3a0a;">' +
            this._buildStatusHtml() +
            '</div>' +
            '<div id="gcp_log" style="padding:2px 10px 8px;font-size:11px;color:#5a3a0a;min-height:16px;"></div>' +
            '</div>'
        );
    };

    toggle = () => {
        if (this._state?.armed) this._disarm();
        else void this._arm();
    };

    setOffset = (type, value) => {
        if (this._state?.armed) return;
        const sec = Math.min(15, Math.max(0, Math.trunc(Number(value) || 0)));
        this._state.settings[type] = sec;
        this._persist();
    };

    _refreshStatus() {
        // Liga os selects
        const bind = (id, type) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.value !== String(this._state.settings[type])) el.value = String(this._state.settings[type]);
            if (!el._gcp_bound) {
                el._gcp_bound = true;
                el.addEventListener('change', () => this.setOffset(type, el.value));
            }
        };
        bind('gcp_off_attack', 'attack');
        bind('gcp_off_support', 'support');
        bind('gcp_off_nc', 'nc');

        const $s = uw.$('#gcp_status');
        if ($s.length) $s.html(this._buildStatusHtml());
    }

    _buildStatusHtml() {
        if (!this._ready) return 'Aguardando APIs do Grepolis…';
        const armed = this._state.armed ? '<b style="color:#1a6b2a;">ARMADO</b>' : '<b>parado</b>';
        const jobs = Object.values(this._state.jobs || {});
        const pending = jobs.filter((j) => !this.TERMINAL_STATES.has(j.status)).length;
        const confirmed = jobs.filter((j) => j.status === 'confirmed').length;
        const failed = jobs.filter((j) => j.status === 'failed').length;
        const rtt = this._state.rttSamples?.length
            ? Math.round(this._median(this._state.rttSamples))
            : '—';
        return `${armed} · Pendentes: <b>${pending}</b> · Confirmados: <b>${confirmed}</b> · Falhas: <b>${failed}</b> · RTT: <b>${rtt} ms</b>`;
    }

    _log(level, message, details = {}) {
        try { this.console.log(`${this.PREFIX} ${message}`); } catch (e) {}
        const icon = level === 'error' ? '✗' : level === 'warn' ? '⚠' : '·';
        try {
            const $log = uw.$('#gcp_log');
            if ($log.length) {
                const color = level === 'error' ? '#f87171' : level === 'warn' ? '#eab308' : '#1a6b2a';
                $log.text(`${icon} ${message}`).css('color', color);
            }
        } catch (e) {}
        try {
            if (this._state) {
                this._state.logs = [...(this._state.logs || []), { at: Date.now(), level, message, details }]
                    .slice(-this.CONFIG.logLimit);
                this._persist();
            }
        } catch (e) {}
    }

    _notify(message, type = 'error') {
        const human = uw.HumanMessage;
        try {
            if (type === 'success' && typeof human?.success === 'function') human.success(`MultBot: ${message}`);
            else if (typeof human?.error === 'function') human.error(`MultBot: ${message}`);
        } catch (e) {}
    }

    // ══════════════════════════════════════════════════
    //  CORE HELPERS (portado 1:1)
    // ══════════════════════════════════════════════════

    _number(v, f = 0) { const p = Number(v); return Number.isFinite(p) ? p : f; }
    _integer(v, f = 0) { return Math.max(0, Math.floor(this._number(v, f))); }
    _signedInteger(v, f = 0) { return Math.trunc(this._number(v, f)); }

    _timestampMs(v) {
        const p = this._number(v);
        if (!p) return 0;
        return p < 10_000_000_000 ? p * 1_000 : p;
    }

    _canonicalType(v) {
        const t = String(v || '').toLowerCase();
        if (/support|apoio|refor/.test(t)) return 'support';
        if (/attack|ataque|revolt|colon|takeover/.test(t)) return 'attack';
        return 'unknown';
    }

    _normalizeUnits(v) {
        const out = {};
        for (const [name, amount] of Object.entries(v || {})) {
            if (!this.UNIT_KEY.test(name) || name === 'militia') continue;
            const n = this._integer(amount);
            if (n > 0) out[name] = n;
        }
        return out;
    }

    _parseStrategies(v) {
        if (Array.isArray(v)) return v.map(String).filter(Boolean);
        if (!v) return [];
        try {
            const p = JSON.parse(v);
            return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
        } catch { return String(v).split(',').map((x) => x.trim()).filter(Boolean); }
    }

    _commandKind(cmd) {
        if (this._integer(cmd?.units?.colonize_ship) > 0) return 'nc';
        return this._canonicalType(cmd?.type) === 'support' ? 'support' : 'attack';
    }

    _toleranceForCommand(cmd, settings = {}) {
        return Math.min(15, Math.max(0, this._signedInteger(settings[this._commandKind(cmd)], 0)));
    }

    _normalizePlannedCommand(raw) {
        const type = String(raw?.type || '').toLowerCase();
        const canonical = this._canonicalType(type);
        const units = this._normalizeUnits(raw?.units);
        const id = String(raw?.id ?? '');
        const planId = String(raw?.plan_id ?? '');
        const originTownId = String(raw?.origin_town_id ?? raw?.town_id ?? '');
        const targetTownId = String(raw?.target_town_id ?? raw?.target_id ?? '');
        const sendAt = this._timestampMs(raw?.send_at);
        const arrivalAt = this._timestampMs(raw?.arrival_at);
        const valid = Boolean(
            id && planId && originTownId && targetTownId
            && sendAt && arrivalAt && arrivalAt > sendAt
            && this.SUPPORTED_TYPES.has(type) && canonical !== 'unknown'
            && Object.keys(units).length
        );
        return {
            id, planId,
            planName: String(raw?.plan_name || ''),
            type, canonicalType: canonical,
            originTownId, targetTownId, sendAt, arrivalAt, units,
            useHero: Boolean(raw?.use_hero),
            spell: raw?.spell || '',
            strategies: this._parseStrategies(raw?.strategies),
            canEdit: raw?.can_edit !== false,
            valid,
            invalidReason: valid ? '' : 'planned-command-incomplete'
        };
    }

    _buildSendPayload(cmd) {
        const payload = {
            id: this._integer(cmd.targetTownId),
            town_id: this._integer(cmd.originTownId),
            type: cmd.type,
            nl_init: true,
            ...this._normalizeUnits(cmd.units)
        };
        if (cmd.useHero) payload.use_hero = true;
        if (cmd.spell) payload.power_id = cmd.spell;
        if (cmd.strategies?.length) payload.attacking_strategy = [...cmd.strategies];
        return payload;
    }

    _plannedTimes(cmd, settings = {}) {
        return {
            toleranceSeconds: this._toleranceForCommand(cmd, settings),
            dispatchAt: cmd.sendAt,
            desiredArrivalAt: cmd.arrivalAt
        };
    }

    _arrivalResult(actualArrivalAt, desiredArrivalAt, toleranceSeconds = 0) {
        const a = Math.floor(this._number(actualArrivalAt) / 1_000) * 1_000;
        const d = Math.floor(this._number(desiredArrivalAt) / 1_000) * 1_000;
        const deviationMs = a - d;
        const earliest = -Math.max(0, this._signedInteger(toleranceSeconds, 0)) * 1_000;
        return { deviationMs, accepted: deviationMs >= earliest && deviationMs <= 0, retry: deviationMs < earliest };
    }

    _commandFingerprint(cmd) {
        return JSON.stringify({
            id: cmd?.id, planId: cmd?.planId, type: cmd?.type,
            originTownId: cmd?.originTownId, targetTownId: cmd?.targetTownId,
            sendAt: cmd?.sendAt, arrivalAt: cmd?.arrivalAt, units: cmd?.units,
            useHero: cmd?.useHero, spell: cmd?.spell, strategies: cmd?.strategies
        });
    }

    _median(values) {
        const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return 0;
        const m = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
    }

    _releaseAt(dispatchAt, rttMs, earlyBiasMs = 120) {
        return this._number(dispatchAt) - Math.max(0, this._number(rttMs)) / 2 - Math.max(0, this._number(earlyBiasMs));
    }

    _calibratedAttemptAt(sendStartedAt, deviationMs, toleranceSeconds = 0) {
        const center = 500 - Math.max(0, this._signedInteger(toleranceSeconds, 0)) * 500;
        return this._number(sendStartedAt) - this._number(deviationMs) + center;
    }

    _isTerminal(job) { return this.TERMINAL_STATES.has(job?.status); }

    _reconcileCapturedJobs({ jobs = {}, capturedIds = [], commands = [], offsets = {}, now = 0 }) {
        const cmdMap = new Map(commands.map((c) => [String(c.id), c]));
        const next = {};
        for (const rawId of capturedIds) {
            const id = String(rawId);
            const existing = jobs[id] ? { ...jobs[id] } : { id, status: 'pending' };
            if (this._isTerminal(existing)) { next[id] = existing; continue; }
            const cmd = cmdMap.get(id);
            if (!cmd) { next[id] = { ...existing, status: 'cancelled', error: 'removed-from-planner' }; continue; }
            const times = this._plannedTimes(cmd, offsets);
            const fp = this._commandFingerprint(cmd);
            const changed = Boolean(existing.fingerprint && existing.fingerprint !== fp);
            next[id] = {
                ...existing, command: cmd, fingerprint: fp, ...times,
                error: '',
                ...(changed ? { status: 'pending', releaseAt: 0, rttMs: 0, previewValidatedAt: 0, attempts: 0 } : {})
            };
            if (!cmd.valid) { next[id].status = 'failed'; next[id].error = cmd.invalidReason; }
            else if (times.dispatchAt + 10_000 <= now && existing.status !== 'sending') {
                next[id].status = 'expired'; next[id].error = 'dispatch-time-passed';
            }
        }
        return next;
    }

    // ══════════════════════════════════════════════════
    //  STATE / STORAGE
    // ══════════════════════════════════════════════════

    _blankState() {
        return {
            version: this.VERSION, armed: false,
            settings: { ...this.DEFAULT_SETTINGS },
            capturedIds: [], jobs: {},
            confirmedIds: [], confirmedFingerprints: [],
            rttSamples: [], logs: [], updatedAt: 0
        };
    }

    _loadValue(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
    }

    _saveValue(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    _loadState() {
        const stored = this._loadValue(this._storageKey, null);
        const base = this._blankState();
        if (!stored || typeof stored !== 'object') return base;
        return {
            ...base, ...stored, version: this.VERSION,
            settings: { ...this.DEFAULT_SETTINGS, ...(stored.settings || {}) },
            capturedIds: Array.isArray(stored.capturedIds) ? stored.capturedIds.map(String) : [],
            jobs: stored.jobs && typeof stored.jobs === 'object' ? stored.jobs : {},
            confirmedIds: Array.isArray(stored.confirmedIds) ? stored.confirmedIds.map(String) : [],
            confirmedFingerprints: Array.isArray(stored.confirmedFingerprints) ? stored.confirmedFingerprints.map(String) : [],
            rttSamples: Array.isArray(stored.rttSamples) ? stored.rttSamples.slice(-12) : [],
            logs: Array.isArray(stored.logs) ? stored.logs.slice(-this.CONFIG.logLimit) : []
        };
    }

    _persist() {
        if (!this._state) return;
        this._state.updatedAt = Date.now();
        this._saveValue(this._storageKey, this._state);
    }

    // ══════════════════════════════════════════════════
    //  CLOCK / AJAX / LEASE
    // ══════════════════════════════════════════════════

    _rawServerTimestamp() {
        try { return uw.Timestamp?.server?.(); } catch { return 0; }
    }

    _serverNowMs() {
        if (this._clockAnchor) {
            return this._clockAnchor.serverMs + (performance.now() - this._clockAnchor.performanceMs);
        }
        const raw = this._rawServerTimestamp();
        const parsed = this._number(raw);
        if (parsed >= 10_000_000_000 || !Number.isInteger(parsed)) return this._timestampMs(parsed);
        if (parsed) return parsed * 1_000 + 500;
        return Date.now();
    }

    async _synchronizeServerClock() {
        if (this._clockSyncPromise) return this._clockSyncPromise;
        this._clockSyncPromise = (async () => {
            const initial = this._number(this._rawServerTimestamp());
            if (!initial) {
                this._clockAnchor = { serverMs: Date.now(), performanceMs: performance.now() };
                return this._clockAnchor;
            }
            if (initial >= 10_000_000_000 || !Number.isInteger(initial)) {
                this._clockAnchor = { serverMs: this._timestampMs(initial), performanceMs: performance.now() };
                return this._clockAnchor;
            }
            const deadline = performance.now() + 1_500;
            while (performance.now() < deadline) {
                await new Promise((r) => setTimeout(r, 8));
                const current = this._number(this._rawServerTimestamp());
                if (current > initial) {
                    this._clockAnchor = { serverMs: current * 1_000, performanceMs: performance.now() };
                    return this._clockAnchor;
                }
            }
            this._clockAnchor = { serverMs: initial * 1_000 + 500, performanceMs: performance.now() };
            return this._clockAnchor;
        })().finally(() => { this._clockSyncPromise = null; });
        return this._clockSyncPromise;
    }

    _ajax(method, controller, action, data, timeoutMs = this.CONFIG.ajaxTimeoutMs) {
        return new Promise((resolve, reject) => {
            const fn = uw.gpAjax?.[method];
            if (typeof fn !== 'function') return reject(new Error(`gpAjax.${method} indisponível.`));
            let settled = false;
            const timeout = setTimeout(() => finish(new Error(`Timeout: ${controller}/${action}`)), timeoutMs);
            const finish = (error, response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (error) reject(error); else resolve(response);
            };
            try {
                const req = fn.call(uw.gpAjax, controller, action, data || {}, false, (r) => finish(null, r));
                if (req?.then) req.then((r) => finish(null, r), (e) => finish(e));
                else if (req?.fail) req.fail((e) => finish(e));
            } catch (e) { finish(e); }
        });
    }

    _leaseRecord() {
        try { return JSON.parse(localStorage.getItem(this._leaseKey) || 'null'); }
        catch { return this._memoryLease; }
    }

    _writeLease(rec) {
        this._memoryLease = rec;
        try { localStorage.setItem(this._leaseKey, JSON.stringify(rec)); } catch (e) {}
    }

    _removeLease() {
        this._memoryLease = null;
        try { localStorage.removeItem(this._leaseKey); } catch (e) {}
    }

    _ownsLease(now = Date.now()) {
        const l = this._leaseRecord();
        return Boolean(l?.owner === this._ownerId && this._number(l.expiresAt) > now);
    }

    _acquireLease() {
        const now = Date.now();
        const cur = this._leaseRecord();
        if (cur?.owner && cur.owner !== this._ownerId && this._number(cur.expiresAt) > now) return false;
        this._writeLease({ owner: this._ownerId, expiresAt: now + this.CONFIG.leaseDurationMs });
        return this._ownsLease(now);
    }

    _renewLease() {
        if (this._stopped) return;
        if (!this._ownsLease()) {
            if (this._acquireLease()) {
                this._state = this._loadState();
                if (this._state.armed) this._scheduleTick(0);
            }
        } else {
            this._writeLease({ owner: this._ownerId, expiresAt: Date.now() + this.CONFIG.leaseDurationMs });
        }
    }

    _releaseLease() {
        try { if (this._leaseRecord()?.owner === this._ownerId) this._removeLease(); } catch (e) {}
    }

    // ══════════════════════════════════════════════════
    //  MOVEMENTS
    // ══════════════════════════════════════════════════

    _movementModels() {
        try {
            const direct = uw.MM?.getModels?.()?.MovementsUnits;
            if (direct && typeof direct === 'object') return Object.values(direct);
            return uw.MM?.getOnlyCollectionByName?.('MovementsUnits')?.models || [];
        } catch { return []; }
    }

    _movementRecord(model) {
        const s = model?.attributes || model?.toJSON?.() || model || {};
        return {
            id: String(s.command_id ?? s.id ?? model?.id ?? ''),
            type: this._canonicalType(s.command_type ?? s.type ?? s.movement_type),
            originTownId: String(s.origin_town_id ?? s.home_town_id ?? s.source_town_id ?? ''),
            targetTownId: String(s.target_town_id ?? s.destination_town_id ?? s.town_id ?? ''),
            startedAt: this._timestampMs(s.started_at ?? s.start_at ?? s.created_at),
            arrivalAt: this._timestampMs(s.arrival_at_ms ?? s.arrival_at ?? s.arrival_time ?? s.finished_at),
            returning: Boolean(s.returning ?? s.is_returning)
        };
    }

    _movements() {
        return this._movementModels().map((m) => this._movementRecord(m)).filter((m) => m.id);
    }

    _commandIds() { return new Set(this._movements().map((m) => m.id)); }

    _findResponseCommand(response) {
        const visited = new Set();
        const visit = (value, depth = 0) => {
            if (!value || depth > 6) return null;
            if (typeof value !== 'object' || visited.has(value)) return null;
            visited.add(value);
            const id = value.command_id ?? value.commandId;
            const arr = value.arrival_at_ms ?? value.arrival_at ?? value.arrival_time;
            if (id) return { id: String(id), arrivalAt: this._timestampMs(arr) };
            for (const c of Object.values(value)) {
                const f = visit(c, depth + 1);
                if (f) return f;
            }
            return null;
        };
        return visit(response);
    }

    async _waitForMovement(beforeIds, cmd, sendStartedAt, response, timeoutMs = this.CONFIG.commandResolveTimeoutMs) {
        const direct = this._findResponseCommand(response);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const candidates = this._movements().filter((m) => (
                !beforeIds.has(m.id) && !m.returning
                && m.type === cmd.canonicalType
                && m.originTownId === cmd.originTownId
                && m.targetTownId === cmd.targetTownId
                && (!m.startedAt || m.startedAt >= sendStartedAt - 5_000)
            ));
            if (direct?.id) {
                const exact = candidates.find((m) => m.id === direct.id);
                if (exact) return exact;
                if (direct.arrivalAt) return { id: direct.id, arrivalAt: direct.arrivalAt };
            }
            if (candidates.length === 1) return candidates[0];
            if (candidates.length > 1) throw new Error('Mais de um movimento novo corresponde ao envio.');
            await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('Comando enviado não apareceu nos movimentos.');
    }

    _delay(ms) { return new Promise((r) => setTimeout(r, Math.max(0, this._number(ms)))); }

    // ══════════════════════════════════════════════════
    //  PLANNER API
    // ══════════════════════════════════════════════════

    _responseJson(r) { return r?.json || r?.data || r || {}; }

    async _fetchPlannedCommands() {
        const response = await this._ajax('ajaxGet', 'attack_planer', 'attacks', { nl_init: true });
        const rows = response?.data?.attacks || this._responseJson(response)?.attacks || [];
        return rows.map((r) => this._normalizePlannedCommand(r));
    }

    _ownTownIds() {
        const towns = uw.ITowns?.getTowns?.() || uw.ITowns?.towns || {};
        return new Set(Object.entries(towns).map(([fid, t]) => String(
            t?.getId?.() ?? t?.id ?? t?.attributes?.id ?? fid
        )));
    }

    _previewAvailableUnits(response) {
        const units = this._responseJson(response)?.units || {};
        const out = {};
        for (const [name, rec] of Object.entries(units)) {
            out[name] = this._integer(rec?.total ?? rec?.count ?? rec?.amount ?? rec);
        }
        return out;
    }

    _validatePreview(cmd, response) {
        const data = this._responseJson(response);
        if (data.controller_type && data.controller_type !== 'town_info') throw new Error('Preview devolveu controlador inesperado.');
        if (data.target_id && String(data.target_id) !== cmd.targetTownId) throw new Error('Preview devolveu cidade-alvo diferente.');
        const pType = this._canonicalType(data.type);
        if (pType !== 'unknown' && pType !== cmd.canonicalType) throw new Error('Preview devolveu tipo de comando diferente.');
        const avail = this._previewAvailableUnits(response);
        for (const [name, req] of Object.entries(cmd.units)) {
            if (this._integer(avail[name]) < req) throw new Error(`Tropas insuficientes: ${name} (${avail[name] || 0}/${req}).`);
        }
        return avail;
    }

    async _measurePreview(cmd) {
        const action = cmd.canonicalType === 'support' ? 'support' : 'attack';
        const started = performance.now();
        const response = await this._ajax('ajaxGet', 'town_info', action, {
            id: this._integer(cmd.targetTownId), town_id: this._integer(cmd.originTownId), nl_init: true
        });
        const rttMs = performance.now() - started;
        this._validatePreview(cmd, response);
        return { response, rttMs };
    }

    // ══════════════════════════════════════════════════
    //  JOB HELPERS
    // ══════════════════════════════════════════════════

    _updateJob(id, changes) {
        this._state.jobs[id] = { ...this._state.jobs[id], ...changes, updatedAt: Date.now() };
        this._persist();
        // Refresh do painel se a aba estiver aberta
        try {
            const $s = uw.$('#gcp_status');
            if ($s.length) $s.html(this._buildStatusHtml());
        } catch (e) {}
    }

    _jobWasEdited(job) {
        const latest = this._state.jobs[job.id];
        return Boolean(latest?.fingerprint && latest.fingerprint !== job.fingerprint);
    }

    _appendAttemptRecord(id, record) {
        const hist = Array.isArray(this._state.jobs[id]?.attemptHistory)
            ? this._state.jobs[id].attemptHistory.slice(-99) : [];
        this._updateJob(id, { attemptHistory: [...hist, record] });
    }

    async _cancelAttempt(job, movement) {
        const start = this._serverNowMs();
        await this._ajax('ajaxPost', 'command_info', 'cancel_command', {
            id: this._integer(movement.id), town_id: this._integer(job.command.originTownId)
        }, 5_000);
        const end = this._serverNowMs();
        this._log('info', `Tentativa cancelada (${job.id}). Retomando spam.`);
        return { cancelStartedAt: start, cancelFinishedAt: end, cancelRttMs: end - start };
    }

    // ══════════════════════════════════════════════════
    //  MAIN LOGIC
    // ══════════════════════════════════════════════════

    async _preflightJob(job) {
        if (job.status !== 'pending') return;
        this._updateJob(job.id, { status: 'preflight', error: '' });
        try {
            if (!this._ownsLease()) throw new Error('Outra aba controla este mundo.');
            const currentCommands = await this._fetchPlannedCommands();
            const current = currentCommands.find((c) => c.id === job.id);
            if (!current) { this._updateJob(job.id, { status: 'cancelled', error: 'removed-from-planner' }); return; }
            const times = this._plannedTimes(current, this._state.settings);
            this._updateJob(job.id, { command: current, fingerprint: this._commandFingerprint(current), ...times });
            job = this._state.jobs[job.id];
            if (!this._ownTownIds().has(job.command.originTownId)) throw new Error('Cidade de origem não pertence ao jogador.');
            await this._synchronizeServerClock();

            const samples = [];
            let response = null;
            for (let i = 0; i < 3; i++) {
                const m = await this._measurePreview(job.command);
                response = m.response;
                samples.push(m.rttMs);
                if (i < 2) await new Promise((r) => setTimeout(r, 120));
            }
            const rttMs = this._median(samples);
            this._state.rttSamples = [...this._state.rttSamples, ...samples].slice(-12);
            if (rttMs > this.CONFIG.maximumRttMs) throw new Error(`Latência excessiva (${Math.round(rttMs)} ms).`);
            if (this._serverNowMs() >= job.dispatchAt + this.CONFIG.timingCorrectionWindowMs) {
                this._updateJob(job.id, { status: 'expired', error: 'preflight-finished-late' });
                return;
            }
            if (this._state.jobs[job.id]?.status !== 'preflight') return;
            this._updateJob(job.id, {
                status: 'ready', rttMs,
                releaseAt: job.dispatchAt - this.CONFIG.attemptLeadMs,
                previewValidatedAt: Date.now(),
                previewTargetId: String(this._responseJson(response)?.target_id || job.command.targetTownId)
            });
        } catch (e) {
            this._updateJob(job.id, { status: 'failed', error: e.message || String(e) });
            this._log('error', `Pré-validação falhou (${job.id}): ${e.message}`);
        }
    }

    async _sendJob(job) {
        if (job.status !== 'ready' || this._activeSends >= this.CONFIG.maximumParallel) return;
        if (!this._ownsLease()) return;
        const now = this._serverNowMs();
        if (now > job.dispatchAt + this.CONFIG.timingCorrectionWindowMs) {
            this._updateJob(job.id, { status: 'expired', error: 'attempt-window-passed' });
            return;
        }
        this._activeSends++;
        this._updateJob(job.id, { status: 'sending', sendStartedAt: now, error: '' });
        try {
            while (this._ownsLease() && this._state.armed && !this._stopRequested) {
                if (this._jobWasEdited(job)) { this._updateJob(job.id, { status: 'pending', error: '' }); break; }
                if (this._serverNowMs() > job.dispatchAt + this.CONFIG.timingCorrectionWindowMs) {
                    this._updateJob(job.id, { status: 'failed', error: 'target-second-missed' });
                    break;
                }
                if (this._number(this._state.jobs[job.id]?.failedAttempts) >= this.CONFIG.maximumFailedAttempts) {
                    this._updateJob(job.id, { status: 'failed', error: 'maximum-failed-attempts' });
                    break;
                }

                const beforeIds = this._commandIds();
                const sendStartedAt = this._serverNowMs();
                const attempts = this._number(this._state.jobs[job.id]?.attempts) + 1;
                this._updateJob(job.id, {
                    status: 'sending', sendStartedAt, sendResponseAt: 0, sendRttMs: 0,
                    actualArrivalAt: 0, deviationMs: null, attempts, error: ''
                });

                let response = null;
                try {
                    response = await this._ajax('ajaxPost', 'town_info', 'send_units', this._buildSendPayload(job.command), 5_000);
                } catch (e) {
                    throw new Error(`Envio ambíguo: ${e.message || e}`);
                }
                const sendResponseAt = this._serverNowMs();
                this._updateJob(job.id, { sendResponseAt, sendRttMs: sendResponseAt - sendStartedAt });

                const direct = this._findResponseCommand(response);
                let movement = null;
                try {
                    movement = await this._waitForMovement(
                        beforeIds, job.command, sendStartedAt, response,
                        direct?.id ? this.CONFIG.commandResolveTimeoutMs : 750
                    );
                } catch (e) {
                    if (direct?.id || !String(e.message).includes('não apareceu nos movimentos')) throw e;
                }

                if (this._jobWasEdited(job)) {
                    if (movement) {
                        const c = await this._cancelAttempt(job, movement);
                        this._appendAttemptRecord(job.id, {
                            attempt: attempts, movementId: movement.id,
                            requestAt: sendStartedAt, responseAt: sendResponseAt,
                            sendRttMs: sendResponseAt - sendStartedAt,
                            arrivalAt: movement.arrivalAt, cancelRttMs: c.cancelRttMs, result: 'CANCELADO-APÓS-EDIÇÃO'
                        });
                    }
                    this._updateJob(job.id, { status: 'pending', error: '' });
                    break;
                }

                if (this._stopRequested || !this._state.armed) {
                    if (movement) {
                        try {
                            const c = await this._cancelAttempt(job, movement);
                            this._appendAttemptRecord(job.id, {
                                attempt: attempts, movementId: movement.id,
                                requestAt: sendStartedAt, responseAt: sendResponseAt,
                                sendRttMs: sendResponseAt - sendStartedAt,
                                arrivalAt: movement.arrivalAt, cancelRttMs: c.cancelRttMs, result: 'CANCELADO-MANUAL'
                            });
                        } catch (e) {
                            this._updateJob(job.id, { status: 'failed', error: `manual-cancel-failed:${e.message || e}` });
                            throw e;
                        }
                    }
                    this._updateJob(job.id, { status: 'cancelled', error: 'manual-disarm' });
                    break;
                }

                if (!movement) {
                    const failed = this._number(this._state.jobs[job.id]?.failedAttempts) + 1;
                    this._updateJob(job.id, {
                        failedAttempts: failed,
                        error: `envio-rejeitado-${failed}/${this.CONFIG.maximumFailedAttempts}`
                    });
                    this._appendAttemptRecord(job.id, {
                        attempt: attempts, requestAt: sendStartedAt, responseAt: sendResponseAt,
                        sendRttMs: sendResponseAt - sendStartedAt, result: 'REJEITADO'
                    });
                    await this._delay(this.CONFIG.spamGapMs);
                    continue;
                }

                const timing = this._arrivalResult(movement.arrivalAt, job.desiredArrivalAt, job.toleranceSeconds);
                this._updateJob(job.id, {
                    movementId: movement.id, actualArrivalAt: movement.arrivalAt,
                    deviationMs: timing.deviationMs, timingAccepted: timing.accepted,
                    lastMovementRequestAt: sendStartedAt, lastMovementResponseAt: sendResponseAt,
                    lastMovementSendRttMs: sendResponseAt - sendStartedAt,
                    lastMovementArrivalAt: movement.arrivalAt, lastMovementDeviationMs: timing.deviationMs,
                    lastMovementOutcome: timing.accepted ? 'aceite' : (timing.retry ? 'cedo' : 'tarde')
                });

                if (timing.accepted) {
                    this._appendAttemptRecord(job.id, {
                        attempt: attempts, movementId: movement.id,
                        requestAt: sendStartedAt, responseAt: sendResponseAt,
                        sendRttMs: sendResponseAt - sendStartedAt,
                        arrivalAt: movement.arrivalAt, deviationMs: timing.deviationMs, result: 'MANTIDO'
                    });
                    const confirmedIds = new Set(this._state.confirmedIds);
                    confirmedIds.add(job.id);
                    this._state.confirmedIds = [...confirmedIds].slice(-1_000);
                    const fprs = new Set(this._state.confirmedFingerprints);
                    fprs.add(job.fingerprint || this._commandFingerprint(job.command));
                    this._state.confirmedFingerprints = [...fprs].slice(-1_000);
                    this._updateJob(job.id, { status: 'confirmed', error: '' });
                    try {
                        uw.$?.Observer?.(uw.GameEvents?.command?.send_unit)?.publish?.({
                            sending_type: job.command.canonicalType,
                            target_id: this._integer(job.command.targetTownId),
                            params: this._buildSendPayload(job.command)
                        });
                    } catch (e) {}
                    this._log('info', `Comando confirmado (${job.id}, tentativa ${attempts}).`);
                    break;
                }

                let cancellation = null;
                try {
                    cancellation = await this._cancelAttempt(job, movement);
                } catch (e) {
                    this._appendAttemptRecord(job.id, {
                        attempt: attempts, movementId: movement.id,
                        requestAt: sendStartedAt, responseAt: sendResponseAt,
                        sendRttMs: sendResponseAt - sendStartedAt,
                        arrivalAt: movement.arrivalAt, deviationMs: timing.deviationMs, result: 'CANCELAMENTO-FALHOU'
                    });
                    throw e;
                }
                this._appendAttemptRecord(job.id, {
                    attempt: attempts, movementId: movement.id,
                    requestAt: sendStartedAt, responseAt: sendResponseAt,
                    sendRttMs: sendResponseAt - sendStartedAt,
                    arrivalAt: movement.arrivalAt, deviationMs: timing.deviationMs,
                    cancelRttMs: cancellation.cancelRttMs, result: 'CANCELADO'
                });
                this._updateJob(job.id, { ...cancellation, lastMovementCancelRttMs: cancellation.cancelRttMs });

                const calibratedAt = this._calibratedAttemptAt(sendStartedAt, timing.deviationMs, job.toleranceSeconds);
                this._updateJob(job.id, { calibratedAt, error: '' });
                this._log('info', `Calibração aplicada (${job.id}) · desvio ${timing.deviationMs}ms · tolerância ${job.toleranceSeconds}s`);
                await this._delay(this.CONFIG.spamGapMs);
            }
            if ((this._stopRequested || !this._state.armed) && this._state.jobs[job.id]?.status === 'sending') {
                this._updateJob(job.id, { status: 'cancelled', error: 'manual-disarm' });
            }
        } catch (e) {
            this._updateJob(job.id, { status: 'failed', error: e.message || 'retry-loop-failed' });
            this._log('error', `Ciclo interrompido (${job.id}): ${e.message}`);
        } finally {
            this._activeSends = Math.max(0, this._activeSends - 1);
            this._finishIfDone();
            try { const $s = uw.$('#gcp_status'); if ($s.length) $s.html(this._buildStatusHtml()); } catch (e) {}
        }
    }

    _finishIfDone() {
        const jobs = Object.values(this._state.jobs);
        if (!this._state.armed || !jobs.length || jobs.some((j) => !this._isTerminal(j))) return;
        this._state.armed = false;
        this._persist();
        const failed = jobs.filter((j) => j.status === 'failed');
        if (failed.length) {
            this._log('warn', `Colagem terminou com ${failed.length} falha(s).`);
            this._notify(`Colagem terminou com ${failed.length} falha(s). Reveja o Planeador.`);
        } else {
            this._log('info', 'Colagem concluída (sem pendentes).');
            this._notify('Colagem concluída.', 'success');
        }
    }

    async _syncPlans() {
        if (!this._state?.armed || !this._ownsLease()) return;
        try {
            const commands = await this._fetchPlannedCommands();
            this._state.jobs = this._reconcileCapturedJobs({
                jobs: this._state.jobs,
                capturedIds: this._state.capturedIds,
                commands,
                offsets: this._state.settings,
                now: this._serverNowMs()
            });
            this._persist();
            this._finishIfDone();
        } catch (e) {
            this._log('warn', `Sync do Planeador falhou: ${e.message}`);
        }
    }

    async _arm() {
        if (this._state?.armed) return;
        if (this._activeSends > 0) { this._notify('Aguarde: cancelamento em curso.'); return; }
        try {
            this._stopRequested = false;
            await this._synchronizeServerClock();
            const commands = await this._fetchPlannedCommands();
            const confirmed = new Set(this._state.confirmedFingerprints);
            const captured = commands.filter((c) => !confirmed.has(this._commandFingerprint(c)));
            this._state.capturedIds = captured.map((c) => c.id);
            this._state.jobs = this._reconcileCapturedJobs({
                jobs: {}, capturedIds: this._state.capturedIds, commands,
                offsets: this._state.settings, now: this._serverNowMs()
            });
            const pending = Object.values(this._state.jobs).filter((j) => !this._isTerminal(j));
            this._state.armed = pending.length > 0;
            this._persist();
            if (!this._state.armed) { this._notify('Nenhum comando pendente no Planeador.'); return; }
            this._acquireLease();
            this._log('info', `Colagem armada: ${pending.length} comando(s).`);
            this._notify(`Colagem armada: ${pending.length} comando(s).`, 'success');
            this._scheduleTick(0);
        } catch (e) {
            this._log('error', `Não foi possível armar: ${e.message}`);
            this._notify(`Falha ao armar: ${e.message}`);
        }
    }

    _disarm() {
        if (!this._state?.armed) return;
        this._stopRequested = true;
        this._state.armed = false;
        for (const job of Object.values(this._state.jobs)) {
            if (!this._isTerminal(job)) {
                if (job.status === 'sending') job.error = 'manual-stop-requested';
                else { job.status = 'cancelled'; job.error = 'manual-disarm'; }
            }
        }
        this._persist();
        this._log('info', 'Colagem desarmada manualmente.');
    }

    _nextDelay(now) {
        const active = Object.values(this._state.jobs).filter((j) => !this._isTerminal(j));
        if (!active.length) return 1_000;
        const nearest = Math.min(...active.map((j) => (
            j.status === 'ready' ? this._number(j.releaseAt, j.dispatchAt) : j.dispatchAt - this.CONFIG.preflightLeadMs
        )));
        const remaining = nearest - now;
        if (remaining <= 2_000) return 10;
        if (remaining <= 15_000) return 50;
        return 250;
    }

    _scheduleTick(delay) {
        clearTimeout(this._tickTimer);
        this._tickTimer = setTimeout(() => this._tick(), delay);
    }

    _tick() {
        if (this._stopped || !this._state?.armed) return this._scheduleTick(1_000);
        this._renewLease();
        if (!this._ownsLease()) return this._scheduleTick(250);
        const now = this._serverNowMs();
        const jobs = Object.values(this._state.jobs).sort((a, b) => a.dispatchAt - b.dispatchAt);
        for (const job of jobs) {
            if (this._isTerminal(job) || job.status === 'sending' || job.status === 'preflight') continue;
            if (now >= job.dispatchAt + this.CONFIG.timingCorrectionWindowMs) {
                this._updateJob(job.id, { status: 'expired', error: 'dispatch-time-passed' });
                continue;
            }
            if (job.status === 'pending' && now >= job.dispatchAt - this.CONFIG.preflightLeadMs) {
                void this._preflightJob(job);
            } else if (job.status === 'ready' && now >= job.releaseAt && this._activeSends < this.CONFIG.maximumParallel) {
                void this._sendJob(job);
            }
        }
        this._finishIfDone();
        this._scheduleTick(this._nextDelay(now));
    }

    // ══════════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════════

    _initialize() {
        const worldId = String(uw.Game?.world_id || location.hostname.split('.')[0] || 'world');
        const playerId = String(uw.Game?.player_id || 'player');
        this._namespace = `${worldId}:${playerId}`;
        this._storageKey = `gcp:state:${this._namespace}`;
        this._leaseKey = `gcp:lease:${this._namespace}`;

        this._state = this._loadState();
        this._ready = true;
        this._acquireLease();

        this._leaseTimer = setInterval(() => this._renewLease(), this.CONFIG.leaseHeartbeatMs);
        this._refreshTimer = setInterval(() => void this._syncPlans(), this.CONFIG.plannerRefreshMs);

        if (this._state.armed) void this._syncPlans();
        this._scheduleTick(50);

        this.console.log(`${this.PREFIX} v${this.VERSION} pronto (${this._namespace}).`);
    }
};