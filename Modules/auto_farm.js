// ══════════════════════════════════════════════════════
//  MODULE: AutoFarm v3 — simples e claro
//
//  ▸ Recolhe recursos das aldeias rurais a CADA 10 MINUTOS.
//  ▸ Duas opções de método (escolhes no menu):
//      OPÇÃO 1 — 🧭 Capitão: recolha em LOTE (rápida)
//      OPÇÃO 2 — 👟 Cidade a cidade: recolha individual
//  ▸ Mostra sempre: quanto falta para a próxima recolha,
//    a hora da última recolha e o total de recolhas feitas.
//
//  Estrutura do ficheiro:
//    1. CONFIGURAÇÃO   — constantes (intervalo, lotes, pausas)
//    2. INTERFACE      — menu, botões, painel de estado
//    3. LIGAR/DESLIGAR — start / stop / toggle
//    4. CICLO          — timer de 1s + contagem decrescente
//    5. RECOLHA        — orquestra a coleta pelo método escolhido
//    6. MÉTODOS        — Opção 1 (Capitão) e Opção 2 (individual)
//    7. DADOS          — escolhe 1 cidade por ilha (a com mais espaço)
//    8. ENDPOINTS      — chamadas de rede (confirmadas por captura)
// ══════════════════════════════════════════════════════
var AutoFarm = class extends MultUtil {

    /* ════════════ 1. CONFIGURAÇÃO ════════════ */

    INTERVALO_MS  = 10 * 60 * 1000; // 10 minutos entre recolhas
    TIME_OPTION   = 600;            // base: 600s = 10 min (valor válido confirmado)
    TIME_OPTION_BOOTY = 2400;       // booty: 2400s (600 é rejeitado p/ booty — confirmado)
    BATCH_SIZE    = 25;             // cidades por pedido (modo Capitão)
    LOTE_PAUSA_MS = 1200;           // pausa entre lotes (modo Capitão)
    ALDEIA_PAUSA_MS = 500;          // pausa entre aldeias (modo individual)
    JITTER_MS     = 8000;           // variação aleatória (5–13s) por ciclo

    /* OPÇÃO 3 — Loop humano: tempos sempre diferentes */
    HUMANO_MIN_MS          = 9.5 * 60 * 1000; // intervalo mínimo entre ciclos
    HUMANO_MAX_MS          = 14   * 60 * 1000; // intervalo máximo entre ciclos
    HUMANO_CLAIM_MIN_MS    = 1200;  // pausa mínima entre aldeias
    HUMANO_CLAIM_MAX_MS    = 4500;  // pausa máxima entre aldeias
    HUMANO_DISTRACAO_CHANCE = 0.08; // 8% de chance de "distração"
    HUMANO_DISTRACAO_MIN_MS = 6000; // duração mínima da distração
    HUMANO_DISTRACAO_MAX_MS = 15000;// duração máxima da distração
    HUMANO_SKIP_CHANCE     = 0.05;  // 5% de chance de adiar 1 aldeia

    METODOS = [
        { id: 'capitao',    label: '🧭 OPÇÃO 1 — Capitão (lote)' },
        { id: 'individual', label: '👟 OPÇÃO 2 — Cidade a cidade' },
        { id: 'humano',     label: '🧑 OPÇÃO 3 — Loop humano (variado)' },
    ];

    constructor(c, s) {
        super(c, s);

        this.metodo = this.storage.load('af_metodo', 'capitao');
        this.stats  = this.storage.load('af_stats', { recolhas: 0, ultimaRecolhaAt: 0 });

        this.ativo = false;
        this._tickId = null;
        this._emRecolha = false;
        this._janelaAberta = false;
        this._avisoSemCapitao = false;
        this._proximaRecolha = 0;   // timestamp da próxima recolha

        const { $activity, $count } = this.createActivity("url(https://gpit.innogamescdn.com/images/game/premium_features/feature_icons_2.08.png) no-repeat 0 -240px");
        this.$activity = $activity;
        this.$count = $count;
        this.$activity.on('click', this.toggle);

        this.criarMenu();
        this.atualizarBotoes();

        if (this.storage.load('af_active', false)) {
            setTimeout(() => this.ligar(), 3000);
        }
    }

    /* ════════════ 2. INTERFACE ════════════ */

    criarMenu = () => {
        this.$content = uw.$("<div></div>");
        this.$content.append(
            uw.$("<p></p>").text('🚜 AutoFarm — a cada 10 minutos')
                .css({ "text-align": "center", "margin": "2px", "font-weight": "bold", "font-size": "15px" })
        );

        // ── Método (as 2 opções) ──
        this.$content.append(
            uw.$("<p></p>").text('Método de recolha:')
                .css({ "text-align": "left", "margin": "6px 2px 2px", "font-weight": "bold" })
        );
        this.$botoesMetodo = this.METODOS.map(m =>
            this.createButton('mult_farm_metodo_' + m.id, m.label, this.escolherMetodo)
        );
        this.$content.append(...this.$botoesMetodo);

        // ── Ligar / Desligar (botões explícitos) ──
        this.$content.append(
            uw.$("<p></p>").text('Estado do módulo:')
                .css({ "text-align": "left", "margin": "8px 2px 2px", "font-weight": "bold" })
        );
        this.$botaoLigar = this.createButton('mult_farm_ligar', '🟢 LIGAR', this.botaoLigar);
        this.$botaoDesligar = this.createButton('mult_farm_desligar', '🔴 DESLIGAR', this.botaoDesligar);
        this.$content.append(this.$botaoLigar, this.$botaoDesligar);

        // ── Ação imediata ──
        this.$content.append(
            uw.$("<p></p>").text('Ação imediata:')
                .css({ "text-align": "left", "margin": "8px 2px 2px", "font-weight": "bold" })
        );
        this.$botaoJa = this.createButton('mult_farm_ja', '⚡ Recolher já', this.recolherJa);
        this.$content.append(this.$botaoJa);

        // ── Painel de estado (tempos) ──
        this.$estado = uw.$('<div id="af_estado"></div>').css({
            "text-align": "center", "margin": "10px 2px 2px", "font-size": "11.5px",
            "color": "#5a3a0a", "border-top": "1px solid rgba(90,58,10,0.25)", "padding-top": "6px",
        });
        this.$content.append(this.$estado);

        // ── Popup (abre ao passar o rato no ícone) ──
        this.$popup = this.createPopup(423, 250, 170, this.$content);
        this.$popup.css({ 'height': 'auto', 'min-height': '170px' });
        this.$popup.find('.middle').css({ 'position': 'relative', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'padding': '10px' });
        this.dropdown_active = false;

        const fechar = () => {
            if (!this.dropdown_active) this.$popup.hide();
            this.dropdown_active = false;
        };
        const abrir = () => {
            if (this.dropdown_active) this.$popup.show();
        };
        this.$activity.on({
            mouseenter: () => { this.dropdown_active = true; setTimeout(abrir, 1000); },
            mouseleave: () => { this.dropdown_active = false; setTimeout(fechar, 50); }
        });
        this.$popup.on({
            mouseenter: () => { this.dropdown_active = true; },
            mouseleave: () => { this.dropdown_active = false; setTimeout(fechar, 50); }
        });
    };

    escolherMetodo = (event) => {
        const { id } = event.currentTarget;
        const m = this.METODOS.find(x => 'mult_farm_metodo_' + x.id === id);
        if (!m) return;
        this.metodo = m.id;
        this.storage.save('af_metodo', this.metodo);
        this._janelaAberta = false; // se voltar ao Capitão, reabre a janela
        this._avisoSemCapitao = false;
        this.atualizarBotoes();
        this.console.log('[AutoFarm] Método: ' + m.label + '.');
    };

    /* Botões explícitos de LIGAR / DESLIGAR (podem trocar de método a
       qualquer momento, com o módulo ligado ou desligado) */
    botaoLigar = () => {
        if (this.ativo) return;
        this.ligar();
    };

    botaoDesligar = () => {
        if (!this.ativo) return;
        this.desligar();
    };

    atualizarBotoes = () => {
        // Método: a opção ativa fica destacada
        for (const b of this.$botoesMetodo) b.addClass('disabled');
        const i = this.METODOS.findIndex(m => m.id === this.metodo);
        if (i >= 0) this.$botoesMetodo[i].removeClass('disabled');

        // Ligar/Desligar: o botão do estado ATUAL fica destacado
        this.$botaoLigar.addClass('disabled');
        this.$botaoDesligar.addClass('disabled');
        if (this.ativo) this.$botaoDesligar.removeClass('disabled');
        else this.$botaoLigar.removeClass('disabled');

        if (!this.ativo) {
            this.$count.css('color', 'red');
            this.$count.text("");
        }
    };

    /* Painel de estado — tempos de recolha */
    _mostrarEstado = (faltaMs) => {
        const mm = String(Math.floor(faltaMs / 60000)).padStart(2, '0');
        const ss = String(Math.floor((faltaMs % 60000) / 1000)).padStart(2, '0');

        try {
            if (!this.ativo) {
                this.$count.text("").css('color', 'red');
            } else {
                const capitao = uw.GameDataPremium.isAdvisorActivated('captain');
                this.$count.css('color', capitao ? "#1aff1a" : "yellow");
                this.$count.text(Math.ceil(faltaMs / 1000));
            }
        } catch (e) {}

        try {
            const metodo = this.METODOS.find(m => m.id === this.metodo) || this.METODOS[0];
            const ultima = this.stats.ultimaRecolhaAt
                ? new Date(this.stats.ultimaRecolhaAt).toLocaleTimeString() : '—';
            uw.$('#af_estado').html(
                metodo.label + '<br>' +
                (this.ativo
                    ? '<span style="color:#1a6b2a;font-weight:bold;">● ATIVO</span>'
                    : '<span style="color:#c0392b;font-weight:bold;">● PARADO</span>') +
                ' · Próxima recolha em <b>' + mm + ':' + ss + '</b><br>' +
                'Última recolha: <b>' + ultima + '</b> · Total: <b>' + this.stats.recolhas + '</b>'
            );
        } catch (e) {}
    };

    /* ════════════ 3. LIGAR / DESLIGAR ════════════ */

    toggle = () => {
        if (this.ativo) this.desligar();
        else this.ligar();
    };

    ligar = () => {
        if (this.ativo) return;
        this.ativo = true;
        this.storage.save('af_active', true);
        this._janelaAberta = false;
        // Primeira recolha: ~10–15s (opções 1/2) ou 20–90s (opção humano)
        this._proximaRecolha = Date.now() + (this.metodo === 'humano'
            ? 20000 + Math.random() * 70000
            : 10000 + Math.random() * 5000);
        this.atualizarBotoes();
        this.console.log('[AutoFarm] Ligado — recolha a cada 10 minutos (' +
            (this.METODOS.find(m => m.id === this.metodo) || this.METODOS[0]).label + ').');
        this._tickId = this.createGuardedInterval(this._ciclo, 1000);
    };

    desligar = () => {
        this.ativo = false;
        this.storage.save('af_active', false);
        if (this._tickId) { clearInterval(this._tickId); this._tickId = null; }
        this.atualizarBotoes();
        this._mostrarEstado(0);
        this.console.log('[AutoFarm] Desligado.');
    };

    /* ════════════ 4. CICLO (1 segundo) ════════════ */

    _ciclo = async () => {
        if (!this.ativo || this._emRecolha) return;
        if (window.__multbot_captcha_active) return;

        const falta = Math.max(0, this._proximaRecolha - Date.now());
        this._mostrarEstado(falta);

        if (falta <= 0) await this._recolher();
    };

    /* Botão "Recolher já" — dispara a recolha no próximo tick */
    recolherJa = async () => {
        if (!this.ativo) {
            this.console.log('[AutoFarm] Liga primeiro o AutoFarm (clica no ícone).');
            return;
        }
        if (this._emRecolha) return;
        this.console.log('[AutoFarm] ⚡ Recolha manual.');
        this._proximaRecolha = Date.now();
    };

    /* ════════════ 5. RECOLHA (orquestração) ════════════ */

    _recolher = async () => {
        this._emRecolha = true;
        try {
            const cidades = this._cidadesParaRecolher();
            if (!cidades.length) {
                this.console.log('[AutoFarm] Nenhuma cidade elegível (sem aldeias rurais?).');
                return;
            }

            let ok = false;
            if (this.metodo === 'capitao') {
                ok = await this._recolherCapitao(cidades);
                if (!ok) this.console.log('[AutoFarm] Capitão indisponível/falhou — a usar cidade a cidade.');
            } else if (this.metodo === 'humano') {
                await this._recolherHumano(cidades);
                ok = true;
            }
            if (!ok) {
                await this._recolherIndividual(cidades);
            }
        } catch (e) {
            this.console.log('[AutoFarm] Erro na recolha: ' + (e && e.message ? e.message : e));
        } finally {
            this._emRecolha = false;
            // Próxima recolha:
            //  Opções 1/2 — 10 min + jitter 5–13s
            //  Opção 3    — intervalo aleatório entre 9,5 e 14 min
            this._proximaRecolha = Date.now() + (this.metodo === 'humano'
                ? this.HUMANO_MIN_MS + Math.random() * (this.HUMANO_MAX_MS - this.HUMANO_MIN_MS)
                : this.INTERVALO_MS + 5000 + Math.random() * this.JITTER_MS);
            this.stats.ultimaRecolhaAt = Date.now();
            this.storage.save('af_stats', this.stats);
        }
    };

    /* ════════════ 6. MÉTODOS ════════════ */

    /* OPÇÃO 1 — Capitão: recolha em lote (claim_loads_multiple).
       Retorna true se conseguiu, false se deve usar o fallback. */
    _recolherCapitao = async (cidades) => {
        try {
            // Aviso se o jogo diz que não há Capitão, mas NÃO bloqueamos —
            // a resposta real do servidor é que decide. Se o lote for aceite,
            // o Capitão está ativo (isAdvisorActivated às vezes falha).
            try {
                if (!uw.GameDataPremium.isAdvisorActivated('captain') && !this._avisoSemCapitao) {
                    this._avisoSemCapitao = true;
                    this.console.log('[AutoFarm] ⚠ Jogo reporta Capitão inativo — vou tentar o lote na mesma.');
                }
            } catch (e) {}

            const ids = cidades.map(c => parseInt(c.id, 10));

            // Janela de farm simulada (refeita se falhou na sessão)
            if (!this._janelaAberta) {
                await this.fakeOpening();
                await this.sleep(1200, 300);
                await this.fakeSelectAll(ids);
                this._janelaAberta = true;
                await this.sleep(1200, 300);
            }

            // Lotes de cidades com pausa curta entre eles.
            // base=600 (10 min) + booty=2400 (booty NÃO aceita 600).
            let lotesOk = 0, lotesFalha = 0;
            for (let i = 0; i < ids.length; i += this.BATCH_SIZE) {
                const lote = ids.slice(i, i + this.BATCH_SIZE);
                try {
                    await this.claimMultiple(lote, this.TIME_OPTION, this.TIME_OPTION_BOOTY);
                    lotesOk++;
                } catch (e) {
                    // 2ª tentativa com a janela reaberta (às vezes a sessão
                    // expira e um fakeOpening resolve)
                    try {
                        this._janelaAberta = false;
                        await this.fakeOpening();
                        await this.sleep(1200, 300);
                        await this.fakeSelectAll(lote);
                        await this.sleep(1200, 300);
                        await this.claimMultiple(lote, this.TIME_OPTION, this.TIME_OPTION_BOOTY);
                        lotesOk++;
                    } catch (e2) {
                        lotesFalha++;
                        this.console.log('[AutoFarm] ⚠ Lote ' + (lotesOk + lotesFalha) + ' falhou: ' +
                            (e2 && e2.message ? e2.message : e2));
                    }
                }
                if (i + this.BATCH_SIZE < ids.length) await this.sleep(this.LOTE_PAUSA_MS, 300);
            }

            if (lotesOk === 0) {
                this._janelaAberta = false;
                return false; // fallback para cidade a cidade
            }

            const recolhidas = lotesOk * this.BATCH_SIZE;
            this.stats.recolhas += Math.min(recolhidas, cidades.length);
            this.console.log('[AutoFarm] 🧭 ' + cidades.length + ' cidade(s) recolhida(s) via Capitão (' +
                lotesOk + ' lote(s) OK, ' + lotesFalha + ' falha(s)).');
            this._aposRecolha();
            return true;
        } catch (e) {
            this._janelaAberta = false;
            this.console.log('[AutoFarm] Erro no modo Capitão: ' + (e && e.message ? e.message : e));
            return false;
        }
    };

    /* OPÇÃO 2 — Cidade a cidade: claim individual por aldeia rural. */
    _recolherIndividual = async (cidades) => {
        let contador = 0;
        try {
            const { models: relacoes } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
            const { models: aldeias } = uw.MM.getOnlyCollectionByName('FarmTown');
            const agora = Math.floor(Date.now() / 1000);

            // Mapa aldeia_rural_id -> 'x:y' (ilha)
            const ilhaDaAldeia = new Map();
            for (const f of aldeias) {
                ilhaDaAldeia.set(String(f.attributes.id), f.attributes.island_x + ':' + f.attributes.island_y);
            }

            for (const c of cidades) {
                const town = uw.ITowns.towns[c.id];
                if (!town) continue;
                const chaveIlha = town.getIslandCoordinateX() + ':' + town.getIslandCoordinateY();

                for (const rel of relacoes) {
                    const a = rel.attributes;
                    if (ilhaDaAldeia.get(String(a.farm_town_id)) !== chaveIlha) continue;
                    if (a.relation_status !== 1) continue;
                    if (a.lootable_at !== null && a.lootable_at !== undefined && agora < a.lootable_at) continue;

                    await this.claimSingle(parseInt(c.id, 10), a.farm_town_id, rel.id, 1);
                    await this.sleep(this.ALDEIA_PAUSA_MS);
                    contador++;
                }
            }

            this.stats.recolhas += contador;
            this.console.log('[AutoFarm] 👟 ' + contador + ' aldeia(s) recolhida(s) cidade a cidade.');
            this._aposRecolha();
        } catch (e) {
            this.console.log('[AutoFarm] Erro no modo individual: ' + (e && e.message ? e.message : e));
            this.stats.recolhas += contador;
        }
    };

    _aposRecolha = () => {
        try { this.fakeUpdate(); } catch (e) {}
        try {
            setTimeout(function () {
                uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers();
            }, 2000);
        } catch (e) {}
    };

    /* OPÇÃO 3 — Loop humano: nenhum tempo é igual ao anterior.
         • Intervalo entre ciclos: 9,5–14 min (aleatório)
         • Pausa entre aldeias: 1,2–4,5s (aleatória)
         • 8% de chance de "distração" (pausa de 6–15s)
         • 5% de chance de adiar 1 aldeia para o próximo ciclo
         • Ordem de cidades e aldeias embaralhada a cada ciclo
         • Abre a janela de farm antes de começar (como um humano) */
    _recolherHumano = async (cidades) => {
        let contador = 0;
        try {
            // Humano abre primeiro a janela do farm
            await this.fakeOpening();
            await this.sleep(1500, 800);

            const { models: relacoes } = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation');
            const { models: aldeias } = uw.MM.getOnlyCollectionByName('FarmTown');
            const agora = Math.floor(Date.now() / 1000);

            // Mapa aldeia_rural_id -> 'x:y' (ilha)
            const ilhaDaAldeia = new Map();
            for (const f of aldeias) {
                ilhaDaAldeia.set(String(f.attributes.id), f.attributes.island_x + ':' + f.attributes.island_y);
            }

            // Embaralha a ordem das cidades (diferente a cada ciclo)
            const fila = [...cidades];
            for (let i = fila.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [fila[i], fila[j]] = [fila[j], fila[i]];
            }

            for (const c of fila) {
                const town = uw.ITowns.towns[c.id];
                if (!town) continue;
                const chaveIlha = town.getIslandCoordinateX() + ':' + town.getIslandCoordinateY();

                // Aldeias prontas desta ilha, também embaralhadas
                const prontas = [];
                for (const rel of relacoes) {
                    const a = rel.attributes;
                    if (ilhaDaAldeia.get(String(a.farm_town_id)) !== chaveIlha) continue;
                    if (a.relation_status !== 1) continue;
                    if (a.lootable_at !== null && a.lootable_at !== undefined && agora < a.lootable_at) continue;
                    prontas.push(rel);
                }
                for (let i = prontas.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [prontas[i], prontas[j]] = [prontas[j], prontas[i]];
                }

                for (const rel of prontas) {
                    // 5%: deixa esta aldeia para o próximo ciclo
                    if (Math.random() < this.HUMANO_SKIP_CHANCE) continue;

                    await this.claimSingle(parseInt(c.id, 10), rel.attributes.farm_town_id, rel.id, 1);
                    contador++;

                    // Pausa humana entre aldeias: 1,2–4,5s
                    const media = (this.HUMANO_CLAIM_MIN_MS + this.HUMANO_CLAIM_MAX_MS) / 2;
                    await this.sleep(media, media - this.HUMANO_CLAIM_MIN_MS);

                    // 8%: "distração" — pausa mais longa (6–15s)
                    if (Math.random() < this.HUMANO_DISTRACAO_CHANCE) {
                        const mediaD = (this.HUMANO_DISTRACAO_MIN_MS + this.HUMANO_DISTRACAO_MAX_MS) / 2;
                        await this.sleep(mediaD, mediaD - this.HUMANO_DISTRACAO_MIN_MS);
                    }
                }
            }

            this.stats.recolhas += contador;
            if (contador > 0) this.console.log('[AutoFarm] 🧑 ' + contador + ' aldeia(s) recolhida(s) em modo humano.');
            this._aposRecolha();
        } catch (e) {
            this.console.log('[AutoFarm] Erro no modo humano: ' + (e && e.message ? e.message : e));
            this.stats.recolhas += contador;
        }
    };

    /* ════════════ 7. DADOS ════════════ */

    /* Uma cidade por ilha — a que tem MAIS espaço no armazém.
       Ignora ilhas pequenas. */
    _cidadesParaRecolher = () => {
        const porIlha = new Map();
        try {
            const { models } = uw.MM.getOnlyCollectionByName('Town');
            for (const t of models) {
                const a = t.attributes;
                if (a.on_small_island) continue;
                const town = uw.ITowns.towns[a.id];
                if (!town) continue;

                const chave = town.getIslandCoordinateX() + ':' + town.getIslandCoordinateY();
                let enchimento = 1;
                try {
                    const r = town.resources();
                    enchimento = r.storage > 0 ? Math.min(r.wood, r.stone, r.iron) / r.storage : 1;
                } catch (e) {}

                if (!porIlha.has(chave)) porIlha.set(chave, []);
                porIlha.get(chave).push({ id: String(a.id), enchimento });
            }
        } catch (e) {
            return [];
        }

        const lista = [];
        for (const grupo of porIlha.values()) {
            grupo.sort((x, y) => x.enchimento - y.enchimento); // mais espaço primeiro
            lista.push(grupo[0]);
        }
        return lista;
    };

    /* ════════════ 8. ENDPOINTS (confirmados por captura real) ════════════ */

    /* Claim individual de uma aldeia rural */
    claimSingle = async (town_id, farm_town_id, relation_id, option) => {
        if (option === undefined) option = 1;
        const data = {
            model_url: 'FarmTownPlayerRelation/' + relation_id,
            action_name: 'claim',
            arguments: {
                farm_town_id: farm_town_id,
                type: 'resources',
                option: option,
            },
            town_id: town_id,
        };
        try {
            await this.ajaxPostWithTimeout('frontend_bridge', 'execute', data);
        } catch (e) {
            this.console.log('[AutoFarm] Erro ao coletar rural: ' + (e && e.message ? e.message : e));
        }
    };

    /* Claim em lote (Capitão) — time_option 600 = 10 min */
    claimMultiple = async (polis_list, base, boost) => {
        if (base === undefined) base = 600;
        if (boost === undefined) boost = 600;
        const town_id = uw.ITowns.getCurrentTown().id;
        const data = {
            towns: polis_list,
            time_option_base: base,
            time_option_booty: boost,
            claim_factor: 'normal',
            town_id: town_id,
            nl_init: true,
        };
        try {
            await this.ajaxPostWithTimeout('farm_town_overviews', 'claim_loads_multiple', data, 90000);
        } catch (e) {
            this.console.log('[AutoFarm] Erro em claimMultiple: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    /* Simula abertura da janela Farm Town Overview */
    fakeOpening = async () => {
        try {
            const town_id = uw.ITowns.getCurrentTown().id;
            await this.ajaxGetWithTimeout('farm_town_overviews', 'index', {
                town_id: town_id,
                nl_init: true,
            });
            await this.sleep(10);
            await this.fakeUpdate();
        } catch (e) {
            this.console.log('[AutoFarm] Erro em fakeOpening: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    /* Simula selecionar as cidades na janela */
    fakeSelectAll = async (town_ids) => {
        const town_id = uw.ITowns.getCurrentTown().id;
        const data = {
            town_ids: town_ids,
            town_id: town_id,
            nl_init: true,
        };
        try {
            await this.ajaxGetWithTimeout('farm_town_overviews', 'get_farm_towns_from_multiple_towns', data);
        } catch (e) {
            this.console.log('[AutoFarm] Erro em fakeSelectAll: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };

    /* Atualiza a janela (chamado ao abrir e após recolha) */
    fakeUpdate = async () => {
        const town = uw.ITowns.getCurrentTown();
        const researches = town.getResearches() && town.getResearches().attributes ? town.getResearches().attributes : {};
        const buildings = town.getBuildings() && town.getBuildings().attributes ? town.getBuildings().attributes : {};
        const data = {
            island_x: town.getIslandCoordinateX(),
            island_y: town.getIslandCoordinateY(),
            current_town_id: town.id,
            booty_researched: researches.booty ? 1 : 0,
            diplomacy_researched: researches.diplomacy ? 1 : 0,
            trade_office: buildings.trade_office ? 1 : 0,
            town_id: town.id,
            nl_init: true,
        };
        try {
            await this.ajaxGetWithTimeout('farm_town_overviews', 'get_farm_towns_for_town', data);
        } catch (e) {
            this.console.log('[AutoFarm] Erro em fakeUpdate: ' + (e && e.message ? e.message : e));
            throw e;
        }
    };
};
