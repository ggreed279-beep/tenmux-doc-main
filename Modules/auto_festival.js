// ══════════════════════════════════════════════════════
//  MODULE: AutoFestival v1.2.0 (Fixed Bulk Send)
//  Porta o "Auto Festival de Recursos" para o MultBot.
//
//  O que faz:
//   • Lista cidades com Academia ≥ 30
//   • Prioriza cidades SEM festival ativo
//   • Envia lotes de até 500 recursos por vez (Wood, Stone, Iron)
//   • Rastreia recursos pendentes (atuais + pendentes)
//   • Quando atinge 🪵15k 🪨18k ⚙15k → inicia festival (party)
// ══════════════════════════════════════════════════════
var AutoFestival = class extends MultUtil {
    VERSION = '1.2.0';
    PREFIX = '[AutoFestival]';

    CONFIG = Object.freeze({
        cost: { wood: 15000, stone: 18000, iron: 15000 },
        intervalMs: 30000,
        pendingTimeoutMs: 120000,
        donorMinResource: 500, // Mínimo para considerar doadora
        fixedSendAmount: 500,  // VALOR QUE PEDISTE: 500 de cada
        minSendTotal: 100,
        logLimit: 80,
        academyMinLevel: 30,
    });

    STORAGE_KEY_PENDING = 'festival_pending';
    STORAGE_KEY_ACTIVE  = 'festival_active';
    STORAGE_KEY_LOGS    = 'festival_logs';

    _active = false;
    _intervalId = null;
    _sendingQueue = {};
    _lastStatusUpdate = 0;

    constructor(c, s) {
        super(c, s);
        if (this.storage.load(this.STORAGE_KEY_ACTIVE, false)) {
            setTimeout(() => { if (!this._active) this.start(); }, 3000);
        }
    }

    // ══════════════════════════════════════════════════
    //  ESTILOS HUD
    // ══════════════════════════════════════════════════
    _injectStyles() {
        if (uw.$('#mbhud-festival-styles').length) return;
        const css = `
            @keyframes mbhudf-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.55; transform: scale(1.25); }
            }
            @keyframes mbhudf-scan {
                0%   { background-position: 200% 0%; }
                100% { background-position: -200% 0%; }
            }
            @keyframes mbhudf-fade {
                from { opacity: 0; transform: translateY(-3px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            .mbhudf-root {
                background: linear-gradient(135deg, #060816 0%, #0a1020 50%, #060816 100%);
                border: 1px solid rgba(34,211,238,0.35);
                border-radius: 6px;
                padding: 12px;
                font-family: 'SF Mono','Consolas','Monaco','Menlo',monospace;
                color: #a8b8d0;
                box-shadow: 0 0 24px rgba(34,211,238,0.15), inset 0 0 60px rgba(34,211,238,0.03);
                position: relative;
                overflow: hidden;
                animation: mbhudf-fade 0.35s ease;
                margin-bottom: 20px;
            }
            .mbhudf-root::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; height: 2px;
                background: linear-gradient(90deg, transparent, #22d3ee, transparent);
                background-size: 200% 100%;
                animation: mbhudf-scan 3.5s linear infinite;
                pointer-events: none;
            }
            .mbhudf-root::after {
                content: '';
                position: absolute;
                inset: 0;
                background-image:
                    linear-gradient(rgba(34,211,238,0.035) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(34,211,238,0.035) 1px, transparent 1px);
                background-size: 22px 22px;
                pointer-events: none;
                opacity: 0.5;
            }

            .mbhudf-header {
                text-align: center;
                padding: 4px 0 12px;
                border-bottom: 1px solid rgba(34,211,238,0.2);
                margin-bottom: 12px;
                position: relative;
                z-index: 1;
            }
            .mbhudf-header h2 {
                margin: 0;
                font-size: 14px;
                letter-spacing: 6px;
                text-transform: uppercase;
                color: #22d3ee;
                text-shadow: 0 0 12px rgba(34,211,238,0.7), 0 0 26px rgba(34,211,238,0.3);
                font-weight: 700;
                font-family: inherit;
            }
            .mbhudf-header .sub {
                font-size: 9px;
                color: #4a5a6a;
                letter-spacing: 3px;
                margin-top: 5px;
                text-transform: uppercase;
            }
            .mbhudf-header .sub .live {
                color: #00ff88;
                text-shadow: 0 0 8px rgba(0,255,136,0.6);
                font-variant-numeric: tabular-nums;
            }

            .mbhudf-section {
                background: rgba(10,16,32,0.6);
                border: 1px solid rgba(34,211,238,0.2);
                border-radius: 4px;
                padding: 10px 12px;
                margin-bottom: 10px;
                position: relative;
                z-index: 1;
            }
            .mbhudf-label {
                display: block;
                font-size: 9px;
                letter-spacing: 2.5px;
                text-transform: uppercase;
                color: #22d3ee;
                margin-bottom: 8px;
                text-shadow: 0 0 8px rgba(34,211,238,0.6);
                font-weight: 700;
            }
            .mbhudf-label::before { content: '▸ '; opacity: 0.7; }

            .mbhudf-desc {
                font-size: 10px;
                color: #6a7a8a;
                line-height: 1.7;
                letter-spacing: 0.3px;
            }
            .mbhudf-desc b {
                color: #22d3ee;
                text-shadow: 0 0 6px rgba(34,211,238,0.45);
                font-weight: 700;
            }

            .mbhudf-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
                gap: 6px;
            }
            .mbhudf-stat {
                background: rgba(0,0,0,0.35);
                border: 1px solid rgba(34,211,238,0.18);
                border-radius: 4px;
                padding: 6px 8px;
                text-align: center;
                transition: all 0.2s;
            }
            .mbhudf-stat .n {
                font-size: 18px;
                font-weight: 700;
                line-height: 1.1;
                font-variant-numeric: tabular-nums;
                text-shadow: 0 0 8px currentColor;
            }
            .mbhudf-stat .t {
                font-size: 8px;
                letter-spacing: 2px;
                text-transform: uppercase;
                color: #5a6a7a;
                margin-top: 2px;
            }
            .mbhudf-stat.on   .n { color: #00ff88; }
            .mbhudf-stat.info .n { color: #22d3ee; }
            .mbhudf-stat.warn .n { color: #ffb020; }
            .mbhudf-stat.pend .n { color: #a78bfa; }

            .mbhudf-townlist {
                max-height: 220px;
                overflow-y: auto;
                border-radius: 4px;
                background: rgba(0,0,0,0.25);
                border: 1px solid rgba(34,211,238,0.12);
                padding: 2px;
                scrollbar-width: thin;
                scrollbar-color: rgba(34,211,238,0.3) transparent;
            }
            .mbhudf-townlist::-webkit-scrollbar { width: 8px; }
            .mbhudf-townlist::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
            .mbhudf-townlist::-webkit-scrollbar-thumb {
                background: rgba(34,211,238,0.3);
                border-radius: 4px;
            }

            .mbhudf-town {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                border-bottom: 1px solid rgba(34,211,238,0.08);
                font-size: 11px;
                transition: background 0.2s;
                font-family: inherit;
            }
            .mbhudf-town:last-child { border-bottom: none; }
            .mbhudf-town:hover { background: rgba(34,211,238,0.05); }
            .mbhudf-town .star {
                color: #ffb020;
                text-shadow: 0 0 8px rgba(255,176,32,0.6);
                font-size: 12px;
                width: 12px;
                text-align: center;
                flex-shrink: 0;
            }
            .mbhudf-town .name {
                color: #e8f0ff;
                font-weight: 700;
                letter-spacing: 0.3px;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }
            .mbhudf-town .res {
                color: #6a7a8a;
                font-size: 10px;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                letter-spacing: 0.2px;
            }
            .mbhudf-town .res .pend {
                color: #a78bfa;
                margin-left: 3px;
            }

            .mbhudf-pill {
                padding: 3px 9px;
                border-radius: 12px;
                font-size: 8px;
                font-weight: 700;
                letter-spacing: 1.2px;
                text-transform: uppercase;
                border: 1px solid;
                white-space: nowrap;
                flex-shrink: 0;
                font-family: inherit;
            }
            .mbhudf-pill.ready {
                background: rgba(0,255,136,0.12);
                border-color: rgba(0,255,136,0.5);
                color: #00ff88;
                text-shadow: 0 0 6px rgba(0,255,136,0.4);
            }
            .mbhudf-pill.active {
                background: rgba(34,211,238,0.14);
                border-color: rgba(34,211,238,0.55);
                color: #22d3ee;
                text-shadow: 0 0 6px rgba(34,211,238,0.45);
                animation: mbhudf-pulse 2s ease-in-out infinite;
            }
            .mbhudf-pill.waiting {
                background: rgba(255,176,32,0.10);
                border-color: rgba(255,176,32,0.45);
                color: #ffb020;
                text-shadow: 0 0 6px rgba(255,176,32,0.4);
            }

            .mbhudf-led {
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                flex-shrink: 0;
                border: 1px solid rgba(255,255,255,0.08);
            }
            .mbhudf-led.ready {
                background: #00ff88;
                box-shadow: 0 0 8px #00ff88, 0 0 14px rgba(0,255,136,0.55);
                animation: mbhudf-pulse 2s ease-in-out infinite;
            }
            .mbhudf-led.active {
                background: #22d3ee;
                box-shadow: 0 0 8px #22d3ee, 0 0 14px rgba(34,211,238,0.55);
                animation: mbhudf-pulse 1.4s ease-in-out infinite;
            }
            .mbhudf-led.waiting {
                background: #ffb020;
                box-shadow: 0 0 8px #ffb020;
                animation: mbhudf-pulse 1.8s ease-in-out infinite;
            }

            .mbhudf-log {
                font-size: 10px;
                line-height: 1.7;
                max-height: 120px;
                overflow-y: auto;
                background: rgba(0,0,0,0.35);
                border: 1px solid rgba(34,211,238,0.12);
                border-radius: 4px;
                padding: 6px 8px;
                letter-spacing: 0.2px;
                font-family: inherit;
                scrollbar-width: thin;
                scrollbar-color: rgba(34,211,238,0.3) transparent;
            }
            .mbhudf-log::-webkit-scrollbar { width: 8px; }
            .mbhudf-log::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
            .mbhudf-log::-webkit-scrollbar-thumb {
                background: rgba(34,211,238,0.3);
                border-radius: 4px;
            }
            .mbhudf-log .ln { display: flex; gap: 6px; }
            .mbhudf-log .ts {
                color: #
