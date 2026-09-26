// ══════════════════════════════════════════════════════
//  MODULE: AutoDodge v2.0.1
//  Engine portada do "Grepolis Dodge Silencioso" (Kelsiito)
//  integrada ao MultBot (settings, toggle, console).
//
//  v2.0.1 — Boot agora fiel ao original 1.3.5:
//   • waitForBindings (poll 250ms, até 30s) ANTES de tudo
//   • restoreJobs() só depois das bindings prontas
//     (corrige jobs que ficavam 'blocked' após reload)
//   • Logs da consola com detalhes JSON como o original
//
//  O que faz:
//   • Detecta ataques entrantes via MovementsUnits (scan 1s + heartbeat 50ms)
//   • Escolhe cidade de destino na MESMA ilha lendo /data/towns.txt
//   • Envia apoio para voltar EXATAMENTE após o último ataque (dodge)
//     ou EXATAMENTE antes do NC (snipe)
//   • Cancelamento calculado no MEIO do caminho:
//     cancelAt = sentAt + (desiredReturnAt - sentAt) / 2
//   • Detecta NC por duração de viagem com modificadores de velocidade
//   • Ativa milícia ~1s antes do impacto
//   • Purifica Narcisismo automaticamente (se tiver Artemis + favor)
//   • Persiste jobs no storage — sobrevive a reloads
//   • Lock entre abas: só uma aba controla
// ══════════════════════════════════════════════════════
var AutoDodge = class extends MultUtil {
    VERSION = '2.0.1';

    CONFIG = Object.freeze({
        enabled: true,
        returnOffsetMs: 1_000,
        ncReturnOffsetMs: -100,
        ncFallbackReturnOffsetMs: -1_000,
        ncHighPrecisionUncertaintyMs: 75,
        ncDurationToleranceMs: 11_000,
        ncBaseTravelSeconds: 900,
        ncDistanceFactor: 50,
        ncSpeedModifiers: null,
        militiaLeadMs: 1_000,
        militiaLatencySafetyMs: 100,
        militiaActiveMs: 3 * 60 * 60_000,
        purificationScanIntervalMs: 100,
        purificationFavorCost: 200,
        waveGapSeconds: 300,
        sendLeadSeconds: 30,
        minimumSendLeadSeconds: 5,
        destinationTravelMarginSeconds: 5,
        cancellationWindowSeconds: 600,
        cancellationSafetySeconds: 2,
        scanIntervalMs: 1_000,
        heartbeatIntervalMs: 50,
        ajaxTimeoutMs: 12_000,
        commandResolveTimeoutMs: 12_000,
        mapCacheMs: 30 * 60_000,
        maxDestinationPreviews: 20,
        maximumRttMs: 2_000,
        maximumTimerSlipMs: 500,
        lockTtlMs: 10_000,
        logLimit: 100,
    });

    STORAGE_KEY = 'gd.runtime.v2';
    LOCK_KEY = 'gd.tab-lock.v2';
    MAP_KEY = 'gd.world-towns.v2';
    PREFIX = '[AutoDodge]';

    // ── MultBot state ──
    _active = false;
    _starting = false;    // boot em curso (a aguardar bindings)
    _wantActive = false;  // intenção do utilizador (sobrevive ao boot assíncrono)
    _restored = false;    // restoreJobs só corre uma vez, após bindings prontas
    _scanTimer = null;
    _heartbeatTimer = null;
    _lastStatusUpdate = 0;

    // ── Advanced engine state ──
    _ownerId = null;
    _busy = false;
    _latencyMs = 100;
    _latencySamples = [];
    _lastHeartbeatAt = 0;
    _serverClockState = {};
    _worldTownsCache = null;
    _lastPurificationScanAt = 0;
    _jobs = new Map();
    _militiaJobs = new Map();
    _purificationJobs = new Map();

    constructor(c, s) {
        super(c, s);
        this._ownerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        // NOTA: restoreJobs() NÃO corre aqui — no original só corre no boot,
        // depois das bindings estarem prontas. Correr aqui marcava os jobs
        // agendados como 'blocked' porque uw.MM ainda não existia.
        if (this.storage.load('dodge_active', false)) {
            setTimeout(() => this.start(), 2000);
        }
    }

    // ═══════════════════════════════════════════════════
    //  UI / LIFECYCLE
    // ═══════════════════════════════════════════════════

    settings = () => {
        requestAnimationFrame(() => this._updateTitle());
        return (
            '<div class="game_border" style="margin-bottom:20px;">' +
            '<div class="game_border_top"></div><div class="game_border_bottom"></div>' +
            '<div class="game_border_left"></div><div class="game_border_right"></div>' +
            '<div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
            '<div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
            this.getTitleHtml('dodge_title', 'Auto Dodge v2', this.toggle, '', this._active) +
            '<div style="padding:5px 10px;font-weight:bold;font-size:11px;">' +
            'Dodge preciso + snipe de NC + milícia + purificação automática.' +
            '</div>' +
            '<div style="padding:0 10px 4px;font-size:11px;color:#5a3a0a;">' +
            'Envia apoio para voltar no <b>meio exato do caminho</b>. Offset: +1s pós-ataque / -0,1s pré-NC.' +
            '</div>' +
            '<div id="dodge_status" style="padding:0 10px 6px;font-size:11px;color:#5a3a0a;">' +
            this._buildStatusHtml() +
            '</div>' +
            '<div id="dodge_log" style="padding:2px 10px 8px;font-size:11px;color:#5a3a0a;min-height:16px;"></div>' +
            '</div>'
        );
    };

    toggle = () => {
        if (this._active || this._starting) this.stop();
        else this.start();
    };

    start() {
        if (this._active || this._starting) return;
        this._wantActive = true;
        this._starting = true;
        this._boot().catch((e) => {
            this._starting = false;
            this._log('error', `boot: ${e?.message ?? e}`);
        });
    }

    // Boot fiel ao original 1.3.5: waitForBindings → restoreJobs → start
    async _boot() {
        const ready = await this._waitForBindings(30_000);
        this._starting = false;
        if (!this._wantActive) return; // utilizador parou durante o arranque
        if (!ready) {
            this._wantActive = false;
            this.storage.save('dodge_active', false);
            this._log('error', 'APIs internas do Grepolis não ficaram disponíveis; módulo parado.');
            return;
        }
        if (!this._restored) {
            this._restored = true;
            this._restoreJobs();
        }
        this._active = true;
        this.storage.save('dodge_active', true);
        this._updateTitle();
        this._log('info', `AutoDodge v${this.VERSION} iniciado.`);

        clearInterval(this._scanTimer);
        clearInterval(this._heartbeatTimer);
        this._lastHeartbeatAt = performance.now();

        this._scanTimer = setInterval(
            () => this._scan().catch((e) => this._log('error', `scan: ${e?.message ?? e}`)),
            this.CONFIG.scanIntervalMs
        );
        this._heartbeatTimer = setInterval(
            () => this._heartbeat().catch((e) => this._log('error', `heartbeat: ${e?.message ?? e}`)),
            this.CONFIG.heartbeatIntervalMs
        );

        this._scan().catch(() => {});
    }

    // Poll silencioso a cada 250ms, até 30s — como o waitForBindings original
    _waitForBindings(timeoutMs = 30_000) {
        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const check = () => {
                if (this._bindingsReady()) return resolve(true);
                if (!this._wantActive || Date.now() >= deadline) return resolve(false);
                setTimeout(check, 250);
            };
            check();
        });
    }

    stop() {
        this._wantActive = false;
        this._starting = false;
        this._active = false;
        this.storage.save('dodge_active', false);
        clearInterval(this._scanTimer);
        clearInterval(this._heartbeatTimer);
        this._scanTimer = null;
        this._heartbeatTimer = null;
        this._updateTitle();
        this._log('warn', 'AutoDodge parado.');
    }

    _bindingsReady() {
        return Boolean(uw.gpAjax && uw.ITowns && uw.MM && uw.Timestamp);
    }

    _updateTitle() {
        const filter = this._active ? 'brightness(100%) saturate(186%) hue-rotate(241deg)' : '';
        try { uw.$('#dodge_title').css('filter', filter); } catch (e) {}
    }

    _buildStatusHtml() {
        const jobs = [...this._jobs.values()].filter((j) => ['scheduled', 'cancelling', 'done'].includes(j.stage));
        const militia = [...this._militiaJobs.values()].filter((j) => ['scheduled', 'activating', 'active'].includes(j.stage));
        const purif = [...this._purificationJobs.values()].filter((j) => ['scheduled', 'casting', 'done'].includes(j.stage));
        return (
            `Latência: <b>${Math.round(this._latencyMs)} ms</b> · ` +
            `Apoios: <b>${jobs.length}</b> · ` +
            `Milícias: <b>${militia.length}</b> · ` +
            `Purificações: <b>${purif.length}</b>`
        );
    }

    _refreshSettingsStatus() {
        if (this._lastStatusUpdate && Date.now() - this._lastStatusUpdate < 400) return;
        this._lastStatusUpdate = Date.now();
        try {
            const $s = uw.$('#dodge_status');
            if ($s.length) $s.html(this._buildStatusHtml());
        } catch (e) {}
    }

    // ═══════════════════════════════════════════════════
    //  LOG
    // ═══════════════════════════════════════════════════

    _log(level, message, details = {}) {
        const icon = level === 'error' ? '✗' : level === 'warn' ? '⚠' : '·';
        let diagnostic = '';
        try {
            diagnostic = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
        } catch (e) { diagnostic = ' {"error":"details-unserializable"}'; }
        this.console.log(`${this.PREFIX} ${icon} ${message}${diagnostic}`);

        try {
            const $log = uw.$('#dodge_log');
            if ($log.length) {
                const color = level === 'error' ? '#f87171' : level === 'warn' ? '#eab308' : '#1a6b2a';
                $log.text(message).css('color', color);
            }
        } catch (e) {}

        // Mantém os últimos logs em memória pra debug rápido
        try {
            const history = this.storage.load('dodge_logs', []);
            history.unshift({ at: Date.now(), level, message, details });
            this.storage.save('dodge_logs', history.slice(0, this.CONFIG.logLimit));
        } catch (e) {}
    }

    // ═══════════════════════════════════════════════════
    //  HELPERS NUMÉRICOS / TEMPO (Core portado)
    // ═══════════════════════════════════════════════════

    _number(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    _integer(value, fallback = 0) {
        return Math.max(0, Math.floor(this._number(value, fallback)));
    }

    _timestampMs(value) {
        const parsed = this._number(value);
        if (!parsed) return 0;
        return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
    }

    _timestampHasMilliseconds(value) {
        const parsed = this._number(value, Number.NaN);
        if (!Number.isFinite(parsed)) return false;
        return parsed >= 10_000_000_000 || !Number.isInteger(parsed);
    }

    _calibratedServerTime(rawServer, perfNow) {
        const state = this._serverClockState || {};
        if (this._timestampHasMilliseconds(rawServer)) {
            const now = this._timestampMs(rawServer);
            this._serverClockState = state;
            return now;
        }
        const second = this._integer(rawServer);
        if (!second) {
            this._serverClockState = state;
            return 0;
        }
        const changed = second !== state.second;
        const jumped = state.second && Math.abs(second - state.second) > 2;
        const next = (changed || jumped || !state.epochMs)
            ? { second, epochMs: second * 1_000, perfMs: this._number(perfNow) }
            : state;
        this._serverClockState = next;
        return next.epochMs + Math.max(0, this._number(perfNow) - next.perfMs);
    }

    _read(source, names, fallback = '') {
        const attributes = source?.attributes || source || {};
        for (const name of names) {
            const value = attributes[name] ?? source?.[name];
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return fallback;
    }

    _canonicalType(value) {
        const text = String(value || '').toLowerCase();
        if (/spy|espion/.test(text)) return 'spy';
        if (/support|apoio|refor/.test(text)) return 'support';
        if (/attack|ataque|revolt|colon/.test(text)) return 'attack';
        return 'unknown';
    }

    _normalizeMovement(raw, now = Date.now()) {
        const rawAttributes = raw?.attributes || raw || {};
        const rawType = String(this._read(raw, ['command_type', 'type', 'movement_type', 'attack_type', 'name']));
        const type = this._canonicalType(rawType);
        const id = String(this._read(raw, ['command_id', 'id', 'model_id'], ''));
        const rawStarted = this._read(raw, ['started_at', 'start_at', 'created_at', 'startedAt', 'start_time']);
        const startedAt = this._timestampMs(rawStarted);
        const rawArrival = this._read(raw, [
            'arrival_at_ms', 'arrival_time_ms', 'arrival_at', 'arrivalAt',
            'arrival_time', 'finished_at', 'end_at'
        ]);
        const arrivalAt = this._timestampMs(rawArrival);
        const homeTownId = String(this._read(raw, ['home_town_id', 'homeTownId'], ''));
        const targetTownId = String(this._read(raw, [
            'target_town_id', 'targetTownId', 'destination_town_id', 'town_id'
        ], ''));
        const direction = String(this._read(raw, ['direction', 'movement_direction', 'status'], '')).toLowerCase();
        const returning = Boolean(this._read(raw, ['is_returning', 'returning', 'is_return'], false))
            || /return|regress/.test(direction)
            || Boolean(homeTownId && targetTownId && homeTownId === targetTownId);
        return {
            id, type, rawType,
            originTownId: String(this._read(raw, ['origin_town_id', 'home_town_id', 'originTownId', 'source_town_id'], '')),
            targetTownId,
            playerId: String(this._read(raw, ['player_id', 'origin_player_id', 'home_player_id'], '')),
            startedAt,
            startedHasMilliseconds: this._timestampHasMilliseconds(rawStarted),
            arrivalAt: arrivalAt || now,
            arrivalHasMilliseconds: this._timestampHasMilliseconds(rawArrival),
            returning,
            raw: { ...rawAttributes }
        };
    }

    _groupAttackWaves(attacks, gapSeconds = this.CONFIG.waveGapSeconds) {
        const gapMs = Math.max(0, this._number(gapSeconds)) * 1_000;
        const groups = [];
        const byTown = new Map();
        [...attacks].sort((a, b) => a.arrivalAt - b.arrivalAt).forEach((attack) => {
            const key = String(attack.targetTownId);
            const townGroups = byTown.get(key) || [];
            const current = townGroups.at(-1);
            if (!current || attack.arrivalAt - current.lastArrivalAt > gapMs) {
                const next = {
                    id: `town:${key}:${attack.id || attack.arrivalAt}`,
                    targetTownId: key,
                    firstArrivalAt: attack.arrivalAt,
                    lastArrivalAt: attack.arrivalAt,
                    commandIds: [String(attack.id)],
                    attacks: [attack],
                    ncArrivalAt: attack.nc?.isNc ? attack.arrivalAt : 0,
                    ncConfidence: attack.nc?.isNc ? attack.nc.confidence : ''
                };
                townGroups.push(next);
                groups.push(next);
            } else {
                current.lastArrivalAt = Math.max(current.lastArrivalAt, attack.arrivalAt);
                current.commandIds.push(String(attack.id));
                current.attacks.push(attack);
                if (attack.nc?.isNc && (!current.ncArrivalAt || attack.arrivalAt < current.ncArrivalAt)) {
                    current.ncArrivalAt = attack.arrivalAt;
                    current.ncConfidence = attack.nc.confidence;
                }
            }
            byTown.set(key, townGroups);
        });
        return groups;
    }

    _calculateCancelAt(sentAt, lastAttackArrivalAt, returnOffsetMs = 1_000) {
        const desiredReturnAt = this._number(lastAttackArrivalAt) + this._number(returnOffsetMs);
        return this._number(sentAt) + (desiredReturnAt - this._number(sentAt)) / 2;
    }

    _chooseSentAt(movement, sentAtEstimate) {
        return movement?.startedAt && movement?.startedHasMilliseconds
            ? movement.startedAt
            : this._number(sentAtEstimate);
    }

    _buildNcSpeedModifiers({ maxSirens = 50 } = {}) {
        const bonuses = [0.10, 0.15, 0.25, 0.30];
        const modifiers = new Set();
        const combinations = 1 << bonuses.length;
        for (let mask = 0; mask < combinations; mask += 1) {
            const selected = bonuses.filter((_, i) => mask & (1 << i));
            const additiveBase = 1 + selected.reduce((s, b) => s + b, 0);
            const multiplicativeBase = selected.reduce((p, b) => p * (1 + b), 1);
            for (let sirens = 0; sirens <= Math.max(0, this._integer(maxSirens)); sirens += 1) {
                const sirenBonus = Math.min(1, sirens * 0.02);
                modifiers.add(Number((additiveBase + sirenBonus).toFixed(6)));
                modifiers.add(Number((multiplicativeBase * (1 + sirenBonus)).toFixed(6)));
            }
        }
        return [...modifiers].sort((a, b) => a - b);
    }

    _calculateNcDurations({ distance, unitSpeed = 1, colonySpeed = 3, modifiers = this.CONFIG.ncSpeedModifiers } = {}) {
        const safeDistance = Math.max(0, this._number(distance));
        const safeWorldSpeed = Math.max(0.01, this._number(unitSpeed, 1));
        const safeColonySpeed = Math.max(0.01, this._number(colonySpeed, 3));
        const profiles = Array.isArray(modifiers) && modifiers.length ? modifiers : this._buildNcSpeedModifiers();
        return [...new Set(profiles.map((modifier) => Math.round((
            this.CONFIG.ncBaseTravelSeconds
            + safeDistance * this.CONFIG.ncDistanceFactor / (safeColonySpeed * Math.max(0.01, this._number(modifier, 1)))
        ) * 1_000 / safeWorldSpeed)))];
    }

    _classifyNcAttack(movement, { expectedDurations = [], revoltActive = false, toleranceMs = this.CONFIG.ncDurationToleranceMs } = {}) {
        let rawText = '';
        try { rawText = JSON.stringify(movement?.raw || {}).toLowerCase(); }
        catch { rawText = String(movement?.rawType || '').toLowerCase(); }
        const explicit = /colonize_ship|colony_ship|coloniz|colonis|takeover|conquer|conquest/.test(
            `${movement?.rawType || ''} ${rawText}`
        );
        if (explicit) return { isNc: true, confidence: 'explicit', deltaMs: 0 };
        const duration = this._number(movement?.arrivalAt) - this._number(movement?.startedAt);
        if (!movement?.startedAt || duration <= 0 || !expectedDurations.length) {
            return { isNc: false, confidence: 'insufficient-data', deltaMs: null };
        }
        const deltaMs = Math.min(...expectedDurations.map((expected) => Math.abs(duration - expected)));
        if (deltaMs <= Math.max(0, this._number(toleranceMs))) {
            return { isNc: true, confidence: revoltActive ? 'high' : 'timing-match', deltaMs };
        }
        return { isNc: false, confidence: 'no-match', deltaMs };
    }

    _chooseReturnOffset({ nc = false, hasMilliseconds = false, uncertaintyMs = Infinity } = {}) {
        if (!nc) return this.CONFIG.returnOffsetMs;
        return hasMilliseconds && this._number(uncertaintyMs, Infinity) <= this.CONFIG.ncHighPrecisionUncertaintyMs
            ? this.CONFIG.ncReturnOffsetMs
            : this.CONFIG.ncFallbackReturnOffsetMs;
    }

    _parseDurationMs(value) {
        if (typeof value === 'string') {
            const match = value.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
            if (match) {
                return (this._integer(match[1]) * 3_600 + this._integer(match[2]) * 60 + this._integer(match[3])) * 1_000;
            }
        }
        const parsed = this._number(value, Number.NaN);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return parsed < 1_000_000 ? parsed * 1_000 : parsed;
    }

    _extractTravelDurationMs(value) {
        let best = null;
        const visited = new Set();
        const visit = (candidate, path = '', depth = 0) => {
            if (candidate === null || candidate === undefined || depth > 7) return;
            if (typeof candidate !== 'object') {
                if (/duration|travel|runtime|time_to_target/i.test(path)) {
                    const duration = this._parseDurationMs(candidate);
                    if (duration && (!best || duration < best)) best = duration;
                }
                return;
            }
            if (visited.has(candidate)) return;
            visited.add(candidate);
            Object.entries(candidate).forEach(([key, child]) => visit(child, `${path}.${key}`, depth + 1));
        };
        visit(value);
        return best;
    }

    _parseWorldTowns(text) {
        return String(text || '').split(/\r?\n/).map((line) => {
            const parts = line.split(',');
            if (parts.length < 7) return null;
            const decode = (value) => {
                try { return decodeURIComponent(String(value || '').replace(/\+/g, ' ')); }
                catch { return String(value || ''); }
            };
            const id = String(this._integer(parts[0]));
            if (id === '0') return null;
            return {
                id,
                playerId: String(this._integer(parts[1])),
                name: decode(parts[2]),
                islandX: this._integer(parts[3]),
                islandY: this._integer(parts[4]),
                islandSlot: this._integer(parts[5]),
                points: this._integer(parts[6])
            };
        }).filter(Boolean);
    }

    _sameIsland(town, islandX, islandY) {
        return this._number(town?.islandX) === this._number(islandX)
            && this._number(town?.islandY) === this._number(islandY);
    }

    _sortDestinations(towns, origin) {
        const slot = this._number(origin?.islandSlot);
        return [...towns]
            .filter((town) => town.id !== String(origin?.id))
            .sort((left, right) => (
                Math.abs(this._number(left.islandSlot) - slot) - Math.abs(this._number(right.islandSlot) - slot)
                || left.id.localeCompare(right.id)
            ));
    }

    _buildSupportUnits(preview) {
        const units = preview?.json?.units || preview?.units || {};
        const output = {};
        for (const [name, record] of Object.entries(units)) {
            if (name === 'militia') continue;
            const count = this._integer(record?.count ?? record?.amount ?? record);
            if (count > 0) output[name] = count;
        }
        return output;
    }

    _buildSupportPayload(sourceTownId, targetTownId, units) {
        return {
            id: this._integer(targetTownId),
            type: 'support',
            town_id: this._integer(sourceTownId),
            nl_init: true,
            ...units
        };
    }

    _extractSupportCapacity(value) {
        const strings = [];
        const visited = new Set();
        const visit = (candidate, depth = 0) => {
            if (candidate === null || candidate === undefined || depth > 8) return;
            if (typeof candidate === 'string') {
                strings.push(candidate.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' '));
                return;
            }
            if (typeof candidate !== 'object' || visited.has(candidate)) return;
            visited.add(candidate);
            Object.values(candidate).forEach((child) => visit(child, depth + 1));
        };
        visit(value);
        const text = strings.join(' ').replace(/\s+/g, ' ');
        const match = text.match(/(?:capacidade|capacity)\s*:?\s*(\d+)\s*\/\s*(\d+)/i);
        return match
            ? { requiredCapacity: this._integer(match[1]), availableCapacity: this._integer(match[2]) }
            : null;
    }

    _planSupportCommands(units, unitCatalog = {}, serverCapacity = null) {
        const navalNames = /^(big_transporter|small_transporter|bireme|attack_ship|demolition_ship|trireme|colonize_ship|transport_boat|fast_transport_ship|light_ship|fire_ship)$/;
        const land = {};
        const naval = {};
        let requiredCapacity = 0;
        let availableCapacity = 0;
        for (const [name, count] of Object.entries(units || {})) {
            const data = unitCatalog?.[name] || {};
            const navalUnit = Boolean(data.is_naval || data.isNaval)
                || /naval|ship/.test(String(data.type || data.unit_type || '').toLowerCase())
                || navalNames.test(name);
            if (navalUnit) {
                naval[name] = count;
                availableCapacity += this._integer(count) * this._number(data.capacity, 0);
            } else {
                land[name] = count;
                requiredCapacity += this._integer(count) * Math.max(1, this._number(data.population, 1));
            }
        }
        if (serverCapacity
            && Number.isFinite(Number(serverCapacity.requiredCapacity))
            && Number.isFinite(Number(serverCapacity.availableCapacity))) {
            requiredCapacity = this._integer(serverCapacity.requiredCapacity);
            availableCapacity = this._integer(serverCapacity.availableCapacity);
        }
        const split = requiredCapacity > availableCapacity
            && Object.keys(land).length > 0
            && Object.keys(naval).length > 0;
        return split
            ? { split: true, requiredCapacity, availableCapacity,
                plans: [{ kind: 'land', units: land }, { kind: 'naval', units: naval }] }
            : { split: false, requiredCapacity, availableCapacity,
                plans: [{ kind: 'mixed', units: { ...units } }] };
    }

    _supportDestinationUnavailable(value) {
        const visited = new Set();
        const unavailableKey = /^(vacation_mode|vacation|in_vacation|player_in_vacation|vacation_protection|is_on_vacation)$/i;
        const unavailableText = /(vacation[_ -]?mode|vacation protection|player.{0,40}(?:is|in).{0,20}vacation|modo de f[eé]rias|protec[cç][aã]o de f[eé]rias)/i;
        const inspect = (candidate, depth = 0) => {
            if (candidate === null || candidate === undefined || depth > 8) return false;
            if (typeof candidate === 'string') return unavailableText.test(candidate);
            if (typeof candidate !== 'object' || visited.has(candidate)) return false;
            visited.add(candidate);
            return Object.entries(candidate).some(([key, child]) => {
                if (unavailableKey.test(key) && (child === true || child === 1 || child === '1')) return true;
                return inspect(child, depth + 1);
            });
        };
        return inspect(value);
    }

    _cancellationFeasibility({ sentAt, cancelAt, outboundArrivalAt, config = this.CONFIG }) {
        const cancelElapsed = cancelAt - sentAt;
        if (cancelElapsed <= 0) return { allowed: false, reason: 'cancel-in-past' };
        if (cancelElapsed >= (config.cancellationWindowSeconds - config.cancellationSafetySeconds) * 1_000) {
            return { allowed: false, reason: 'cancel-window' };
        }
        if (outboundArrivalAt - cancelAt <= config.destinationTravelMarginSeconds * 1_000) {
            return { allowed: false, reason: 'travel-too-short' };
        }
        return { allowed: true, reason: 'allowed' };
    }

    _normalizeToken(value) {
        return String(value || '').toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
    }

    _isNarcissismPower(value) { return /(^|_)(narcissism|narcisismo)(_|$)/.test(this._normalizeToken(value)); }
    _isCityProtectionPower(value) { return /(^|_)(town_protection|city_protection|protection|protecao)(_|$)/.test(this._normalizeToken(value)); }

    _purificationDecision({ narcissism, protectedCity, artemisTownId, favor, cost = 200, handled = false } = {}) {
        if (!narcissism) return { allowed: false, reason: 'no-narcissism' };
        if (handled) return { allowed: false, reason: 'already-handled' };
        if (protectedCity) return { allowed: false, reason: 'city-protected' };
        if (!artemisTownId) return { allowed: false, reason: 'artemis-unavailable' };
        if (!Number.isFinite(Number(favor))) return { allowed: false, reason: 'favor-unknown' };
        if (Number(favor) < Number(cost)) return { allowed: false, reason: 'insufficient-favor' };
        return { allowed: true, reason: 'allowed' };
    }

    // ═══════════════════════════════════════════════════
    //  PAGE DATA
    // ═══════════════════════════════════════════════════

    _serverNowMs() {
        try {
            const calibrated = this._calibratedServerTime(uw.Timestamp?.server?.(), performance.now());
            if (calibrated) return calibrated;
        } catch (e) {}
        return Date.now();
    }

    _serverClockHasMilliseconds() {
        try { return this._timestampHasMilliseconds(uw.Timestamp?.server?.()); }
        catch { return false; }
    }

    _modelAttributes(model) {
        if (!model) return null;
        if (model.attributes) return model;
        if (typeof model.toJSON === 'function') return { id: model.id, attributes: model.toJSON() };
        return model;
    }

    _movementModels() {
        try {
            const direct = uw.MM?.getModels?.()?.MovementsUnits;
            if (direct && typeof direct === 'object') return Object.values(direct).map((m) => this._modelAttributes(m));
            return (uw.MM?.getOnlyCollectionByName?.('MovementsUnits')?.models || []).map((m) => this._modelAttributes(m));
        } catch { return []; }
    }

    _movements() {
        const now = this._serverNowMs();
        return this._movementModels().map((m) => this._normalizeMovement(m, now));
    }

    _ownTowns() {
        const values = uw.ITowns?.getTowns?.() || uw.ITowns?.towns || {};
        return Object.entries(values).map(([fallbackId, town]) => ({
            id: String(town?.getId?.() ?? town?.id ?? fallbackId),
            name: String(town?.getName?.() ?? town?.attributes?.name ?? fallbackId),
            islandX: this._integer(town?.getIslandCoordinateX?.() ?? town?.attributes?.island_x),
            islandY: this._integer(town?.getIslandCoordinateY?.() ?? town?.attributes?.island_y),
            islandSlot: this._integer(town?.getIslandNumber?.() ?? town?.attributes?.island_number),
            model: town
        })).filter((t) => t.id && t.islandX && t.islandY);
    }

    _townGod(town) {
        return this._normalizeToken(town?.model?.getGod?.() ?? town?.model?.attributes?.god ?? town?.model?.god);
    }

    _castedPower(town, aliases) {
        for (const alias of aliases) {
            try {
                const power = town?.model?.getCastedPower?.(alias);
                if (power) return power;
            } catch (e) {}
        }
        const values = town?.model?.getCastedPowers?.()
            ?? town?.model?.attributes?.casted_powers
            ?? town?.model?.attributes?.powers
            ?? [];
        const entries = Array.isArray(values) ? values : Object.entries(values || {}).map(([id, v]) => ({ id, ...(v || {}) }));
        return entries.find((power) => {
            const id = this._read(power, ['power_id', 'power', 'id', 'name'], '');
            return aliases.some((alias) => this._normalizeToken(id) === this._normalizeToken(alias));
        }) || null;
    }

    _narcissismInTown(town) { return this._castedPower(town, ['narcissism', 'narcisismo']); }
    _protectionInTown(town) { return this._castedPower(town, ['town_protection', 'city_protection', 'protection', 'protecao']); }

    _artemisFavor() {
        const candidates = [];
        try {
            const gods = uw.ITowns?.getGods?.() ?? uw.ITowns?.gods;
            candidates.push(gods?.artemis?.favor, gods?.artemis?.attributes?.favor);
        } catch (e) {}
        try {
            const models = uw.MM?.getModels?.() || {};
            Object.entries(models).forEach(([name, collection]) => {
                if (!/god|favor/i.test(name)) return;
                const values = Array.isArray(collection) ? collection : Object.values(collection || {});
                values.forEach((model) => {
                    const raw = model?.attributes || model || {};
                    if (this._normalizeToken(this._read(raw, ['god_id', 'god', 'id'], '')) === 'artemis') {
                        candidates.push(this._read(raw, ['favor', 'current_favor', 'value'], Number.NaN));
                    }
                });
            });
        } catch (e) {}
        const favor = candidates.map(Number).find(Number.isFinite);
        return favor === undefined ? Number.NaN : favor;
    }

    _purificationCost() {
        const powers = uw.GameData?.powers || {};
        const entry = powers.cleanse || powers.purification
            || Object.entries(powers).find(([id, p]) => /purification|purificacao/i.test(`${id} ${p?.name || ''}`))?.[1];
        const cost = Number(entry?.favor ?? entry?.cost ?? entry?.favor_cost);
        return Number.isFinite(cost) ? cost : this.CONFIG.purificationFavorCost;
    }

    _effectFingerprint(townId, effect) {
        const raw = effect?.attributes || effect || {};
        return `${townId}:${this._read(raw, ['id', 'power_id', 'cast_id', 'end_at', 'expires_at'], 'active')}`;
    }

    // ═══════════════════════════════════════════════════
    //  PERSISTENCE
    // ═══════════════════════════════════════════════════

    _persistJobs() {
        const plainJob = (job) => ({
            ...job,
            commandIds: [...(job.commandIds || [])],
            attacks: (job.attacks || []).map((a) => ({
                id: a.id, type: a.type, rawType: a.rawType,
                originTownId: a.originTownId, targetTownId: a.targetTownId,
                startedAt: a.startedAt, startedHasMilliseconds: a.startedHasMilliseconds,
                arrivalAt: a.arrivalAt, arrivalHasMilliseconds: a.arrivalHasMilliseconds,
                nc: a.nc
            }))
        });
        this.storage.save(this.STORAGE_KEY, {
            version: this.VERSION,
            jobs: [...this._jobs.values()].map(plainJob),
            militiaJobs: [...this._militiaJobs.values()],
            purificationJobs: [...this._purificationJobs.values()]
        });
    }

    _restoreJobs() {
        const stored = this.storage.load(this.STORAGE_KEY, {});
        for (const raw of stored.jobs || []) {
            if (['scheduled', 'cancelling'].includes(raw.stage)) {
                const exists = this._movements().some((m) => m.id === String(raw.commandId) && !m.returning);
                raw.stage = exists ? 'scheduled' : 'blocked';
                if (!exists) raw.error = 'command-missing-after-reload';
            }
            this._jobs.set(raw.id, raw);
        }
        for (const raw of stored.militiaJobs || []) {
            if (raw.stage === 'activating') raw.stage = 'blocked';
            if (raw.stage === 'active' && this._number(raw.activeUntil) <= this._serverNowMs()) raw.stage = 'expired';
            this._militiaJobs.set(String(raw.townId), raw);
        }
        for (const raw of stored.purificationJobs || []) {
            if (['scheduled', 'casting'].includes(raw.stage)) {
                raw.stage = 'blocked';
                raw.error = 'cast-status-unknown-after-reload';
            }
            this._purificationJobs.set(String(raw.targetTownId), raw);
        }
    }

    // ═══════════════════════════════════════════════════
    //  AJAX (com latência e timeout — como o script avançado)
    // ═══════════════════════════════════════════════════

    _ajax(method, controller, action, data) {
        return new Promise((resolve, reject) => {
            const fn = uw.gpAjax?.[method];
            if (typeof fn !== 'function') return reject(new Error(`gpAjax.${method} indisponível.`));
            const started = performance.now();
            let settled = false;
            const timeout = setTimeout(() => finish(new Error(`Timeout: ${controller}/${action}`)), this.CONFIG.ajaxTimeoutMs);

            const finish = (error, response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                const rtt = performance.now() - started;
                this._latencySamples.push(rtt);
                if (this._latencySamples.length > 30) this._latencySamples.shift();
                this._latencyMs = this._latencyMs * 0.7 + rtt * 0.3;
                if (error) reject(error);
                else if (response?.success === false || response?.json?.success === false) {
                    const rejection = new Error(`Grepolis rejeitou ${controller}/${action}.`);
                    rejection.definitive = true;
                    rejection.response = response;
                    reject(rejection);
                } else resolve(response);
            };

            try {
                const request = fn.call(uw.gpAjax, controller, action, data || {}, false, (r) => finish(null, r));
                if (request?.then) request.then((r) => finish(null, r), (e) => finish(e));
                else if (request?.fail) request.fail((e) => finish(e));
            } catch (e) { finish(e); }
        });
    }

    _ajaxGet(c, a, d) { return this._ajax('ajaxGet', c, a, d); }
    _ajaxPost(c, a, d) { return this._ajax('ajaxPost', c, a, d); }

    // ═══════════════════════════════════════════════════
    //  MUNDO / ATAQUES / NC
    // ═══════════════════════════════════════════════════

    async _loadWorldTowns() {
        const cacheMs = this.CONFIG.mapCacheMs;
        if (this._worldTownsCache && Date.now() - this._worldTownsCache.at < cacheMs) return this._worldTownsCache.towns;
        const stored = this.storage.load(this.MAP_KEY, null);
        if (stored?.at && Date.now() - stored.at < cacheMs && Array.isArray(stored.towns)) {
            this._worldTownsCache = stored;
            return stored.towns;
        }
        const response = await fetch(`${location.origin}/data/towns.txt`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Mapa do mundo indisponível (${response.status}).`);
        const towns = this._parseWorldTowns(await response.text());
        this._worldTownsCache = { at: Date.now(), towns };
        this.storage.save(this.MAP_KEY, this._worldTownsCache);
        return towns;
    }

    _previewData(response) { return response?.json || response || {}; }

    _revoltActiveTownIds() {
        const ids = new Set();
        const now = this._serverNowMs();
        try {
            const models = uw.MM?.getModels?.() || {};
            Object.entries(models).forEach(([name, collection]) => {
                if (!/revolt|conquest/i.test(name)) return;
                const values = Array.isArray(collection) ? collection : Object.values(collection || {});
                values.forEach((model) => {
                    const raw = model?.attributes || model || {};
                    const townId = String(this._read(raw, ['town_id', 'target_town_id', 'targetTownId'], ''));
                    const endAt = this._timestampMs(this._read(raw, ['revolt_end', 'end_at', 'finished_at', 'revolt_end_at'], 0));
                    if (townId && (!endAt || endAt > now)) ids.add(townId);
                });
            });
        } catch (e) {}
        return ids;
    }

    _townDistance(left, right) {
        return Math.hypot(this._number(left?.islandX) - this._number(right?.islandX),
                         this._number(left?.islandY) - this._number(right?.islandY));
    }

    async _classifyAttacks(attacks) {
        const worldTowns = await this._loadWorldTowns();
        const byId = new Map(worldTowns.map((t) => [t.id, t]));
        const revolts = this._revoltActiveTownIds();
        const unitSpeed = this._number(uw.Game?.unit_speed ?? uw.Game?.unitSpeed, 1);
        const colonySpeed = this._number(uw.GameData?.units?.colonize_ship?.speed, 3);
        return attacks.map((attack) => {
            const origin = byId.get(attack.originTownId);
            const target = byId.get(attack.targetTownId);
            const expectedDurations = origin && target
                ? this._calculateNcDurations({
                    distance: this._townDistance(origin, target),
                    unitSpeed, colonySpeed
                })
                : [];
            return {
                ...attack,
                nc: this._classifyNcAttack(attack, {
                    expectedDurations,
                    revoltActive: revolts.has(attack.targetTownId)
                })
            };
        });
    }

    _incomingAttacks() {
        const ownIds = new Set(this._ownTowns().map((t) => t.id));
        const now = this._serverNowMs();
        return this._movements().filter((m) => (
            m.type === 'attack'
            && !m.returning
            && m.arrivalAt > now
            && ownIds.has(m.targetTownId)
        ));
    }

    // ═══════════════════════════════════════════════════
    //  DESTINO / ENVIO / RECALL
    // ═══════════════════════════════════════════════════

    async _chooseDestination(source, desiredReturnAt, excludedIds = new Set()) {
        const all = await this._loadWorldTowns();
        const sourceMapTown = all.find((t) => t.id === source.id) || source;
        const candidates = this._sortDestinations(
            all.filter((t) => this._sameIsland(t, source.islandX, source.islandY) && !excludedIds.has(t.id)),
            sourceMapTown
        ).slice(0, this.CONFIG.maxDestinationPreviews);

        const estimatedCancelElapsed = Math.max(0, (desiredReturnAt - this._serverNowMs()) / 2);
        for (const town of candidates) {
            try {
                const response = await this._ajaxGet('town_info', 'support', {
                    id: this._integer(town.id), town_id: this._integer(source.id), nl_init: true
                });
                const data = this._previewData(response);
                if (this._supportDestinationUnavailable(response)) {
                    this._log('warn', `Destino ${town.id} ignorado: férias.`);
                    continue;
                }
                if (data.controller_type && data.controller_type !== 'town_info') continue;
                if (data.type && data.type !== 'support') continue;
                if (data.target_id && String(data.target_id) !== town.id) continue;
                const travelDurationMs = this._extractTravelDurationMs(response);
                const units = this._buildSupportUnits(response);
                const total = Object.values(units).reduce((sum, count) => sum + count, 0);
                if (!travelDurationMs || !total) continue;
                if (travelDurationMs <= estimatedCancelElapsed + this.CONFIG.destinationTravelMarginSeconds * 1_000) continue;
                return { town, travelDurationMs, units, capacity: this._extractSupportCapacity(response) };
            } catch (e) {
                this._log('warn', `Destino ${town.id} rejeitado: ${e.message}`);
            }
        }
        return null;
    }

    async _warmTimingSamples(sourceTownId, targetTownId, firstArrivalAt) {
        while (this._latencySamples.length < 4 && firstArrivalAt - this._serverNowMs() > 8_000) {
            try {
                await this._ajaxGet('town_info', 'support', {
                    id: this._integer(targetTownId), town_id: this._integer(sourceTownId), nl_init: true
                });
            } catch { break; }
        }
    }

    _commandIds() {
        return new Set(this._movements().map((m) => m.id).filter(Boolean));
    }

    async _waitForCreatedSupport(beforeIds, sourceId, targetId, sentAt) {
        const deadline = Date.now() + this.CONFIG.commandResolveTimeoutMs;
        while (Date.now() < deadline) {
            const candidates = this._movements().filter((m) => (
                m.type === 'support'
                && !m.returning
                && m.originTownId === String(sourceId)
                && m.targetTownId === String(targetId)
                && m.id
                && !beforeIds.has(m.id)
                && (!m.startedAt || Math.abs(m.startedAt - sentAt) < 60_000)
            ));
            if (candidates.length === 1) return candidates[0];
            if (candidates.length > 1) throw new Error('Mais de um apoio novo corresponde ao envio.');
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error('O apoio enviado não apareceu nos movimentos.');
    }

    async _waitForCommandGone(commandId) {
        const deadline = Date.now() + this.CONFIG.commandResolveTimeoutMs;
        while (Date.now() < deadline) {
            if (!this._movements().some((m) => m.id === String(commandId) && !m.returning)) return true;
            await new Promise((r) => setTimeout(r, 150));
        }
        return false;
    }

    // ═══════════════════════════════════════════════════
    //  MILÍCIA
    // ═══════════════════════════════════════════════════

    _townMilitiaActive(townId, now = this._serverNowMs()) {
        const remembered = this._militiaJobs.get(String(townId));
        if (this._number(remembered?.activeUntil) > now) return true;
        const town = this._ownTowns().find((c) => c.id === String(townId))?.model;
        try {
            const units = typeof town?.units === 'function' ? town.units() : {};
            if (this._integer(units?.militia) > 0) return true;
        } catch (e) {}
        const activeUntil = this._timestampMs(
            town?.get?.('militia_active_until')
            ?? town?.attributes?.militia_active_until
            ?? town?.attributes?.militia_end_at
        );
        return activeUntil > now || Boolean(town?.get?.('militia_active') ?? town?.attributes?.militia_active);
    }

    _militiaConfirmed(response, townId) {
        if (this._townMilitiaActive(townId)) return true;
        let text = '';
        try { text = JSON.stringify(response); } catch { text = String(response || ''); }
        return /militia[^\d]{0,30}[1-9]\d*|militia_active[^a-z]{0,10}(?:true|1)/i.test(text);
    }

    async _activateMilitia(job) {
        if (job.stage !== 'scheduled') return;
        if (this._townMilitiaActive(job.townId)) {
            job.stage = 'active';
            job.activeUntil = Math.max(this._number(job.activeUntil), this._serverNowMs() + this.CONFIG.militiaActiveMs);
            this._persistJobs();
            return;
        }
        job.stage = 'activating';
        this._persistJobs();
        try {
            const response = await this._ajaxPost('building_farm', 'request_militia', { town_id: this._integer(job.townId) });
            const deadline = Date.now() + 5_000;
            while (!this._militiaConfirmed(response, job.townId) && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 200));
            }
            if (!this._militiaConfirmed(response, job.townId)) {
                throw new Error('Ativação da milícia não ficou confirmada.');
            }
            job.stage = 'active';
            job.activatedAt = this._serverNowMs();
            job.activeUntil = job.activatedAt + this.CONFIG.militiaActiveMs;
            this._log('info', `Milícia ativa em ${this.getTownName(job.townId)}.`);
        } catch (e) {
            job.stage = 'blocked';
            job.error = e.message;
            this._log('error', `Falha ao ativar milícia em ${this.getTownName(job.townId)}: ${e.message}`);
        }
        this._persistJobs();
    }

    _reconcileMilitia(attacks) {
        const now = this._serverNowMs();
        const firstByTown = new Map();
        attacks.forEach((a) => {
            const current = firstByTown.get(a.targetTownId);
            if (!current || a.arrivalAt < current.arrivalAt) firstByTown.set(a.targetTownId, a);
        });
        firstByTown.forEach((attack, townId) => {
            if (this._townMilitiaActive(townId, now)) return;
            const existing = this._militiaJobs.get(townId);
            if (existing && ['scheduled', 'activating'].includes(existing.stage)) {
                if (attack.arrivalAt < existing.attackArrivalAt) {
                    existing.attackArrivalAt = attack.arrivalAt;
                    existing.activateAt = attack.arrivalAt - this.CONFIG.militiaLeadMs;
                }
                return;
            }
            if (existing?.stage === 'blocked' && existing.attackId === attack.id) return;
            this._militiaJobs.set(townId, {
                townId,
                attackId: attack.id,
                attackArrivalAt: attack.arrivalAt,
                activateAt: attack.arrivalAt - this.CONFIG.militiaLeadMs,
                stage: 'scheduled'
            });
        });
        this._persistJobs();
    }

    // ═══════════════════════════════════════════════════
    //  PURIFICAÇÃO
    // ═══════════════════════════════════════════════════

    async _castPurification(job) {
        job.stage = 'casting';
        job.attemptedAt = this._serverNowMs();
        this._persistJobs();
        try {
            await this._ajaxPost('powers', 'cast', {
                power_id: 'cleanse',
                target_id: this._integer(job.targetTownId),
                target_type: 'town',
                town_id: this._integer(job.sourceTownId)
            });
            job.stage = 'done';
            job.completedAt = this._serverNowMs();
            this._log('info', `Purificação automática lançada em ${this.getTownName(job.targetTownId)}.`);
        } catch (e) {
            job.stage = 'blocked';
            job.error = e.message;
            this._log('warn', `Purificação bloqueada em ${this.getTownName(job.targetTownId)}: ${e.message}`);
        }
        this._persistJobs();
    }

    _monitorPurification() {
        const towns = this._ownTowns();
        const artemisTown = towns.find((t) => this._townGod(t) === 'artemis');
        const favor = this._artemisFavor();
        const cost = this._purificationCost();
        for (const town of towns) {
            const effect = this._narcissismInTown(town);
            const previous = this._purificationJobs.get(town.id);
            if (!effect) {
                if (previous) this._purificationJobs.delete(town.id);
                continue;
            }
            const fingerprint = this._effectFingerprint(town.id, effect);
            const handled = previous?.fingerprint === fingerprint;
            const decision = this._purificationDecision({
                narcissism: true,
                protectedCity: Boolean(this._protectionInTown(town)),
                artemisTownId: artemisTown?.id,
                favor, cost, handled
            });
            if (handled) continue;
            const job = {
                targetTownId: town.id,
                sourceTownId: artemisTown?.id || '',
                fingerprint,
                detectedAt: this._serverNowMs(),
                favor: Number.isFinite(favor) ? favor : null,
                cost,
                stage: decision.allowed ? 'scheduled' : 'blocked',
                error: decision.allowed ? '' : decision.reason
            };
            this._purificationJobs.set(town.id, job);
            this._persistJobs();
            if (decision.allowed) void this._castPurification(job);
            else this._log('warn', `Purificação não será feita em ${this.getTownName(town.id)} (${decision.reason}).`);
        }
    }

    // ═══════════════════════════════════════════════════
    //  CANCEL / ENVIO / JOB
    // ═══════════════════════════════════════════════════

    async _cancelJob(job, reason = 'scheduled') {
        if (['cancelling', 'done'].includes(job.stage)) return;
        job.stage = 'cancelling';
        this._persistJobs();
        const requestAt = this._serverNowMs();
        try {
            await this._ajaxPost('command_info', 'cancel_command', {
                id: this._integer(job.commandId),
                town_id: this._integer(job.sourceTownId)
            });
            const gone = await this._waitForCommandGone(job.commandId);
            if (!gone) throw new Error('O movimento não desapareceu após o cancelamento.');
            job.stage = 'done';
            job.cancelledAt = requestAt + this._latencyMs / 2;
            job.expectedReturnAt = job.sentAt + 2 * (job.cancelledAt - job.sentAt);
            this._log('info',
                `Apoio cancelado ${this.getTownName(job.sourceTownId)} → ${this.getTownName(job.destinationTownId)} ` +
                `(retorno esperado Δ=${Math.round(job.expectedReturnAt - job.desiredReturnAt)}ms)`);
        } catch (e) {
            job.stage = 'blocked';
            job.error = e.message;
            this._log('error', `Cancelamento falhou (command ${job.commandId}): ${e.message}`);
        }
        this._persistJobs();
    }

    async _sendSupportLeg({ wave, source, destination, units, kind, referenceArrivalAt, returnOffsetMs, desiredReturnAt }) {
        const remainingSeconds = (wave.firstArrivalAt - this._serverNowMs()) / 1_000;
        if (remainingSeconds < this.CONFIG.minimumSendLeadSeconds) {
            this._log('error', `Sem margem (${remainingSeconds.toFixed(1)}s) — ${kind} não enviado.`);
            return false;
        }
        const beforeIds = this._commandIds();
        const requestStartedAt = this._serverNowMs();
        let sendError = null;
        try {
            await this._ajaxPost('town_info', 'send_units', this._buildSupportPayload(source.id, destination.town.id, units));
        } catch (e) {
            if (e.definitive) {
                this._log('warn', `Destino ${this.getTownName(destination.town.id)} rejeitou o ${kind}.`);
                return 'destination-rejected';
            }
            sendError = e;
        }
        const sentAtEstimate = requestStartedAt + this._latencyMs / 2;
        let movement;
        try {
            movement = await this._waitForCreatedSupport(beforeIds, source.id, destination.town.id, sentAtEstimate);
        } catch (e) {
            this._log('error', `${kind} não confirmado (${e.message}). Não será repetido.`);
            return false;
        }
        if (sendError) {
            this._log('warn', `Callback falhou mas ${kind} foi confirmado (${movement.id}).`);
        }
        const sentAt = this._chooseSentAt(movement, sentAtEstimate);
        const cancelAt = this._calculateCancelAt(sentAt, referenceArrivalAt, returnOffsetMs);
        const outboundArrivalAt = movement.arrivalAt || sentAt + destination.travelDurationMs;
        const feasible = this._cancellationFeasibility({ sentAt, cancelAt, outboundArrivalAt });
        const job = {
            ...wave,
            id: `${wave.id}:${kind}`,
            parentWaveId: wave.id,
            supportKind: kind,
            stage: feasible.allowed ? 'scheduled' : 'cancelling',
            sourceTownId: source.id,
            destinationTownId: destination.town.id,
            commandId: movement.id,
            sentAt,
            outboundArrivalAt,
            desiredReturnAt,
            returnOffsetMs,
            tactic: wave.ncArrivalAt ? 'nc-snipe' : 'dodge',
            ncConfidence: wave.ncConfidence || '',
            cancelAt,
            createdAt: this._serverNowMs()
        };
        this._jobs.set(job.id, job);
        this._persistJobs();
        this._log('info',
            `${kind === 'naval' ? '⚓' : kind === 'land' ? '🛡️' : '⚔️'} ${this.getTownName(source.id)} → ${this.getTownName(destination.town.id)} ` +
            `(${job.tactic}). Retorna às ${new Date(job.desiredReturnAt).toLocaleTimeString()}.`);
        if (!feasible.allowed) {
            job.stage = 'scheduled';
            await this._cancelJob(job, feasible.reason);
        }
        return true;
    }

    async _startJob(wave, excludedDestinationIds = new Set()) {
        const source = this._ownTowns().find((t) => t.id === wave.targetTownId);
        if (!source) return;
        const referenceArrivalAt = wave.ncArrivalAt || wave.lastArrivalAt;
        const referenceAttack = wave.ncArrivalAt
            ? wave.attacks?.find((a) => a.arrivalAt === wave.ncArrivalAt)
            : null;
        let returnOffsetMs = this._chooseReturnOffset({
            nc: Boolean(wave.ncArrivalAt),
            hasMilliseconds: Boolean(referenceAttack?.arrivalHasMilliseconds) && this._serverClockHasMilliseconds(),
            uncertaintyMs: this._timingUncertaintyMs()
        });
        const desiredReturnAt = referenceArrivalAt + returnOffsetMs;
        const destination = await this._chooseDestination(source, desiredReturnAt, excludedDestinationIds);
        if (!destination) {
            this._jobs.set(wave.id, { ...wave, stage: 'blocked', error: 'no-viable-destination' });
            this._persistJobs();
            this._log('error', `Sem destino na mesma ilha para ${this.getTownName(source.id)}.`);
            return;
        }
        if (wave.ncArrivalAt && referenceAttack?.arrivalHasMilliseconds && this._serverClockHasMilliseconds()) {
            await this._warmTimingSamples(source.id, destination.town.id, wave.firstArrivalAt);
            returnOffsetMs = this._chooseReturnOffset({
                nc: true, hasMilliseconds: true,
                uncertaintyMs: this._timingUncertaintyMs()
            });
        }
        const finalDesiredReturnAt = referenceArrivalAt + returnOffsetMs;
        const remainingSeconds = (wave.firstArrivalAt - this._serverNowMs()) / 1_000;
        if (remainingSeconds < this.CONFIG.minimumSendLeadSeconds) {
            this._jobs.set(wave.id, { ...wave, stage: 'blocked', error: 'lead-expired-during-preview' });
            this._persistJobs();
            this._log('error', `Pré-validação demorou (${remainingSeconds.toFixed(1)}s). Apoio não enviado.`);
            return;
        }
        if (this._latencyMs > this.CONFIG.maximumRttMs) throw new Error(`Latência excessiva (${Math.round(this._latencyMs)} ms).`);

        const supportPlan = this._planSupportCommands(destination.units, uw.GameData?.units || {}, destination.capacity);
        if (supportPlan.split) {
            this._log('info',
                `Capacidade insuficiente → apoio dividido (req ${supportPlan.requiredCapacity} / disp ${supportPlan.availableCapacity}).`);
            let confirmed = 0;
            for (const plan of supportPlan.plans) {
                const result = await this._sendSupportLeg({
                    wave, source, destination, units: plan.units, kind: plan.kind,
                    referenceArrivalAt, returnOffsetMs, desiredReturnAt: finalDesiredReturnAt
                });
                if (result === 'destination-rejected' && confirmed === 0) {
                    excludedDestinationIds.add(destination.town.id);
                    return this._startJob(wave, excludedDestinationIds);
                }
                if (result === true) confirmed += 1;
            }
            if (!confirmed) {
                this._jobs.set(wave.id, { ...wave, stage: 'blocked', error: 'split-send-unconfirmed' });
                this._persistJobs();
            }
            return;
        }

        // Envio único (mixed)
        const beforeIds = this._commandIds();
        const requestStartedAt = this._serverNowMs();
        let sendError = null;
        try {
            await this._ajaxPost('town_info', 'send_units',
                this._buildSupportPayload(source.id, destination.town.id, destination.units));
        } catch (e) {
            if (e.definitive) {
                excludedDestinationIds.add(destination.town.id);
                this._log('warn', `Destino ${this.getTownName(destination.town.id)} rejeitou. Tentando outra cidade...`);
                return this._startJob(wave, excludedDestinationIds);
            }
            sendError = e;
        }
        const sentAtEstimate = requestStartedAt + this._latencyMs / 2;
        let movement;
        try {
            movement = await this._waitForCreatedSupport(beforeIds, source.id, destination.town.id, sentAtEstimate);
        } catch (e) {
            this._log('error', `Envio não confirmado (${e.message}). Não será repetido.`);
            this._jobs.set(wave.id, { ...wave, stage: 'blocked', error: 'send-unconfirmed' });
            this._persistJobs();
            return;
        }
        if (sendError) {
            this._log('warn', `Callback falhou, mas apoio confirmado (${movement.id}).`);
        }
        const sentAt = this._chooseSentAt(movement, sentAtEstimate);
        const cancelAt = this._calculateCancelAt(sentAt, referenceArrivalAt, returnOffsetMs);
        const outboundArrivalAt = movement.arrivalAt || sentAt + destination.travelDurationMs;
        const feasible = this._cancellationFeasibility({ sentAt, cancelAt, outboundArrivalAt });
        const job = {
            ...wave,
            stage: feasible.allowed ? 'scheduled' : 'cancelling',
            sourceTownId: source.id,
            destinationTownId: destination.town.id,
            commandId: movement.id,
            sentAt,
            outboundArrivalAt,
            desiredReturnAt: finalDesiredReturnAt,
            returnOffsetMs,
            tactic: wave.ncArrivalAt ? 'nc-snipe' : 'dodge',
            ncConfidence: wave.ncConfidence || '',
            cancelAt,
            createdAt: this._serverNowMs()
        };
        this._jobs.set(wave.id, job);
        this._persistJobs();
        this._log('info',
            `${job.tactic === 'nc-snipe' ? '🎯' : '💨'} ${this.getTownName(source.id)} → ${this.getTownName(destination.town.id)} · ` +
            `retorno ${new Date(job.desiredReturnAt).toLocaleTimeString()}`);
        if (!feasible.allowed) {
            this._log('warn', `Viagem real inviável (${feasible.reason}) → cancelamento imediato.`);
            job.stage = 'scheduled';
            await this._cancelJob(job, feasible.reason);
        }
    }

    _reconcileWaves(waves) {
        for (const wave of waves) {
            const relatedJobs = [...this._jobs.values()].filter((c) => (
                c.targetTownId === wave.targetTownId
                && ['scheduled', 'cancelling'].includes(c.stage)
                && wave.firstArrivalAt <= c.lastArrivalAt + this.CONFIG.waveGapSeconds * 1_000
            ));
            for (const job of relatedJobs) {
                if (job.stage !== 'scheduled') continue;
                const ncChanged = Boolean(wave.ncArrivalAt) && wave.ncArrivalAt !== job.ncArrivalAt;
                if (wave.lastArrivalAt <= job.lastArrivalAt && !ncChanged) continue;
                job.lastArrivalAt = wave.lastArrivalAt;
                job.commandIds = wave.commandIds;
                job.attacks = wave.attacks;
                job.ncArrivalAt = wave.ncArrivalAt;
                job.ncConfidence = wave.ncConfidence;
                const referenceAttack = wave.ncArrivalAt
                    ? wave.attacks?.find((a) => a.arrivalAt === wave.ncArrivalAt)
                    : null;
                job.returnOffsetMs = this._chooseReturnOffset({
                    nc: Boolean(wave.ncArrivalAt),
                    hasMilliseconds: Boolean(referenceAttack?.arrivalHasMilliseconds) && this._serverClockHasMilliseconds(),
                    uncertaintyMs: this._timingUncertaintyMs()
                });
                const referenceArrivalAt = wave.ncArrivalAt || wave.lastArrivalAt;
                job.tactic = wave.ncArrivalAt ? 'nc-snipe' : 'dodge';
                job.desiredReturnAt = referenceArrivalAt + job.returnOffsetMs;
                job.cancelAt = this._calculateCancelAt(job.sentAt, referenceArrivalAt, job.returnOffsetMs);
                const feasible = this._cancellationFeasibility({
                    sentAt: job.sentAt, cancelAt: job.cancelAt, outboundArrivalAt: job.outboundArrivalAt
                });
                if (!feasible.allowed) job.forceCancelReason = `wave-extension:${feasible.reason}`;
            }
            this._persistJobs();
        }
    }

    // ═══════════════════════════════════════════════════
    //  TIMING / SCAN / HEARTBEAT
    // ═══════════════════════════════════════════════════

    _timingUncertaintyMs() {
        if (this._latencySamples.length < 4) return Infinity;
        const sorted = [...this._latencySamples].sort((a, b) => a - b);
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
        const median = sorted[Math.floor(sorted.length / 2)];
        return Math.max(0, (p95 - median) / 2);
    }

    _acquireLock() {
        try {
            const now = Date.now();
            const current = JSON.parse(localStorage.getItem(this.LOCK_KEY) || 'null');
            if (current && current.ownerId !== this._ownerId && current.expiresAt > now) return false;
            localStorage.setItem(this.LOCK_KEY, JSON.stringify({ ownerId: this._ownerId, expiresAt: now + this.CONFIG.lockTtlMs }));
            return true;
        } catch { return true; }
    }

    async _scan() {
        if (!this._active || this._busy || !this._acquireLock()) return;
        this._busy = true;
        try {
            const now = this._serverNowMs();
            const rawAttacks = this._incomingAttacks();
            // Milícia depende apenas da chegada — não bloqueia se classificação NC falhar
            this._reconcileMilitia(rawAttacks);

            const attacks = await this._classifyAttacks(rawAttacks);
            const waves = this._groupAttackWaves(attacks, this.CONFIG.waveGapSeconds);
            this._reconcileWaves(waves);

            const candidate = waves.find((wave) => {
                const related = [...this._jobs.values()].find((job) => (
                    job.targetTownId === wave.targetTownId
                    && wave.firstArrivalAt <= job.lastArrivalAt + this.CONFIG.waveGapSeconds * 1_000
                    && (
                        ['scheduled', 'cancelling'].includes(job.stage)
                        || (job.stage === 'done' && (
                            wave.lastArrivalAt <= job.lastArrivalAt
                            || now < this._number(job.expectedReturnAt) + 1_000
                        ))
                        || (job.stage === 'blocked' && wave.lastArrivalAt <= job.lastArrivalAt)
                    )
                ));
                if (related) return false;
                const seconds = (wave.firstArrivalAt - now) / 1_000;
                return seconds <= this.CONFIG.sendLeadSeconds && seconds >= this.CONFIG.minimumSendLeadSeconds;
            });

            if (candidate) {
                const attempt = [...this._jobs.values()].filter((j) => j.targetTownId === candidate.targetTownId).length;
                await this._startJob({ ...candidate, id: `${candidate.id}:attempt:${attempt}` });
            }
        } catch (e) {
            this._log('error', `scan: ${e?.message ?? e}`);
        } finally {
            this._busy = false;
        }
    }

    async _heartbeat() {
        if (!this._active || !this._acquireLock()) return;
        const current = performance.now();
        const slip = current - this._lastHeartbeatAt - this.CONFIG.heartbeatIntervalMs;
        this._lastHeartbeatAt = current;

        const now = this._serverNowMs();
        if (now - this._lastPurificationScanAt >= this.CONFIG.purificationScanIntervalMs) {
            this._lastPurificationScanAt = now;
            try { this._monitorPurification(); } catch (e) { /* ignored */ }
        }

        for (const job of this._jobs.values()) {
            if (job.stage !== 'scheduled') continue;
            if (job.forceCancelReason) {
                await this._cancelJob(job, job.forceCancelReason);
                continue;
            }
            const dispatchAt = job.cancelAt - this._latencyMs / 2;
            if (now >= dispatchAt) {
                if (slip > this.CONFIG.maximumTimerSlipMs) {
                    this._log('warn', `Timer atrasado (${Math.round(slip)}ms) — cancelando ASAP.`);
                }
                await this._cancelJob(job);
            }
        }

        for (const job of this._militiaJobs.values()) {
            if (job.stage !== 'scheduled') continue;
            const advanceMs = Math.max(
                this.CONFIG.militiaLeadMs,
                this.CONFIG.militiaLeadMs + this._latencyMs / 2 + this.CONFIG.militiaLatencySafetyMs
            );
            const dispatchAt = job.attackArrivalAt - advanceMs;
            if (now >= dispatchAt) await this._activateMilitia(job);
        }

        this._refreshSettingsStatus();
    }
};
