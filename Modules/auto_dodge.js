// ══════════════════════════════════════════════════════════════════════════
//  MODULE: AutoDodge Dual (Original + Seguro)
//  Integração no MultBot com dois módulos independentes.
// ══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────
// MÓDULO 1: AUTO DODGE ORIGINAL (Agressivo)
// ───────────────────────────────────────────────────────────────────────────
var AutoDodge = class extends MultUtil {
    VERSION = '2.0.1-Original';
    STORAGE_KEY = 'gd.runtime.v2_orig';
    LOCK_KEY = 'gd.tab-lock.v2_orig';
    MAP_KEY = 'gd.world-towns.v2_orig';
    PREFIX = '[Dodge Orig]';

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

    // ... (O resto do código do Módulo 1 é idêntico ao teu original. 
    // Para poupar espaço, mantém toda a lógica de _boot, _scan, _log, etc., 
    // apenas garante que usa this.STORAGE_KEY e this.PREFIX definidos acima).
    // [COPIA AQUI TODO O RESTO DO TEU CÓDIGO ORIGINAL DA CLASSE AutoDodge]
    
    // Exemplo simplificado da UI para diferenciar:
    settings = () => {
        requestAnimationFrame(() => this._updateTitle());
        return (
            '<div class="game_border" style="margin-bottom:20px; border-color: #c62828;">' +
            '<div class="game_border_top"></div><div class="game_border_bottom"></div>' +
            '<div class="game_border_left"></div><div class="game_border_right"></div>' +
            '<div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
            '<div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
            this.getTitleHtml('dodge_title_orig', 'Auto Dodge (Original)', this.toggle, '', this._active) +
            '<div style="padding:5px 10px;font-weight:bold;font-size:11px; color:#c62828;">' +
            'MODO AGRESSIVO: Margens mínimas. Alto risco de tropas ficarem presas se o ping subir.' +
            '</div>' +
            '<div id="dodge_status_orig" style="padding:0 10px 6px;font-size:11px;color:#5a3a0a;">' + this._buildStatusHtml() + '</div>' +
            '<div id="dodge_log_orig" style="padding:2px 10px 8px;font-size:11px;color:#5a3a0a;min-height:16px;"></div>' +
            '</div>'
        );
    };
    // ... (mantém todos os outros métodos: _log, _scan, _heartbeat, etc., do teu código original)
};


// ───────────────────────────────────────────────────────────────────────────
// MÓDULO 2: AUTO DODGE SEGURO (Novo, à parte, ativável independentemente)
// ───────────────────────────────────────────────────────────────────────────
var AutoDodgeSafe = class extends MultUtil {
    VERSION = '2.1.0-Safe';
    STORAGE_KEY = 'gd.runtime.v2_safe'; // Chave de armazenamento diferente!
    LOCK_KEY = 'gd.tab-lock.v2_safe';
    MAP_KEY = 'gd.world-towns.v2_safe';
    PREFIX = '[Dodge Seguro]';

    // CONFIGURAÇÕES MODIFICADAS PARA DIMINUIR O RISCO (Margens aumentadas)
    CONFIG = Object.freeze({
        enabled: true,
        returnOffsetMs: 3_500,               // AUMENTADO: Regressa 3.5s DEPOIS do ataque (em vez de 1s)
        ncReturnOffsetMs: -2_500,            // AUMENTADO: Regressa 2.5s ANTES do NC (em vez de 0.1s)
        ncFallbackReturnOffsetMs: -4_000,    // AUMENTADO: Margem de segurança extra
        ncHighPrecisionUncertaintyMs: 150,
        ncDurationToleranceMs: 11_000,
        ncBaseTravelSeconds: 900,
        ncDistanceFactor: 50,
        ncSpeedModifiers: null,
        militiaLeadMs: 3_000,                // AUMENTADO: Ativa milícia com 3s de antecedência
        militiaLatencySafetyMs: 200,
        militiaActiveMs: 3 * 60 * 60_000,
        purificationScanIntervalMs: 100,
        purificationFavorCost: 200,
        waveGapSeconds: 300,
        sendLeadSeconds: 45,                 // AUMENTADO: Começa a planear com 45s de antecedência
        minimumSendLeadSeconds: 12,          // AUMENTADO: RECUSA enviar se faltarem menos de 12s (evita dodges desesperados)
        destinationTravelMarginSeconds: 8,
        cancellationWindowSeconds: 600,
        cancellationSafetySeconds: 5,        // AUMENTADO: Dá 5s ao servidor para processar o cancelamento
        scanIntervalMs: 500,                 // Diminuído: Scan mais rápido para compensar o planeamento antecipado
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

    _active = false;
    _starting = false;
    _wantActive = false;
    _restored = false;
    _scanTimer = null;
    _heartbeatTimer = null;
    _lastStatusUpdate = 0;
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
        this._ownerId = `${Date.now().toString(36)}-safe-${Math.random().toString(36).slice(2, 9)}`;
        if (this.storage.load('dodge_safe_active', false)) {
            setTimeout(() => this.start(), 2000);
        }
    }

    settings = () => {
        requestAnimationFrame(() => this._updateTitle());
        return (
            '<div class="game_border" style="margin-bottom:20px; border-color: #2e7d32;">' +
            '<div class="game_border_top"></div><div class="game_border_bottom"></div>' +
            '<div class="game_border_left"></div><div class="game_border_right"></div>' +
            '<div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
            '<div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
            this.getTitleHtml('dodge_title_safe', 'Auto Dodge (SEGURO)', this.toggle, '', this._active) +
            '<div style="padding:5px 10px;font-weight:bold;font-size:11px; color:#2e7d32;">' +
            'MODO SEGURO: Margens alargadas. Recusa envios com <12s. Previne tropas presas.' +
            '</div>' +
            '<div id="dodge_status_safe" style="padding:0 10px 6px;font-size:11px;color:#5a3a0a;">' +
            this._buildStatusHtml() +
            '</div>' +
            '<div id="dodge_log_safe" style="padding:2px 10px 8px;font-size:11px;color:#5a3a0a;min-height:16px;"></div>' +
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

    async _boot() {
        const ready = await this._waitForBindings(30_000);
        this._starting = false;
        if (!this._wantActive) return;
        if (!ready) {
            this._wantActive = false;
            this.storage.save('dodge_safe_active', false);
            this._log('error', 'APIs não disponíveis; módulo parado.');
            return;
        }
        if (!this._restored) {
            this._restored = true;
            this._restoreJobs();
        }
        this._active = true;
        this.storage.save('dodge_safe_active', true);
        this._updateTitle();
        this._log('info', `Módulo SEGURO v${this.VERSION} iniciado.`);

        clearInterval(this._scanTimer);
        clearInterval(this._heartbeatTimer);
        this._lastHeartbeatAt = performance.now();

        this._scanTimer = setInterval(() => this._scan().catch((e) => this._log('error', `scan: ${e?.message ?? e}`)), this.CONFIG.scanIntervalMs);
        this._heartbeatTimer = setInterval(() => this._heartbeat().catch((e) => this._log('error', `heartbeat: ${e?.message ?? e}`)), this.CONFIG.heartbeatIntervalMs);
        this._scan().catch(() => {});
    }

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
        this.storage.save('dodge_safe_active', false);
        clearInterval(this._scanTimer);
        clearInterval(this._heartbeatTimer);
        this._scanTimer = null;
        this._heartbeatTimer = null;
        this._updateTitle();
        this._log('warn', 'Módulo SEGURO parado.');
    }

    _bindingsReady() { return Boolean(uw.gpAjax && uw.ITowns && uw.MM && uw.Timestamp); }
    _updateTitle() {
        const filter = this._active ? 'brightness(100%) saturate(186%) hue-rotate(120deg)' : ''; // Verde quando ativo
        try { uw.$('#dodge_title_safe').css('filter', filter); } catch (e) {}
    }

    _buildStatusHtml() {
        const jobs = [...this._jobs.values()].filter((j) => ['scheduled', 'cancelling', 'done'].includes(j.stage));
        return `Estado: <b>${this._active ? 'ATIVO' : 'PARADO'}</b> · Apoios: <b>${jobs.length}</b>`;
    }

    _log(level, message, details = {}) {
        const icon = level === 'error' ? '✗' : level === 'warn' ? '⚠' : '·';
        this.console.log(`${this.PREFIX} ${icon} ${message}`);
        try {
            const $log = uw.$('#dodge_log_safe');
            if ($log.length) {
                const color = level === 'error' ? '#f87171' : level === 'warn' ? '#eab308' : '#1a6b2a';
                $log.text(message).css('color', color);
            }
        } catch (e) {}
    }

    // ... [AQUI DEVES COLAR TODOS OS OUTROS MÉTODOS DO TEU SCRIPT ORIGINAL (_number, _scan, _heartbeat, _cancelJob, etc.)] ...
    // Apenas certifica-te que nos métodos de log e UI, usas os IDs com sufixo "_safe" (ex: 'dodge_log_safe', 'dodge_status_safe')
    // e que usas this.storage.load/save com a chave 'dodge_safe_active' em vez de 'dodge_active'.
};

// ══════════════════════════════════════════════════════════════════════════
// REGISTO NO MULTBOT (Ajusta conforme o teu sistema carrega os módulos)
// Exemplo:
// window.modernBot.autoDodge = new AutoDodge(console, storage);
// window.modernBot.autoDodgeSafe = new AutoDodgeSafe(console, storage);
// ══════════════════════════════════════════════════════════════════════════
