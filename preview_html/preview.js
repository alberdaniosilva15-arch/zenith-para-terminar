const SCREEN_META = [
  {
    group: "Passageiro",
    items: [
      ["splash_auth", "Acesso completo", "Entrar, criar conta, recuperar e redefinir"],
      ["passenger_home", "Inicio passageiro", "Pesquisa, rota, pedido, leilao e modais"],
      ["active_ride", "Corrida activa", "Escudo de seguranca, chat, voz e SOS"],
      ["wallet", "Carteira Zenith", "Movimentos, parceiros, QR, carregamento e adiantamento"],
      ["feed_social", "Feed social", "Zonas, tipos, temporizador, expiracao e apagar"],
      ["historico", "Historico", "Corridas, filtros e recibos"],
      ["contratos", "Contratos", "Clausulas, estado e assinatura"],
      ["precos", "Precos", "Mapa tarifario e zonas"],
      ["perfil", "Perfil", "Dados, IA, seguranca, score e convites"],
      ["pos_viagem_review", "Pos-viagem", "Fluxo de 6 passos com recibo"],
      ["referral", "Traz o Mano", "Codigo, partilha e historico"],
      ["zenith_score", "Zenith Score", "Score 0-1000, parceiros e recalculo"],
      ["fretamento", "Fretamento", "Marketplace premium de rotas, capacidade e orcamento"],
      ["mercadorias", "Mercadorias", "Industrial premium, urgencia, ajudantes e tracking"],
    ],
  },
  {
    group: "Operacao",
    items: [
      ["driver_home", "Cockpit motorista", "Nova corrida, viagem activa, IA, documentos, fadiga e SOS"],
      ["fleet_dashboard", "Painel frota", "Operacao, carros, acordos, facturacao e IA"],
      ["admin_dashboard", "Painel admin", "8 secoes com mapa, SOS, precos e seguranca"],
    ],
  },
  {
    group: "Suporte",
    items: [
      ["global_shell", "Estrutura global", "Base Imperial Black & Gold"],
      ["kaze_ai", "Kaze IA", "Assistente e atalhos"],
      ["escolar", "Escudo escolar", "Monitoria e partilha segura"],
    ],
  },
];

const NAVS = {
  passenger: [
    ["home", "home", "Inicio", "passenger_home.html"],
    ["social", "public", "Social", "feed_social.html"],
    ["precos", "sell", "Precos", "precos.html"],
    ["contrato", "assignment", "Contrato", "contratos.html"],
    ["rides", "history", "Corridas", "historico.html"],
    ["wallet", "account_balance_wallet", "Carteira", "wallet.html"],
    ["profile", "person", "Perfil", "perfil.html"],
  ],
  driver: [
    ["home", "home", "Cockpit", "driver_home.html"],
    ["social", "hub", "Zona", "feed_social.html"],
    ["rides", "route", "Activa", "active_ride.html"],
    ["wallet", "account_balance_wallet", "Carteira", "wallet.html"],
    ["profile", "person", "Perfil", "perfil.html"],
  ],
  fleet: [
    ["home", "apartment", "Frota", "fleet_dashboard.html"],
    ["wallet", "receipt_long", "Faturas", "fleet_dashboard.html"],
    ["profile", "person", "Perfil", "perfil.html"],
  ],
};

function icon(name, filled = false) {
  return `<span class="material-symbols-outlined${filled ? " filled" : ""}">${name}</span>`;
}

function fmtKz(value, withDecimals = false) {
  const opts = withDecimals
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 };
  return `${Number(value).toLocaleString("pt-AO", opts)} Kz`;
}

function headerBlock(kicker, title, subtitle, actions = "") {
  return `
    <header class="zr-header">
      <div class="zr-header-copy">
        <p class="zr-kicker">${kicker}</p>
        <h1 class="zr-title zr-title--sm">${title}</h1>
        ${subtitle ? `<p class="zr-subtitle">${subtitle}</p>` : ""}
      </div>
      ${actions ? `<div class="zr-inline">${actions}</div>` : ""}
    </header>
  `;
}

function bottomNav(navKey, activeKey) {
  if (!NAVS[navKey]) {
    return "";
  }

  return `
    <nav class="zr-bottom-nav">
      ${NAVS[navKey]
        .map(
          ([key, iconName, label, href]) => `
            <a class="zr-nav-link${key === activeKey ? " is-active" : ""}" href="${href}">
              ${icon(iconName, key === activeKey)}
              <span>${label}</span>
            </a>
          `,
        )
        .join("")}
    </nav>
  `;
}

function shellPage({ header, body, nav = "", appClass = "" }) {
  return `
    <div class="zr-shell">
      <div class="zr-app ${appClass}">
        ${header || ""}
        <main class="zr-main">${body}</main>
        ${nav}
      </div>
    </div>
  `;
}

function modal(id, title, subtitle, body, center = false) {
  return `
    <div class="zr-modal zr-hidden" id="${id}">
      <div class="zr-modal-card${center ? " zr-modal-card--center" : ""}">
        <div class="zr-modal-head">
          <div>
            <p class="zr-kicker">${title}</p>
            <h2 class="zr-section-title">${subtitle}</h2>
          </div>
          <button class="zr-icon-button" data-close="${id}">${icon("close")}</button>
        </div>
        ${body}
      </div>
    </div>
  `;
}

function stat(label, value, extra = "") {
  return `
    <div class="zr-stat">
      <div class="zr-stat-label">${label}</div>
      <div class="zr-stat-value">${value}</div>
      ${extra ? `<div class="zr-copy" style="margin-top:6px">${extra}</div>` : ""}
    </div>
  `;
}

function makeBars(rows) {
  return `
    <div class="zr-bars">
      ${rows
        .map(
          ([label, width, text]) => `
            <div class="zr-bar">
              <div class="zr-bar-label">${label}</div>
              <div class="zr-bar-track"><span style="width:${width}%"></span></div>
              <div class="zr-meta">${text}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function showToast(text) {
  let node = document.getElementById("zr-toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "zr-toast";
    node.style.position = "fixed";
    node.style.left = "50%";
    node.style.bottom = "112px";
    node.style.transform = "translateX(-50%)";
    node.style.padding = "12px 16px";
    node.style.borderRadius = "999px";
    node.style.background = "rgba(230,195,100,0.18)";
    node.style.border = "1px solid rgba(230,195,100,0.32)";
    node.style.color = "#fff8eb";
    node.style.fontSize = "11px";
    node.style.fontWeight = "800";
    node.style.textTransform = "uppercase";
    node.style.letterSpacing = "0.14em";
    node.style.zIndex = "99";
    node.style.backdropFilter = "blur(12px)";
    document.body.appendChild(node);
  }

  node.textContent = text;
  node.style.display = "block";
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    if (node) node.style.display = "none";
  }, 1800);
}

function bindModals(root) {
  root.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const modalId = button.getAttribute("data-open");
      const target = modalId && document.getElementById(modalId);
      if (target) target.classList.remove("zr-hidden");
    });
  });

  root.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const modalId = button.getAttribute("data-close");
      const target = modalId && document.getElementById(modalId);
      if (target) target.classList.add("zr-hidden");
    });
  });

  root.querySelectorAll(".zr-modal").forEach((modalNode) => {
    modalNode.addEventListener("click", (event) => {
      if (event.target === modalNode) {
        modalNode.classList.add("zr-hidden");
      }
    });
  });
}

function bindTabs(root) {
  const buttons = root.querySelectorAll("[data-tab-group]");
  const groups = [...new Set([...buttons].map((button) => button.getAttribute("data-tab-group")))];

  groups.forEach((groupName) => {
    if (!groupName) return;

    const groupButtons = [...root.querySelectorAll(`[data-tab-group="${groupName}"]`)];
    const groupPanels = [...root.querySelectorAll(`[data-panel-group="${groupName}"]`)];

    const activate = (target) => {
      groupButtons.forEach((button) => {
        button.classList.toggle("is-active", button.getAttribute("data-tab-target") === target);
      });
      groupPanels.forEach((panel) => {
        panel.hidden = panel.getAttribute("data-panel") !== target;
      });
    };

    groupButtons.forEach((button) => {
      button.addEventListener("click", () => activate(button.getAttribute("data-tab-target")));
    });

    const initial = groupButtons.find((button) => button.classList.contains("is-active")) || groupButtons[0];
    if (initial) activate(initial.getAttribute("data-tab-target"));
  });
}

function bindSelectableCards(root, selector) {
  root.querySelectorAll(selector).forEach((button) => {
    button.addEventListener("click", () => {
      const parent = button.parentElement;
      if (!parent) return;
      parent.querySelectorAll(selector).forEach((node) => node.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });
}

function bindPanic(root) {
  root.querySelectorAll(".js-panic-card").forEach((wrap) => {
    const idle = wrap.querySelector('[data-panic-stage="idle"]');
    const confirm = wrap.querySelector('[data-panic-stage="confirm"]');
    const sent = wrap.querySelector('[data-panic-stage="sent"]');
    const trigger = wrap.querySelector("[data-panic-trigger]");
    const cancel = wrap.querySelector("[data-panic-cancel]");
    const send = wrap.querySelector("[data-panic-send]");

    const setStage = (stage) => {
      [idle, confirm, sent].forEach((node) => node && node.classList.add("zr-hidden"));
      const node = wrap.querySelector(`[data-panic-stage="${stage}"]`);
      if (node) node.classList.remove("zr-hidden");
    };

    if (trigger) trigger.addEventListener("click", () => setStage("confirm"));
    if (cancel) cancel.addEventListener("click", () => setStage("idle"));
    if (send) send.addEventListener("click", () => setStage("sent"));
  });
}

function bindCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copiado");
      } catch (_error) {
        showToast("Nao foi possivel copiar");
      }
    });
  });
}

function renderIndex(root) {
  const first = SCREEN_META[0].items[1][0];
  root.innerHTML = `
    <div class="zr-hub">
      <aside class="zr-hub-sidebar">
        <h1 class="zr-hub-logo">Zenith Ride</h1>
        <p class="zr-hub-copy">
          Hub final dos previews HTML. Todos os ecras aqui apontam para a pasta
          <code>preview_html</code> e usam a mesma linguagem Imperial Black &amp; Gold.
        </p>
        ${SCREEN_META.map(
          (group) => `
            <section class="zr-hub-group">
              <h2>${group.group}</h2>
              <div class="zr-hub-list">
                ${group.items
                  .map(
                    ([id, title, desc], index) => `
                      <button class="zr-hub-item${group === SCREEN_META[0] && index === 1 ? " is-active" : ""}" data-preview="${id}.html">
                        <strong>${title}</strong>
                        <span>${desc}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </section>
          `,
        ).join("")}
      </aside>
      <main class="zr-hub-main">
        <div class="zr-device-frame">
          <iframe title="Preview Zenith Ride" src="${first}.html"></iframe>
        </div>
      </main>
    </div>
  `;

  const iframe = root.querySelector("iframe");
  root.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll("[data-preview]").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      if (iframe) iframe.src = button.getAttribute("data-preview");
    });
  });
}

function renderGlobalShell(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Layout soberano",
      "Chegada Soberana",
      "Shell global do futuro frontend, agora todo em portugues, com fundo preto profundo, ouro Zenith e navegaçao coerente.",
      `
        <div class="zr-avatar">Z</div>
      `,
    ),
    body: `
      <section class="zr-card zr-card--hero">
        <p class="zr-kicker">Bem-vindo de volta</p>
        <h2 class="zr-title zr-title--lg">Tudo pronto para a tua proxima deslocacao.</h2>
        <p class="zr-subtitle">
          Viaturas, condutores, pagamentos, seguranca e historico vivem no mesmo shell.
        </p>
        <div class="zr-inline" style="margin-top:18px">
          <a class="zr-button" href="passenger_home.html">${icon("bolt")} Pedir viatura</a>
          <a class="zr-button zr-button--ghost" href="fleet_dashboard.html">${icon("directions_car")} Ver frota</a>
        </div>
      </section>
      <section class="zr-grid zr-grid--3">
        ${stat("Destino seguinte", "Talatona", "The Club - 21:00")}
        ${stat("Protocolo", "Activo", "Kaze, dados e SOS prontos")}
        ${stat("Saldo Zenith", "12.440", "Creditos e carteira ligados")}
      </section>
      <section class="zr-card">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Navegacao</p>
            <h2 class="zr-section-title">Estrutura com troca de papel e atalhos</h2>
          </div>
          ${icon("smart_toy", true)}
        </div>
        <div class="zr-inline" style="margin-top:14px">
          <span class="zr-chip zr-chip--gold">Passageiro</span>
          <span class="zr-chip">Motorista</span>
          <span class="zr-chip">Frota</span>
          <span class="zr-chip zr-chip--info">${icon("signal_cellular_alt")} Modo dados</span>
          <span class="zr-chip zr-chip--success">${icon("verified_user")} Sessao segura</span>
        </div>
      </section>
    `,
    nav: bottomNav("passenger", "home"),
  });
}

function renderSplashAuth(root) {
  root.innerHTML = `
    <div class="zr-shell">
      <div class="zr-app zr-app--login">
        <main class="zr-main" style="padding-top:20px;padding-bottom:20px">
          <section class="zr-card zr-card--hero">
            <div class="zr-inline" style="justify-content:center;margin-bottom:16px">
              <div class="zr-avatar zr-avatar--lg">Z</div>
            </div>
            <p class="zr-kicker" style="text-align:center">Acesso Zenith</p>
            <h1 class="zr-title" style="text-align:center">Introduz as tuas credenciais</h1>
            <p class="zr-subtitle" style="text-align:center">
              Fluxo completo de entrada, registo, recuperacao, redefinicao, Google e escolha de papel.
            </p>
            <div class="zr-tabs" style="margin-top:18px">
              <button class="zr-tab is-active" data-tab-group="auth-view" data-tab-target="signin">Entrar</button>
              <button class="zr-tab" data-tab-group="auth-view" data-tab-target="signup">Criar conta</button>
              <button class="zr-tab" data-tab-group="auth-view" data-tab-target="forgot">Recuperar</button>
            </div>

            <div class="zr-stack" style="margin-top:18px">
              <section data-panel-group="auth-view" data-panel="signin">
                <p class="zr-label">Entrar como</p>
                <div class="zr-role-grid" data-auth-role-wrap="signin">
                  <button class="zr-role-card is-active" data-auth-role-target="signin" data-auth-role="passenger">${icon("person")} Passageiro</button>
                  <button class="zr-role-card" data-auth-role-target="signin" data-auth-role="driver">${icon("two_wheeler")} Motorista</button>
                  <button class="zr-role-card" data-auth-role-target="signin" data-auth-role="fleet">${icon("apartment")} Frota</button>
                </div>
                <div class="zr-stack" style="margin-top:16px">
                  <div>
                    <label class="zr-label">Email</label>
                    <input class="zr-input" placeholder="exemplo@zenithride.ao" />
                  </div>
                  <div data-auth-password="signin" class="zr-hidden">
                    <label class="zr-label">Palavra-passe</label>
                    <input class="zr-input" type="password" placeholder="A tua palavra-passe" />
                  </div>
                  <p class="zr-copy" data-auth-copy="signin">
                    Os passageiros entram com link magico enviado por email.
                  </p>
                  <button class="zr-button zr-button--block" data-auth-primary="signin">Enviar link magico</button>
                  <button class="zr-button zr-button--light zr-button--block zr-hidden" data-auth-google="signin">
                    Google
                  </button>
                  <button class="zr-button zr-button--ghost zr-button--block" data-tab-group="auth-view" data-tab-target="reset">
                    Redefinir password
                  </button>
                </div>
              </section>

              <section data-panel-group="auth-view" data-panel="signup" hidden>
                <p class="zr-label">Criar conta como</p>
                <div class="zr-role-grid" data-auth-role-wrap="signup">
                  <button class="zr-role-card is-active" data-auth-role-target="signup" data-auth-role="passenger">${icon("person")} Passageiro</button>
                  <button class="zr-role-card" data-auth-role-target="signup" data-auth-role="driver">${icon("two_wheeler")} Motorista</button>
                  <button class="zr-role-card" data-auth-role-target="signup" data-auth-role="fleet">${icon("apartment")} Frota</button>
                </div>
                <div class="zr-stack" style="margin-top:16px">
                  <div>
                    <label class="zr-label">Nome completo</label>
                    <input class="zr-input" placeholder="Mario Bento" />
                  </div>
                  <div>
                    <label class="zr-label">Email</label>
                    <input class="zr-input" placeholder="mario@zenithride.ao" />
                  </div>
                  <div data-auth-password="signup" class="zr-hidden">
                    <label class="zr-label">Palavra-passe</label>
                    <input class="zr-input" type="password" placeholder="Minimo de 6 caracteres" />
                  </div>
                  <p class="zr-copy" data-auth-copy="signup">
                    Passageiros usam link magico; nao precisam de password.
                  </p>
                  <button class="zr-button zr-button--block">Criar conta</button>
                  <button class="zr-button zr-button--light zr-button--block zr-hidden" data-auth-google="signup">
                    Continuar com Google
                  </button>
                </div>
              </section>

              <section data-panel-group="auth-view" data-panel="forgot" hidden>
                <div class="zr-stack">
                  <div>
                    <label class="zr-label">Email de recuperacao</label>
                    <input class="zr-input" placeholder="exemplo@zenithride.ao" />
                  </div>
                  <p class="zr-copy">Enviamos um link seguro para redefinir a tua palavra-passe.</p>
                  <button class="zr-button zr-button--block">Enviar email de recuperacao</button>
                </div>
              </section>

              <section data-panel-group="auth-view" data-panel="reset" hidden>
                <div class="zr-stack">
                  <div>
                    <label class="zr-label">Nova palavra-passe</label>
                    <input class="zr-input" type="password" placeholder="Minimo de 6 caracteres" />
                  </div>
                  <div>
                    <label class="zr-label">Confirmar palavra-passe</label>
                    <input class="zr-input" type="password" placeholder="Repete a palavra-passe" />
                  </div>
                  <button class="zr-button zr-button--block">Actualizar password</button>
                  <button class="zr-button zr-button--ghost zr-button--block" data-tab-group="auth-view" data-tab-target="signin">Voltar ao login</button>
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>
  `;

  bindAuth(root);
}

function bindAuth(root) {
  const config = {
    signin: {
      passenger: {
        copy: "Os passageiros entram com link magico enviado por email.",
        primary: "Enviar link magico",
        password: false,
        google: false,
      },
      driver: {
        copy: "Motoristas entram com email e palavra-passe; Google continua disponivel.",
        primary: "Entrar",
        password: true,
        google: true,
      },
      fleet: {
        copy: "Donos de frota usam email e palavra-passe; Google aparece como alternativa.",
        primary: "Entrar",
        password: true,
        google: true,
      },
    },
    signup: {
      passenger: {
        copy: "Passageiros recebem um link magico para concluir o registo.",
        password: false,
        google: false,
      },
      driver: {
        copy: "Motoristas criam password agora e podem continuar com Google mais tarde.",
        password: true,
        google: true,
      },
      fleet: {
        copy: "Donos de frota ficam com acesso por password e Google.",
        password: true,
        google: true,
      },
    },
  };

  function apply(kind, role) {
    const rules = config[kind][role];
    const copy = root.querySelector(`[data-auth-copy="${kind}"]`);
    const password = root.querySelector(`[data-auth-password="${kind}"]`);
    const google = root.querySelector(`[data-auth-google="${kind}"]`);
    const primary = root.querySelector(`[data-auth-primary="${kind}"]`);
    if (copy) copy.textContent = rules.copy;
    if (password) password.classList.toggle("zr-hidden", !rules.password);
    if (google) google.classList.toggle("zr-hidden", !rules.google);
    if (primary && rules.primary) primary.textContent = rules.primary;
  }

  root.querySelectorAll("[data-auth-role-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const wrap = button.parentElement;
      if (wrap) {
        wrap.querySelectorAll(".zr-role-card").forEach((item) => item.classList.remove("is-active"));
      }
      button.classList.add("is-active");
      apply(button.getAttribute("data-auth-role-target"), button.getAttribute("data-auth-role"));
    });
  });

  apply("signin", "passenger");
  apply("signup", "passenger");
}

function renderPassengerHome(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Passageiro",
      "Luanda pronta para sair",
      "Pesquisa de locais, previsao de rota, pedido de corrida, leilao de motoristas e modais premium.",
      `
        <button class="zr-icon-button" data-open="modal-kaze" style="color:var(--color-gold); background:rgba(230,195,100,0.1); margin-right:8px">${icon("smart_toy", true)}</button>
        <span class="zr-chip zr-chip--gold">${icon("stars")} 5.0 Exclusive</span>
        <div class="zr-avatar">A</div>
      `,
    ),
    body: `
      <section class="zr-map">
        <div class="zr-curve"></div>
        <span class="zr-marker zr-marker--gold" style="top:34%;left:28%"></span>
        <span class="zr-marker zr-marker--danger" style="top:60%;left:70%"></span>
        <span class="zr-marker zr-marker--success zr-pulse" style="top:24%;left:58%"></span>
        <div class="zr-card" style="position:absolute;left:14px;right:14px;bottom:14px;background:rgba(10,10,10,0.82);padding:14px">
          <div class="zr-inline zr-inline--between">
            <div>
              <p class="zr-kicker">Mapa tactico</p>
              <p class="zr-copy">Marginal -> Talatona - rota estimada com trafego leve</p>
            </div>
            <span class="zr-chip zr-chip--success">${icon("near_me")} 12 motoristas</span>
          </div>
        </div>
      </section>

      <section class="zr-card zr-card--success">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Fidelidade Zenith</p>
            <h2 class="zr-section-title">Tens 3,5 km gratis</h2>
            <p class="zr-copy">Aplicados automaticamente na proxima corrida urbana.</p>
          </div>
          <span class="zr-chip zr-chip--success">Activo</span>
        </div>
        <div class="zr-progress" style="margin-top:14px"><div class="zr-progress-fill--success zr-progress-fill" style="width:72%"></div></div>
        <p class="zr-note" style="margin-top:8px">50 / 70 km ate ao proximo bonus de 5 km.</p>
      </section>

      <section class="zr-card zr-card--info">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Kaze preditivo</p>
            <h2 class="zr-section-title">Rota habitual detectada</h2>
            <p class="zr-copy">Boa tarde! Hoje encaixa perfeitamente na tua viagem para Mutamba.</p>
          </div>
          <span class="zr-chip zr-chip--gold">${fmtKz(6400)}</span>
        </div>
        <div class="zr-list" style="margin-top:14px">
          <div class="zr-list-item">
            <div class="zr-route-dots">
              <span class="dot dot--start"></span>
              <span class="line"></span>
              <span class="dot dot--end"></span>
            </div>
            <div style="flex:1">
              <strong style="display:block">Camama, Luanda</strong>
              <span class="zr-copy">Mutamba, Ingombota</span>
            </div>
            <button class="zr-button zr-button--sm">Usar agora</button>
          </div>
        </div>
      </section>

      <section class="zr-card">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Acesso rapido</p>
            <h2 class="zr-section-title">Overlays e modais do passageiro</h2>
          </div>
          ${icon("widgets", true)}
        </div>
        <div class="zr-scroll-x" style="margin-top:14px">
          <button class="zr-option is-active" data-open="modal-location"><strong>Pesquisar locais</strong><span>GPS, historico e locais populares</span></button>
          <button class="zr-option" data-open="modal-schedule"><strong>Agendar</strong><span>Data, hora e recorrencia</span></button>
          <button class="zr-option" data-open="modal-cargo"><strong>Mercadorias</strong><span>Carga, ajudantes e urgencia</span></button>
          <button class="zr-option" data-open="modal-charter"><strong>Fretamento</strong><span>Evento, capacidade e rota</span></button>
          <button class="zr-option" data-open="modal-private"><strong>Privado 24h</strong><span>Horas, classe e motorista favorito</span></button>
          <button class="zr-option" data-open="modal-review"><strong>Pos-viagem</strong><span>Avaliacao e recibo</span></button>
        </div>
      </section>

      <section class="zr-card">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Previsao da rota</p>
            <h2 class="zr-section-title">Trajecto inteligente</h2>
          </div>
          <span class="zr-chip zr-chip--gold">Rota real</span>
        </div>
        <div class="zr-list" style="margin-top:14px">
          <div class="zr-list-item zr-list-item--interactive" data-open="modal-location">
            <div class="zr-route-dots">
              <span class="dot dot--start"></span>
            </div>
            <div style="flex:1">
              <strong style="display:block">Marginal de Luanda</strong>
              <span class="zr-copy">Partida actual com GPS e reverse geocode</span>
            </div>
            <span class="zr-chip zr-chip--info">12 proximos</span>
          </div>
          <div class="zr-list-item">
            <div style="width:34px"></div>
            <div style="flex:1">
              <span class="zr-chip zr-chip--muted">14,6 km - 28 min</span>
            </div>
            <span class="zr-chip zr-chip--gold">Preco fixo</span>
          </div>
          <div class="zr-list-item zr-list-item--interactive" data-open="modal-location">
            <div class="zr-route-dots">
              <span class="dot dot--end"></span>
            </div>
            <div style="flex:1">
              <strong style="display:block">Belas Shopping</strong>
              <span class="zr-copy">Destino final com preview de tarifa por zona</span>
            </div>
            <strong style="font-size:16px">${fmtKz(6400)}</strong>
          </div>
        </div>
      </section>

      <section class="zr-card zr-card--hero">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Pedido de corrida</p>
            <h2 class="zr-section-title">Pedido de corrida e negociacao</h2>
          </div>
          <span class="zr-chip zr-chip--warning">Preco bloqueado 01:42</span>
        </div>
        <div class="zr-scroll-x" style="margin-top:14px">
          ${[
            ["Taxi", "Imediato", true],
            ["Moto", "Agil", false],
            ["Comfort", "Mais espaco", false],
            ["XL", "Grupo", false],
            ["Privado 24h", "Premium", false],
            ["Fretamento", "Marketplace", false],
            ["Mercadorias", "Industrial", false],
          ]
            .map(
              ([title, subtitle, active]) => `
                <button class="zr-option${active ? " is-active" : ""}" data-service-card>
                  <strong>${title}</strong>
                  <span>${subtitle}</span>
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="zr-grid zr-grid--2" style="margin-top:14px">
          <div class="zr-alert-box">
            <p class="zr-kicker">Preco estimado</p>
            <h3 class="zr-title zr-title--sm">${fmtKz(6800)}</h3>
            <p class="zr-copy">Distancia 14,6 km - trafego leve - seguro opcional +50 Kz</p>
          </div>
          <div class="zr-alert-box">
            <p class="zr-kicker">Pagamento</p>
            <div class="zr-inline" style="margin-top:6px">
              <span class="zr-chip zr-chip--gold">Saldo Zenith</span>
              <span class="zr-chip">Cash</span>
              <span class="zr-chip">Multicaixa</span>
            </div>
          </div>
        </div>
        <div class="zr-card" style="margin-top:14px;padding:14px;background:rgba(230,195,100,0.08)">
          <div class="zr-inline zr-inline--between">
            <div>
              <p class="zr-kicker">Negociacao</p>
              <p class="zr-copy">Motoristas proximos vao ver a tua proposta de 5.950 Kz.</p>
            </div>
            <span class="zr-chip zr-chip--gold">-12%</span>
          </div>
          <div class="zr-inline" style="margin-top:12px">
            <button class="zr-button zr-button--sm">Calcular preco</button>
            <button class="zr-button zr-button--sm zr-button--ghost">Lancar proposta</button>
            <button class="zr-button zr-button--sm zr-button--secondary">Pedir corrida</button>
          </div>
        </div>
      </section>

      <section class="zr-card">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Escolher motorista</p>
            <h2 class="zr-section-title">Escolha o teu motorista</h2>
          </div>
          <span class="zr-chip zr-chip--info">3 respostas</span>
        </div>
        <div class="zr-list" style="margin-top:14px">
          ${[
            ["Mateus Cambuta", "4,9 - 412 corridas - Diamante", "6 min", "7.200"],
            ["Neves Manuel", "4,8 - 230 corridas - Ouro", "8 min", "6.900"],
            ["Rui Antonio", "4,7 - 180 corridas - Comfort", "9 min", "6.800"],
          ]
            .map(
              ([name, meta, eta, price], index) => `
                <button class="zr-list-item zr-list-item--interactive${index === 0 ? " is-active" : ""}" data-driver-card style="text-align:left">
                  <div class="zr-inline">
                    <div class="zr-avatar">${name.charAt(0)}</div>
                    <div>
                      <strong style="display:block">${name}</strong>
                      <span class="zr-copy">${meta}</span>
                    </div>
                  </div>
                  <div style="text-align:right">
                    <strong style="display:block">${eta}</strong>
                    <span class="zr-copy">~ ${price} Kz</span>
                  </div>
                </button>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="zr-card zr-card--hero" style="background: linear-gradient(135deg, rgba(230,195,100,0.1), rgba(20,20,20,1)); border-color: rgba(230,195,100,0.3);">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker" style="color:var(--color-gold)">Traz o Mano</p>
            <h2 class="zr-section-title">Ganha ${fmtKz(500)} por amigo</h2>
            <p class="zr-copy">Partilha o teu link e ganhem descontos na primeira viagem.</p>
          </div>
          ${icon("card_giftcard")}
        </div>
        <div class="zr-inline" style="margin-top:14px">
          <button class="zr-button zr-button--sm zr-button--secondary" data-copy="https://zenithride.ao/invite/ARI24">${icon("content_copy")} Copiar</button>
          <a class="zr-button zr-button--sm" href="referral.html">Ver Convites</a>
        </div>
      </section>

      ${modal(
        "modal-location",
        "Pesquisar locais",
        "Pesquisa de locais em Luanda",
        `
          <div class="zr-stack">
            <div>
              <label class="zr-label">Pesquisa</label>
              <input class="zr-input" placeholder="De onde partes? ou para onde vais?" />
            </div>
            <button class="zr-button zr-button--secondary zr-button--block">${icon("my_location")} Usar a minha localizacao</button>
            <div class="zr-list">
              <div class="zr-list-item"><div><strong>Mutamba</strong><span class="zr-copy">Ingombota - popular</span></div><span class="zr-chip zr-chip--gold">1,2 km</span></div>
              <div class="zr-list-item"><div><strong>Talatona Centro</strong><span class="zr-copy">Distrito empresarial</span></div><span class="zr-chip">8,4 km</span></div>
              <div class="zr-list-item"><div><strong>Hospital Girassol</strong><span class="zr-copy">Servico</span></div><span class="zr-chip">5,1 km</span></div>
              <div class="zr-list-item"><div><strong>Viana Estacao</strong><span class="zr-copy">Bairro</span></div><span class="zr-chip">11,3 km</span></div>
            </div>
          </div>
        `,
      )}

      ${modal(
        "modal-schedule",
        "ScheduleRide",
        "Agendar corrida",
        `
          <div class="zr-stack">
            <div class="zr-alert-box zr-alert-box--info">
              <strong style="display:block">Marginal de Luanda</strong>
              <span class="zr-copy">Belas Shopping</span>
            </div>
            <div class="zr-grid zr-grid--2">
              <div><label class="zr-label">Data</label><input class="zr-input" type="date" value="2026-04-30" /></div>
              <div><label class="zr-label">Hora</label><input class="zr-input" type="time" value="08:15" /></div>
            </div>
            <div>
              <label class="zr-label">Repetir</label>
              <div class="zr-inline">
                <span class="zr-chip zr-chip--gold">Apenas uma vez</span>
                <span class="zr-chip">Todos os dias</span>
                <span class="zr-chip">Dias uteis</span>
                <span class="zr-chip">Semanal</span>
              </div>
            </div>
            <button class="zr-button zr-button--block">Agendar corrida</button>
          </div>
        `,
      )}

      <section class="zr-alert-box zr-alert-box--info" style="cursor:pointer" data-open="modal-auction">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="display:block">A aguardar motoristas...</strong>
            <span class="zr-copy">3 ofertas recebidas. Toca para ver.</span>
          </div>
          <span class="zr-chip zr-chip--gold">Leilão Activo</span>
        </div>
      </section>

      ${modal(
        "modal-cargo",
        "CargoModal",
        "Mercadorias Zenith",
        `
          <div class="zr-stack">
            <div class="zr-grid zr-grid--3">
              <span class="zr-chip zr-chip--gold">Leve &lt;50kg</span>
              <span class="zr-chip">Media 50-200kg</span>
              <span class="zr-chip">Pesada +200kg</span>
            </div>
            <div class="zr-grid zr-grid--2">
              <div><label class="zr-label">Ajudantes</label><input class="zr-input" value="2" /></div>
              <div><label class="zr-label">Urgencia</label><input class="zr-input" value="Express +30%" /></div>
            </div>
            <div class="zr-alert-box">
              <p class="zr-kicker">Estimativa</p>
              <h3 class="zr-title zr-title--sm">${fmtKz(38400)}</h3>
              <p class="zr-copy">Carga leve - 2 ajudantes - 14 km - acompanhamento depois</p>
            </div>
            <textarea class="zr-textarea" placeholder="Fragilidade, acesso ao edificio, contacto na entrega..."></textarea>
            <button class="zr-button zr-button--block">Notificar-me</button>
          </div>
        `,
      )}

      ${modal(
        "modal-charter",
        "CharterModal",
        "Fretamento Zenith",
        `
          <div class="zr-stack">
            <div class="zr-grid zr-grid--2">
              <span class="zr-chip zr-chip--gold">Empresa</span>
              <span class="zr-chip">Evento</span>
              <span class="zr-chip">Igreja</span>
              <span class="zr-chip">Escolar</span>
            </div>
            <div class="zr-grid zr-grid--3">
              <span class="zr-chip zr-chip--gold">20 pessoas</span>
              <span class="zr-chip">40 pessoas</span>
              <span class="zr-chip">60 pessoas</span>
            </div>
            <textarea class="zr-textarea" placeholder="Pickup, paragens e destino final. Uma linha por paragem."></textarea>
            <div class="zr-alert-box">
              <p class="zr-kicker">Orcamento</p>
              <h3 class="zr-title zr-title--sm">${fmtKz(156000)}</h3>
              <p class="zr-copy">Marketplace premium com confirmacao humana.</p>
            </div>
            <button class="zr-button zr-button--block">Solicitar orcamento</button>
          </div>
        `,
      )}

      ${modal(
        "modal-private",
        "PrivateDriverModal",
        "Motorista Privado 24h",
        `
          <div class="zr-stack">
            <div class="zr-tabs">
              <button class="zr-tab is-active">Por horas</button>
              <button class="zr-tab">Dia inteiro</button>
            </div>
            <div class="zr-grid zr-grid--3">
              <span class="zr-chip zr-chip--gold">Standard</span>
              <span class="zr-chip">SUV</span>
              <span class="zr-chip">Executivo</span>
            </div>
            <div><label class="zr-label">Inicio do servico</label><input class="zr-input" type="datetime-local" value="2026-05-02T09:00" /></div>
            <div><label class="zr-label">Motorista favorito</label><input class="zr-input" value="Sem preferencia" /></div>
            <div class="zr-alert-box">
              <p class="zr-kicker">Preview</p>
              <h3 class="zr-title zr-title--sm">${fmtKz(72000)}</h3>
              <p class="zr-copy">Janela de 4 horas - destino flexivel - lista de lancamento.</p>
            </div>
            <button class="zr-button zr-button--block">Notificar-me primeiro</button>
          </div>
        `,
      )}

      ${modal(
        "modal-review",
        "PostRideReview",
        "Resumo do fluxo pos-viagem",
        `
          <div class="zr-stack">
            <div class="zr-stepper">
              <span class="zr-step is-active"></span>
              <span class="zr-step is-active"></span>
              <span class="zr-step is-active"></span>
              <span class="zr-step"></span>
              <span class="zr-step"></span>
              <span class="zr-step"></span>
            </div>
            <div class="zr-grid">
              <div class="zr-list-item"><strong>1.</strong><span class="zr-copy">Preparacao com dots animados</span></div>
              <div class="zr-list-item"><strong>2.</strong><span class="zr-copy">Resumo motorista + preco</span></div>
              <div class="zr-list-item"><strong>3.</strong><span class="zr-copy">5 estrelas com labels de Muito mau ate Excelente</span></div>
              <div class="zr-list-item"><strong>4.</strong><span class="zr-copy">Comentario opcional 200 chars</span></div>
              <div class="zr-list-item"><strong>5.</strong><span class="zr-copy">Feedback de preco em grelha 2x2</span></div>
              <div class="zr-list-item"><strong>6.</strong><span class="zr-copy">WhatsApp e Guardar no telemovel</span></div>
            </div>
            <a class="zr-button zr-button--block" href="pos_viagem_review.html">Abrir fluxo completo</a>
          </div>
        `,
      )}

      ${modal(
        "modal-kaze",
        "Kaze IA",
        "Como posso ajudar hoje?",
        `
          <div class="zr-stack">
            <div class="zr-chat" style="max-height: 400px; overflow-y: auto;">
              <div class="zr-bubble">Boa tarde. Consigo sugerir uma rota mais barata entre Mutamba e Talatona.</div>
              <div class="zr-bubble zr-bubble--self">Mostra-me tambem a zona com mais procura agora.</div>
              <div class="zr-bubble">Talatona e Maianga estao com o melhor equilibrio entre procura e oferta neste momento.</div>
            </div>
            <div class="zr-inline" style="overflow-x: auto; padding-bottom: 8px;">
              <span class="zr-chip">Previsao de preco</span>
              <span class="zr-chip">Zona quente</span>
              <span class="zr-chip">Seguranca</span>
            </div>
            <div class="zr-inline" style="gap: 8px">
              <input class="zr-input" placeholder="Pergunta ao Kaze..." style="flex: 1" />
              <button class="zr-button zr-button--primary">${icon("send")}</button>
            </div>
          </div>
        `
      )}

      ${modal(
        "modal-auction",
        "AuctionList",
        "Ofertas de motoristas",
        `
          <div class="zr-stack">
            <div class="zr-alert-box zr-alert-box--info" style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <p class="zr-kicker">A aguardar</p>
                <h3 class="zr-title zr-title--sm">A avaliar ofertas...</h3>
              </div>
            </div>

            <button class="zr-card is-active" style="display:flex; align-items:center; gap:16px; text-align:left; border-color:var(--color-gold); background:rgba(230,195,100,0.1); width:100%;">
              <div class="zr-avatar zr-avatar--lg">M</div>
              <div style="flex:1">
                <div class="zr-inline" style="margin-bottom:2px">
                  <strong style="display:block; font-size:14px">Mateus Cambuta</strong>
                  <span class="zr-chip zr-chip--gold" style="padding:2px 6px; font-size:9px">⚡ ELITE</span>
                </div>
                <div class="zr-inline" style="margin-top:4px">
                  <span class="zr-copy" style="color:var(--color-gold)">⭐ 4.9</span>
                  <span class="zr-copy" style="font-size:10px">842 corridas</span>
                  <span class="zr-chip" style="padding:2px 6px; font-size:9px">💎 Diamante</span>
                </div>
                <p class="zr-title zr-title--sm" style="color:var(--color-gold); margin-top:4px">${fmtKz(4500)}</p>
              </div>
              <div style="text-align:right">
                <strong style="display:block; font-size:14px">3 min</strong>
                <span class="zr-copy" style="font-size:10px">1.2 km</span>
              </div>
            </button>

            <button class="zr-card" style="display:flex; align-items:center; gap:16px; text-align:left; width:100%;">
              <div class="zr-avatar zr-avatar--lg" style="background:#222">P</div>
              <div style="flex:1">
                <div class="zr-inline" style="margin-bottom:2px">
                  <strong style="display:block; font-size:14px">Paulo Banza</strong>
                </div>
                <div class="zr-inline" style="margin-top:4px">
                  <span class="zr-copy" style="color:var(--color-gold)">⭐ 4.7</span>
                  <span class="zr-copy" style="font-size:10px">124 corridas</span>
                  <span class="zr-chip" style="padding:2px 6px; font-size:9px">⭐ Ouro</span>
                </div>
                <p class="zr-title zr-title--sm" style="margin-top:4px">${fmtKz(3800)}</p>
              </div>
              <div style="text-align:right">
                <strong style="display:block; font-size:14px">8 min</strong>
                <span class="zr-copy" style="font-size:10px">3.4 km</span>
              </div>
            </button>
            
            <button class="zr-button zr-button--block" style="margin-top:8px">Aceitar Mateus Cambuta</button>
            <button class="zr-button zr-button--ghost zr-button--block">Cancelar pedido</button>
          </div>
        `
      )}
    `,
    nav: bottomNav("passenger", "home"),
  });

  bindSelectableCards(root, "[data-service-card]");
  bindSelectableCards(root, "[data-driver-card]");
}

function renderActiveRide(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Corrida activa",
      "Mateus Cambuta a caminho",
      "Informacao completa da corrida, SOS, chat, chamada de voz e partilha ao vivo.",
      `<span class="zr-chip zr-chip--success">${icon("shield")} Escudo de seguranca</span>`,
    ),
    body: `
      <section class="zr-map">
        <div class="zr-curve"></div>
        <span class="zr-marker zr-marker--success zr-pulse" style="top:26%;left:54%"></span>
        <span class="zr-marker zr-marker--gold" style="top:52%;left:28%"></span>
        <span class="zr-marker zr-marker--danger" style="top:72%;left:74%"></span>
        <div class="zr-card" style="position:absolute;left:14px;right:14px;bottom:14px;background:rgba(10,10,10,0.82);padding:14px">
          <div class="zr-inline zr-inline--between">
            <div>
              <p class="zr-kicker">Estado da viagem</p>
              <p class="zr-copy">Motorista aceite - recolha em 6 min - matricula LD-54-88-ZR</p>
            </div>
            <span class="zr-chip zr-chip--gold">Aceite</span>
          </div>
        </div>
      </section>

      <section class="zr-card zr-card--hero">
        <div class="zr-inline zr-inline--between">
          <div class="zr-inline">
            <div class="zr-avatar zr-avatar--lg">M</div>
            <div>
              <p class="zr-kicker">Motorista</p>
              <h2 class="zr-section-title">Mateus Cambuta</h2>
              <p class="zr-copy">4,9 estrelas - Diamante - Toyota Corolla - LD-54-88-ZR</p>
            </div>
          </div>
          <span class="zr-chip zr-chip--success">6 min</span>
        </div>
        <div class="zr-progress" style="margin-top:16px">
          <div class="zr-progress-fill" style="width:46%"></div>
        </div>
        <div class="zr-inline" style="margin-top:14px">
          <span class="zr-chip zr-chip--gold">1. Aceite</span>
          <span class="zr-chip">2. Recolha</span>
          <span class="zr-chip">3. Em curso</span>
          <span class="zr-chip">4. Concluida</span>
        </div>
      </section>

      <section class="zr-card zr-card--info">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Chamada de voz</p>
            <h2 class="zr-section-title">Canal de voz da corrida</h2>
            <p class="zr-copy">VoIP pronto para chamada directa com o motorista.</p>
          </div>
          <button class="zr-button zr-button--sm zr-button--secondary">${icon("call")} Ligar</button>
        </div>
      </section>

      <section class="zr-card zr-card--success">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Partilha ao vivo</p>
            <h2 class="zr-section-title">Acompanhamento de Corrida</h2>
            <p class="zr-copy">Link publico seguro com expiracao de 4 horas e canal SOS directo.</p>
          </div>
          <span class="zr-chip zr-chip--success">${icon("share")} Activo</span>
        </div>
        <div class="zr-alert-box" style="margin-top:14px; word-break: break-all;">
          <strong style="display:block">https://zenithride.ao/live/ZR-2026-LIVE-4488</strong>
          <span class="zr-copy">Podes partilhar com os teus contactos de confianca.</span>
        </div>
        <div class="zr-inline" style="margin-top:14px">
          <button class="zr-button zr-button--sm zr-button--success" data-copy="https://zenithride.ao/live/ZR-2026-LIVE-4488">
            ${icon("content_copy")} Copiar Link
          </button>
          <a class="zr-button zr-button--sm zr-button--secondary" href="#">
            ${icon("chat")} WhatsApp
          </a>
        </div>
      </section>

      <section class="zr-card">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Chat da corrida</p>
            <h2 class="zr-section-title">Mensagens em tempo real</h2>
          </div>
          <span class="zr-chip zr-chip--info">Numero protegido</span>
        </div>
        <div class="zr-chat" style="margin-top:14px">
          <div class="zr-bubble">Ja estou a sair do semaforo da Samba. Chego em 6 minutos.</div>
          <div class="zr-bubble zr-bubble--self">Perfeito. Estou na entrada principal.</div>
          <div class="zr-bubble">Recebido. Mantem o telefone disponivel se eu nao te vir.</div>
        </div>
        <div class="zr-inline" style="margin-top:14px">
          <span class="zr-chip">Estou a caminho</span>
          <span class="zr-chip">Onde estas exactamente?</span>
          <span class="zr-chip">Aguarda 2 min</span>
        </div>
      </section>

      <section class="zr-card js-panic-card">
        <div data-panic-stage="idle">
          <p class="zr-kicker">Botao SOS</p>
          <h2 class="zr-section-title">SOS com confirmacao</h2>
          <p class="zr-copy">Contagem, audio, WhatsApp e atalhos para 113 / 112.</p>
          <button class="zr-button zr-button--danger zr-button--block" style="margin-top:16px" data-panic-trigger>
            ${icon("warning")} Botao de panico
          </button>
        </div>
        <div data-panic-stage="confirm" class="zr-hidden">
          <p class="zr-kicker">Confirmacao</p>
          <h2 class="zr-section-title">Toca de novo para enviar o alerta</h2>
          <p class="zr-copy">A localizacao vai por WhatsApp e o audio fica gravado durante 30s.</p>
          <div class="zr-inline" style="margin-top:16px">
            <button class="zr-button zr-button--danger" data-panic-send">Enviar SOS</button>
            <button class="zr-button zr-button--secondary" data-panic-cancel">Cancelar</button>
          </div>
        </div>
        <div data-panic-stage="sent" class="zr-hidden">
          <p class="zr-kicker">Alerta enviado</p>
          <h2 class="zr-section-title">Contacto notificado</h2>
          <p class="zr-copy">Audio em curso - localizacao partilhada - Escudo de seguranca a acompanhar.</p>
          <div class="zr-inline" style="margin-top:16px">
            <a class="zr-button zr-button--danger zr-button--sm" href="tel:113">Ligar 113</a>
            <a class="zr-button zr-button--secondary zr-button--sm" href="tel:112">Ligar 112</a>
          </div>
        </div>
      </section>
    `,
    nav: bottomNav("passenger", "rides"),
  });

}

function renderDriverHome(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Motorista",
      "Cockpit operacional",
      "Nova corrida, viagem activa, IA de zona, documentos, fadiga, acordo e SOS.",
      `
        <button class="zr-icon-button" data-open="modal-kaze" style="color:var(--color-gold); background:rgba(230,195,100,0.1); margin-right:8px">${icon("smart_toy", true)}</button>
        <span class="zr-chip zr-chip--success">${icon("toggle_on", true)} Online</span>
        <div class="zr-avatar">D</div>
      `,
    ),
    body: `
      <section class="zr-card zr-card--warning">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Nova corrida</p>
            <h2 class="zr-section-title">Nova corrida disponivel</h2>
            <p class="zr-copy">Origem Kinaxixi -> Ilha - 7,8 km - ${fmtKz(6200)}</p>
          </div>
          <span class="zr-chip zr-chip--warning">Persistente</span>
        </div>
        <div class="zr-inline" style="margin-top:16px">
          <button class="zr-button zr-button--secondary">Ignorar</button>
          <button class="zr-button">Aceitar</button>
        </div>
      </section>

      <section class="zr-alert-box zr-alert-box--warning">
        <p class="zr-kicker">DocExpiryBanner</p>
        <strong style="display:block">Documentos a expirar em 6 dias</strong>
        <p class="zr-copy">Actualiza BI e viatura antes de ficares offline.</p>
        <button class="zr-button zr-button--ghost zr-button--sm" style="margin-top:12px" data-open="modal-docs">Actualizar documentos</button>
      </section>

      <section class="zr-alert-box zr-alert-box--warning">
        <p class="zr-kicker">FatigueAlert</p>
        <strong style="display:block">Para 10 min.</strong>
        <p class="zr-copy">Depois de 4 horas continuas, a eficiencia costuma cair.</p>
      </section>

      <section class="zr-alert-box zr-alert-box--info">
        <p class="zr-kicker">MinIncomeGuard</p>
        <strong style="display:block">Muda para Talatona</strong>
        <p class="zr-copy">+38% chance de corrida - 67 min sem nova viagem.</p>
      </section>

      <section class="zr-card zr-card--hero">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Corrida activa</p>
            <h2 class="zr-section-title">Corrida activa</h2>
            <p class="zr-copy">Mutamba -> Benfica - Passageiro Naila Manuel - estado A recolher</p>
          </div>
          <span class="zr-chip zr-chip--gold">A caminho</span>
        </div>
        <div class="zr-inline" style="margin-top:16px">
          <button class="zr-button zr-button--secondary">${icon("call")} Chamar</button>
          <button class="zr-button zr-button--secondary">${icon("chat")} Chat</button>
        </div>
        <button class="zr-button zr-button--block" style="margin-top:14px">Cheguei ao cliente</button>
        <button class="zr-button zr-button--ghost zr-button--block" style="margin-top:10px">Cancelar corrida</button>
      </section>

      <section class="zr-card zr-card--info">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Copiloto Zenith</p>
            <h2 class="zr-section-title">Zona quente sugerida</h2>
            <p class="zr-copy">Vai 3,2 km para Maianga -> +42% chance de corrida.</p>
          </div>
          <div class="zr-avatar">-></div>
        </div>
      </section>

      <section class="zr-card">
        <p class="zr-kicker">Nivel do motorista</p>
        <h2 class="zr-section-title">Nivel 3 - Motorista Privado</h2>
        <p class="zr-copy">Rating 4,8 - 312 corridas - Ouro - Zenith Score 712</p>
        ${makeBars([
          ["Rating", 89, "4.8/5"],
          ["Corridas", 78, "312"],
          ["Nivel", 75, "Ouro"],
        ])}
      </section>

      <section class="zr-card">
        <div class="zr-inline zr-inline--between">
          <div>
            <p class="zr-kicker">Canal da zona</p>
            <h2 class="zr-section-title">Canal de zona</h2>
          </div>
          <span class="zr-chip">Maianga</span>
        </div>
        <div class="zr-chat" style="margin-top:14px">
          <div class="zr-bubble zr-bubble--system">Kaze: pico a subir em Talatona agora.</div>
          <div class="zr-bubble">Zeca: estrada da Samba com fila media.</div>
          <div class="zr-bubble zr-bubble--self">Vou reposicionar para Miramar.</div>
        </div>
      </section>

      <section class="zr-card js-panic-card">
        <div data-panic-stage="idle">
          <p class="zr-kicker">SOS motorista</p>
          <h2 class="zr-section-title">Escudo de seguranca pronto</h2>
          <p class="zr-copy">Triplo toque silencioso, WhatsApp, audio e ligacao directa.</p>
          <div class="zr-inline" style="margin-top:16px">
            <button class="zr-button zr-button--danger" data-panic-trigger>${icon("warning")} Abrir SOS</button>
            <button class="zr-button zr-button--ghost" data-open="modal-agreement">Acordo de frota</button>
          </div>
        </div>
        <div data-panic-stage="confirm" class="zr-hidden">
          <h2 class="zr-section-title">Confirmar envio do alerta</h2>
          <p class="zr-copy">O contacto vai receber a tua posicao e o audio comeca a gravar.</p>
          <div class="zr-inline" style="margin-top:14px">
            <button class="zr-button zr-button--danger" data-panic-send>Enviar</button>
            <button class="zr-button zr-button--secondary" data-panic-cancel>Cancelar</button>
          </div>
        </div>
        <div data-panic-stage="sent" class="zr-hidden">
          <h2 class="zr-section-title">SOS activo</h2>
          <p class="zr-copy">Alerta critico emitido. Linha 113 e 112 visiveis abaixo.</p>
          <div class="zr-inline" style="margin-top:14px">
            <a class="zr-button zr-button--danger zr-button--sm" href="tel:113">113</a>
            <a class="zr-button zr-button--secondary zr-button--sm" href="tel:112">112</a>
          </div>
        </div>
      </section>

      ${modal(
        "modal-docs",
        "DriverDocumentsForm",
        "Pacote documental",
        `
          <div class="zr-stack">
            <div class="zr-grid zr-grid--2">
              <div><label class="zr-label">Marca</label><input class="zr-input" value="Toyota" /></div>
              <div><label class="zr-label">Modelo</label><input class="zr-input" value="Corolla" /></div>
            </div>
            <div class="zr-grid zr-grid--2">
              <div><label class="zr-label">Matricula</label><input class="zr-input" value="LD-54-88-ZR" /></div>
              <div><label class="zr-label">Cor</label><input class="zr-input" value="Preto" /></div>
            </div>
            <div class="zr-alert-box">
              <strong style="display:block">Upload BI e livrete</strong>
              <span class="zr-copy">Camera / galeria -> Supabase Storage no app real.</span>
            </div>
            <button class="zr-button zr-button--block">Submeter actualizacao</button>
          </div>
        `,
      )}

      ${modal(
        "modal-agreement",
        "DriverAgreementModal",
        "Convite de frota pendente",
        `
          <div class="zr-stack">
            <div class="zr-grid">
              <button class="zr-option is-active" data-agreement-card><strong>Acordo minimo</strong><span>Activo / inactivo apenas</span></button>
              <button class="zr-option" data-agreement-card><strong>Acordo semanal</strong><span>Partilha parcial com blackout</span></button>
              <button class="zr-option" data-agreement-card><strong>Acordo transparente</strong><span>Operacao completa</span></button>
            </div>
            <div class="zr-grid zr-grid--2">
              <div><label class="zr-label">Blackout inicio</label><input class="zr-input" value="12:00" /></div>
              <div><label class="zr-label">Blackout fim</label><input class="zr-input" value="16:00" /></div>
            </div>
            <div class="zr-inline">
              <button class="zr-button">Aceitar</button>
              <button class="zr-button zr-button--secondary">Recusar</button>
            </div>
          </div>
        `,
        true,
      )}

      ${modal(
        "modal-kaze",
        "Kaze IA",
        "Como posso ajudar hoje?",
        `
          <div class="zr-stack">
            <div class="zr-chat" style="max-height: 400px; overflow-y: auto;">
              <div class="zr-bubble">Boa tarde. Consigo sugerir uma rota mais barata entre Mutamba e Talatona.</div>
              <div class="zr-bubble zr-bubble--self">Mostra-me tambem a zona com mais procura agora.</div>
              <div class="zr-bubble">Talatona e Maianga estao com o melhor equilibrio entre procura e oferta neste momento.</div>
            </div>
            <div class="zr-inline" style="overflow-x: auto; padding-bottom: 8px;">
              <span class="zr-chip">Previsao de preco</span>
              <span class="zr-chip">Zona quente</span>
              <span class="zr-chip">Seguranca</span>
            </div>
            <div class="zr-inline" style="gap: 8px">
              <input class="zr-input" placeholder="Pergunta ao Kaze..." style="flex: 1" />
              <button class="zr-button zr-button--primary">${icon("send")}</button>
            </div>
          </div>
        `
      )}
    `,
    nav: bottomNav("driver", "home"),
  });

  bindSelectableCards(root, "[data-agreement-card]");
}

function renderFleetDashboard(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Zenith Fleet",
      "Operacao da frota",
      "Visao operacional, lista detalhada de viaturas, facturacao, upgrade, IA e acordos.",
      `
        <button class="zr-button zr-button--sm" data-open="modal-add-car">+ Carro</button>
        <button class="zr-button zr-button--sm zr-button--secondary" data-open="modal-upgrade">Plano Pro</button>
      `,
    ),
    body: `
      <section class="zr-stat-grid">
        ${stat("Carros", "18")}
        ${stat("Activos", "11")}
        ${stat("Parados", "7")}
      </section>

      <section class="zr-card">
        <div class="zr-tabs">
          <button class="zr-tab is-active" data-tab-group="fleet-tabs" data-tab-target="overview">Operacao</button>
          <button class="zr-tab" data-tab-group="fleet-tabs" data-tab-target="billing">Faturacao</button>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="fleet-tabs" data-panel="overview">
          <div class="zr-map" style="min-height:170px">
            <span class="zr-marker zr-marker--success" style="top:26%;left:24%"></span>
            <span class="zr-marker zr-marker--success" style="top:38%;left:56%"></span>
            <span class="zr-marker zr-marker--danger" style="top:60%;left:68%"></span>
            <span class="zr-marker zr-marker--gold" style="top:48%;left:42%"></span>
          </div>
          <div class="zr-list">
            ${[
              ["LD-18-11-ZR", "Toyota Hiace - Paulo Banza", "Talatona - activo"],
              ["LD-09-22-ZR", "Toyota Corolla - Neves Manuel", "Ingombota - blackout activo"],
              ["LD-77-44-ZR", "Hyundai H1 - sem motorista", "Parado - patio"],
            ]
              .map(
                ([plate, meta, loc]) => `
                  <div class="zr-list-item">
                    <div>
                      <strong style="display:block">${plate}</strong>
                      <span class="zr-copy">${meta}</span>
                    </div>
                    <span class="zr-chip">${loc}</span>
                  </div>
                `,
              )
              .join("")}
          </div>

          <section class="zr-card zr-card--soft">
            <p class="zr-kicker">FleetCarList</p>
            <h2 class="zr-section-title">Viaturas detalhadas</h2>
            <div class="zr-list" style="margin-top:14px">
              <div class="zr-list-item"><div><strong>LD-18-11-ZR</strong><span class="zr-copy">Modelo Toyota Hiace - acordo semanal</span></div><span class="zr-chip zr-chip--success">Activo</span></div>
              <div class="zr-list-item"><div><strong>LD-09-22-ZR</strong><span class="zr-copy">Modelo Corolla - motorista associado</span></div><span class="zr-chip">Blackout</span></div>
              <div class="zr-list-item"><div><strong>LD-77-44-ZR</strong><span class="zr-copy">Modelo Hyundai H1 - sem acordo ainda</span></div><span class="zr-chip zr-chip--muted">Livre</span></div>
            </div>
          </section>

          <section class="zr-card zr-card--info">
            <p class="zr-kicker">IA de frota</p>
            <h2 class="zr-section-title">Kaze para gestao da frota</h2>
            <p class="zr-copy">Tens varios carros parados. Vale redistribuir para Talatona e Maianga antes do pico da tarde.</p>
            <textarea class="zr-textarea" style="margin-top:14px" placeholder="Qual carro esta a render menos hoje?"></textarea>
          </section>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="fleet-tabs" data-panel="billing" hidden>
          <section class="zr-kpi-grid">
            ${stat("Total mes", fmtKz(480000))}
            ${stat("Carros activos", "11")}
            ${stat("Custo/carro", fmtKz(43600))}
            ${stat("Plano", "Pro")}
          </section>
          <section class="zr-card">
            <p class="zr-kicker">FleetBilling</p>
            <h2 class="zr-section-title">Historico de pagamentos</h2>
            <div class="zr-list" style="margin-top:14px">
              <div class="zr-list-item"><div><strong>Abril 2026</strong><span class="zr-copy">Plano Pro - 11 carros</span></div><span class="zr-chip zr-chip--gold">${fmtKz(55000)}</span></div>
              <div class="zr-list-item"><div><strong>Marco 2026</strong><span class="zr-copy">Plano Pro - 10 carros</span></div><span class="zr-chip zr-chip--gold">${fmtKz(50000)}</span></div>
              <div class="zr-list-item"><div><strong>Fevereiro 2026</strong><span class="zr-copy">Plano Starter</span></div><span class="zr-chip">${fmtKz(20000)}</span></div>
            </div>
            <button class="zr-button zr-button--block" style="margin-top:14px">Download PDF</button>
          </section>
        </div>
      </section>

      ${modal(
        "modal-add-car",
        "FleetAddCar",
        "Adicionar viatura",
        `
          <div class="zr-stack">
            <div><label class="zr-label">Matricula</label><input class="zr-input" value="LD-00-00-ZR" /></div>
            <div><label class="zr-label">Modelo</label><input class="zr-input" value="Toyota Hiace" /></div>
            <div><label class="zr-label">Ano</label><input class="zr-input" value="2023" /></div>
            <div><label class="zr-label">Motorista (email ou telefone)</label><input class="zr-input" value="+244 923 111 222" /></div>
            <button class="zr-button zr-button--block">Guardar carro</button>
          </div>
        `,
        true,
      )}

      ${modal(
        "modal-upgrade",
        "FleetUpgradeModal",
        "Upgrade do plano",
        `
          <div class="zr-stack">
            <button class="zr-option"><strong>Starter</strong><span>2 carros - gratis</span></button>
            <button class="zr-option is-active"><strong>Pro</strong><span>Ilimitado - 5.000 Kz/carro</span></button>
            <button class="zr-option"><strong>Enterprise</strong><span>Ilimitado - 12.000 Kz/carro</span></button>
            <button class="zr-button zr-button--block">Activar plano</button>
          </div>
        `,
        true,
      )}
    `,
    nav: bottomNav("fleet", "home"),
  });

}

function renderWallet(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Wallet",
      "Carteira Zenith",
      "Idioma corrigido, tabs de carteira, Multicaixa Express, ZenithPay QR, levantamento, cash advance e parceiros.",
      `
        <button class="zr-button zr-button--sm zr-button--secondary" data-wallet-scan>${icon("qr_code_scanner")} QR</button>
        <div class="zr-avatar">A</div>
      `,
    ),
    body: `
      <section class="zr-card zr-card--hero" id="wallet-role-root" data-wallet-role-current="passenger">
        <div class="zr-tabs">
          <button class="zr-tab is-active" data-wallet-role="passenger">Passageiro</button>
          <button class="zr-tab" data-wallet-role="driver">Motorista</button>
        </div>
        <div style="margin-top:18px">
          <p class="zr-kicker" data-wallet-balance-label>Saldo Zenith</p>
          <div class="zr-balance">
            <strong data-wallet-balance-value>${fmtKz(4250000, true).replace(" Kz", "")}</strong>
            <span>Kz</span>
          </div>
          <p class="zr-copy" style="margin-top:10px">Actualizado agora mesmo - conta segura e pronta para ZenithPay.</p>
        </div>
        <div class="zr-grid zr-grid--3" style="margin-top:18px">
          <button class="zr-option is-active" data-open="modal-topup" data-wallet-only="passenger"><strong>Carregar</strong><span>Multicaixa Express</span></button>
          <button class="zr-option" data-open="modal-withdraw" data-wallet-only="driver"><strong>Levantar</strong><span>500 a 500.000 Kz</span></button>
          <button class="zr-option" data-open="modal-zenithpay"><strong>ZenithPay</strong><span>QR e NFC</span></button>
          <button class="zr-option"><strong>Transferir</strong><span>Carteira para carteira</span></button>
          <button class="zr-option"><strong>Analisar</strong><span>Movimentos e caixa</span></button>
          <button class="zr-option"><strong>Actualizar</strong><span>Sincronizar saldo</span></button>
        </div>
      </section>

      <section class="zr-card">
        <div class="zr-tabs">
          <button class="zr-tab is-active" data-tab-group="wallet-tabs" data-tab-target="movimentos">Movimentos</button>
          <button class="zr-tab" data-tab-group="wallet-tabs" data-tab-target="parceiros">Parceiros</button>
          <button class="zr-tab" data-tab-group="wallet-tabs" data-tab-target="adiantamento">Adiantamento</button>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="wallet-tabs" data-panel="movimentos">
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Pagamento de corrida</strong><span class="zr-copy">Hoje, 09:45 - Ilha -> Maianga</span></div><div style="text-align:right"><strong>- ${fmtKz(14500)}</strong><span class="zr-copy">Saldo 4.235.500</span></div></div>
            <div class="zr-list-item"><div><strong>Carregamento</strong><span class="zr-copy">Ontem, 18:20 - Multicaixa Express</span></div><div style="text-align:right"><strong style="color:#86efac">+ ${fmtKz(1000000)}</strong><span class="zr-copy">Saldo 4.250.000</span></div></div>
            <div class="zr-list-item"><div><strong>Bónus referral</strong><span class="zr-copy">Traz o Mano - codigo usado</span></div><div style="text-align:right"><strong style="color:#86efac">+ ${fmtKz(500)}</strong><span class="zr-copy">Saldo 3.250.500</span></div></div>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="wallet-tabs" data-panel="parceiros" hidden>
          <div class="zr-inline">
            <span class="zr-chip zr-chip--gold">Todos</span>
            <span class="zr-chip">Combustivel</span>
            <span class="zr-chip">Restaurantes</span>
            <span class="zr-chip">Seguros</span>
            <span class="zr-chip">Mecanica</span>
          </div>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Pumangol Select</strong><span class="zr-copy">Combustivel - desconto 5%</span></div><span class="zr-chip zr-chip--gold">-5%</span></div>
            <div class="zr-list-item"><div><strong>ENSA Auto</strong><span class="zr-copy">Seguro - premio reduzido</span></div><span class="zr-chip zr-chip--gold">-8%</span></div>
            <div class="zr-list-item"><div><strong>Oficina V8</strong><span class="zr-copy">Mecanica e revisao</span></div><span class="zr-chip zr-chip--gold">-6%</span></div>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="wallet-tabs" data-panel="adiantamento" hidden>
          <div class="zr-alert-box zr-alert-box--warning" data-wallet-only="passenger">
            <strong style="display:block">Apenas para motoristas</strong>
            <span class="zr-copy">O adiantamento aparece quando o papel activo for Motorista.</span>
          </div>
          <div class="zr-alert-box zr-alert-box--success zr-hidden" data-wallet-only="driver">
            <strong style="display:block">Zenith Cash Advance</strong>
            <span class="zr-copy">Disponivel para motoristas Diamante - ate ${fmtKz(20000)} sem juros.</span>
            <button class="zr-button zr-button--block" style="margin-top:12px">Solicitar 20.000 Kz</button>
          </div>
        </div>
      </section>

      ${modal(
        "modal-topup",
        "Multicaixa Express",
        "Carregamento da carteira",
        `
          <div class="zr-stack">
            <div><label class="zr-label">Valor</label><input class="zr-input" value="5000" /></div>
            <div><label class="zr-label">Numero</label><input class="zr-input" value="+244 923 456 789" /></div>
            <div class="zr-inline">
              <span class="zr-chip zr-chip--gold">1k</span>
              <span class="zr-chip">2,5k</span>
              <span class="zr-chip">5k</span>
              <span class="zr-chip">10k</span>
            </div>
            <button class="zr-button zr-button--block">Confirmar carregamento</button>
          </div>
        `,
      )}

      ${modal(
        "modal-zenithpay",
        "ZenithPay QR",
        "QR local e token temporario",
        `
          <div class="zr-stack">
            <div class="zr-card" style="padding:20px;background:#fff;color:#111;text-align:center">
              <div style="width:180px;height:180px;margin:0 auto;border:12px solid #111;background:
                linear-gradient(90deg,#111 10px,transparent 10px) 0 0/42px 42px,
                linear-gradient(#111 10px,transparent 10px) 0 0/42px 42px,
                #fff"></div>
            </div>
            <div class="zr-alert-box">
              <strong style="display:block">Token temporario</strong>
              <span class="zr-copy">zenithpay://session/ZR-LIVE-2026-4488</span>
            </div>
            <div class="zr-inline">
              <button class="zr-button zr-button--secondary" data-copy="zenithpay://session/ZR-LIVE-2026-4488">Copiar codigo</button>
              <span class="zr-chip zr-chip--info">NFC activo</span>
            </div>
          </div>
        `,
        true,
      )}

      ${modal(
        "modal-withdraw",
        "Levantamento",
        "Transferir saldo para o motorista",
        `
          <div class="zr-stack">
            <div><label class="zr-label">Montante</label><input class="zr-input" value="25000" /></div>
            <div class="zr-alert-box">
              <strong style="display:block">Limites</strong>
              <span class="zr-copy">Minimo ${fmtKz(500)} - maximo ${fmtKz(500000)} - validacao em tempo real.</span>
            </div>
            <button class="zr-button zr-button--block">Processar levantamento</button>
          </div>
        `,
        true,
      )}
    `,
    nav: bottomNav("passenger", "wallet"),
  });

  bindWalletRole(root);
}

function bindWalletRole(root) {
  const wrap = root.querySelector("#wallet-role-root");
  if (!wrap) return;

  const labels = {
    passenger: { label: "Saldo Zenith", value: fmtKz(4250000, true).replace(" Kz", "") },
    driver: { label: "Lucro liquido", value: fmtKz(1864500, true).replace(" Kz", "") },
  };

  function apply(role) {
    wrap.setAttribute("data-wallet-role-current", role);
    root.querySelectorAll("[data-wallet-role]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-wallet-role") === role);
    });

    const label = root.querySelector("[data-wallet-balance-label]");
    const value = root.querySelector("[data-wallet-balance-value]");
    if (label) label.textContent = labels[role].label;
    if (value) value.textContent = labels[role].value;

    root.querySelectorAll("[data-wallet-only]").forEach((node) => {
      node.classList.toggle("zr-hidden", node.getAttribute("data-wallet-only") !== role);
    });
  }

  root.querySelectorAll("[data-wallet-role]").forEach((button) => {
    button.addEventListener("click", () => apply(button.getAttribute("data-wallet-role")));
  });

  apply("passenger");
}

function renderFeedSocial(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Comunidade Zenith",
      "Feed social de Luanda",
      "Zonas, tipos de post, temporizador auto-destrutivo, barra de expiracao e apagar para o autor.",
      `<span class="zr-chip zr-chip--success">${icon("shield")} Em tempo real</span>`,
    ),
    body: `
      <section class="zr-card">
        <p class="zr-kicker">Publicar</p>
        <div class="zr-inline" style="margin-top:10px" data-zone-wrap>
          ${["Geral", "Viana", "Kilamba", "Talatona", "Cazenga", "Maianga", "Zango"]
            .map((zone, index) => `<button class="zr-chip${index === 0 ? " zr-chip--gold" : ""}" data-zone-filter="${zone}">${zone}</button>`)
            .join("")}
        </div>
        <div class="zr-inline" style="margin-top:12px" data-type-wrap>
          <button class="zr-chip zr-chip--info is-active" data-type-filter="status">Status</button>
          <button class="zr-chip zr-chip--danger" data-type-filter="alert">Alerta</button>
          <button class="zr-chip zr-chip--gold" data-type-filter="event">Evento</button>
        </div>
        <textarea class="zr-textarea" style="margin-top:14px" placeholder="O que esta a acontecer no transito?"></textarea>
        <div class="zr-inline zr-inline--between" style="margin-top:12px">
          <div class="zr-inline" data-timer-wrap>
            ${["1h", "6h", "12h", "24h"]
              .map((timer, index) => `<button class="zr-chip${index === 3 ? " zr-chip--gold" : ""}" data-timer="${timer}">${timer}</button>`)
              .join("")}
          </div>
          <button class="zr-button zr-button--sm">Publicar</button>
        </div>
      </section>

      <section class="zr-stack" id="feed-posts">
        <article class="zr-card zr-post" data-zone="Talatona">
          <div class="zr-post-bar"><span style="width:72%"></span></div>
          <div class="zr-row zr-row--top">
            <div class="zr-inline">
              <div class="zr-avatar">A</div>
              <div>
                <strong style="display:block">Ana Kiala</strong>
                <span class="zr-copy">Talatona - ha 12 min</span>
              </div>
            </div>
            <div class="zr-inline">
              <span class="zr-chip zr-chip--info">Status</span>
              <span class="zr-chip">23h</span>
            </div>
          </div>
          <p class="zr-copy" style="margin-top:12px;color:var(--text)">Fluxo normal na via expressa, mas ha revista policial perto do viaduto.</p>
          <div class="zr-inline" style="margin-top:12px">
            <span class="zr-chip">12 likes</span>
            <span class="zr-chip">3 comentarios</span>
            <button class="zr-chip" data-delete-post>Apagar</button>
          </div>
        </article>

        <article class="zr-card zr-post" data-zone="Maianga">
          <div class="zr-post-bar"><span style="width:38%;background:linear-gradient(90deg,rgba(239,68,68,0.55),#fb7185)"></span></div>
          <div class="zr-row zr-row--top">
            <div class="zr-inline">
              <div class="zr-avatar">M</div>
              <div>
                <strong style="display:block">Mateus Cambuta</strong>
                <span class="zr-copy">Maianga - ha 4 min</span>
              </div>
            </div>
            <div class="zr-inline">
              <span class="zr-chip zr-chip--danger">Alerta</span>
              <span class="zr-chip zr-chip--danger">42 min</span>
            </div>
          </div>
          <p class="zr-copy" style="margin-top:12px;color:var(--text)">Acidente ligeiro junto ao Sao Paulo. Melhor desviar por Kinaxixi.</p>
          <div class="zr-inline" style="margin-top:12px">
            <span class="zr-chip">24 likes</span>
            <span class="zr-chip">11 comentarios</span>
          </div>
        </article>

        <article class="zr-card zr-post" data-zone="Kilamba">
          <div class="zr-post-bar"><span style="width:55%"></span></div>
          <div class="zr-row zr-row--top">
            <div class="zr-inline">
              <div class="zr-avatar">R</div>
              <div>
                <strong style="display:block">Rita Paxe</strong>
                <span class="zr-copy">Kilamba - ha 36 min</span>
              </div>
            </div>
            <div class="zr-inline">
              <span class="zr-chip zr-chip--gold">Evento</span>
              <span class="zr-chip">11h</span>
            </div>
          </div>
          <p class="zr-copy" style="margin-top:12px;color:var(--text)">Concerto hoje no pavilhao central. Preve-se reforco de procura depois das 20:00.</p>
          <div class="zr-inline" style="margin-top:12px">
            <span class="zr-chip">8 likes</span>
            <span class="zr-chip">2 comentarios</span>
          </div>
        </article>
      </section>
    `,
    nav: bottomNav("passenger", "social"),
  });

  bindFeed(root);
}

function bindFeed(root) {
  const posts = root.querySelectorAll("[data-zone]");

  root.querySelectorAll("[data-zone-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const zone = button.getAttribute("data-zone-filter");
      root.querySelectorAll("[data-zone-filter]").forEach((item) => item.classList.remove("zr-chip--gold"));
      button.classList.add("zr-chip--gold");
      posts.forEach((post) => {
        post.classList.toggle("zr-hidden", zone !== "Geral" && post.getAttribute("data-zone") !== zone);
      });
    });
  });

  root.querySelectorAll("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", () => {
      const post = button.closest("article");
      if (post) post.remove();
      showToast("Post apagado");
    });
  });

  root.querySelectorAll("[data-timer]").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll("[data-timer]").forEach((item) => item.classList.remove("zr-chip--gold"));
      button.classList.add("zr-chip--gold");
    });
  });
}

function renderProfile(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Perfil",
      "Conta Zenith",
      "Conta pessoal, dados, IA, seguranca, Zenith Score, convites e termino de sessao.",
      `<button class="zr-button zr-button--sm" data-open="modal-referral">Traz o Mano</button>`,
    ),
    body: `
      <section class="zr-card zr-card--hero">
        <div class="zr-inline">
          <div class="zr-avatar zr-avatar--lg">A</div>
          <div>
            <p class="zr-kicker">Avatar</p>
            <h2 class="zr-section-title">Ariane Marcelino</h2>
            <p class="zr-copy">Diamante - 4,9 estrelas - toca na camera para mudar a foto</p>
          </div>
        </div>
        <div class="zr-inline" style="margin-top:16px">
          <button class="zr-button zr-button--secondary zr-button--sm">${icon("photo_camera")} Camera</button>
          <button class="zr-button zr-button--secondary zr-button--sm">${icon("image")} Galeria</button>
        </div>
      </section>

      <section class="zr-card">
        <div class="zr-tabs">
          <button class="zr-tab is-active" data-tab-group="profile-tabs" data-tab-target="main">Principal</button>
          <button class="zr-tab" data-tab-group="profile-tabs" data-tab-target="personal">Dados</button>
          <button class="zr-tab" data-tab-group="profile-tabs" data-tab-target="ia">IA</button>
          <button class="zr-tab" data-tab-group="profile-tabs" data-tab-target="security">Seguranca</button>
          <button class="zr-tab" data-tab-group="profile-tabs" data-tab-target="score">Score</button>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="profile-tabs" data-panel="main">
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Nome</strong><span class="zr-copy">Ariane Marcelino</span></div><span class="zr-chip">Verificado</span></div>
            <div class="zr-list-item"><div><strong>Email</strong><span class="zr-copy">ariane@zenithride.ao</span></div><span class="zr-chip">Activo</span></div>
            <div class="zr-list-item"><div><strong>Telefone</strong><span class="zr-copy">+244 923 456 789</span></div><span class="zr-chip">Principal</span></div>
            <div class="zr-list-item"><div><strong>Corridas</strong><span class="zr-copy">412 concluidas</span></div><span class="zr-chip zr-chip--gold">4,9</span></div>
          </div>
          <div class="zr-inline">
            <span class="zr-chip zr-chip--gold">Passageiro</span>
            <span class="zr-chip">Motorista</span>
            <span class="zr-chip">Frota</span>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="profile-tabs" data-panel="personal" hidden>
          <div><label class="zr-label">Nome completo</label><input class="zr-input" value="Ariane Marcelino" /></div>
          <div><label class="zr-label">Telefone</label><input class="zr-input" value="+244 923 456 789" /></div>
          <button class="zr-button zr-button--block">Guardar alteracoes</button>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="profile-tabs" data-panel="ia" hidden>
          <div class="zr-alert-box zr-alert-box--info">
            <strong style="display:block">Kaze IA</strong>
            <span class="zr-copy">Modelo Gemini 1.5 Flash, voz PT, 10 mensagens por corrida.</span>
          </div>
          <div class="zr-inline">
            <span class="zr-chip zr-chip--gold">Kaze activo</span>
            <span class="zr-chip">Silencioso</span>
            <span class="zr-chip">${icon("stars")} 128 creditos</span>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="profile-tabs" data-panel="security" hidden>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Conta criada</strong><span class="zr-copy">12/04/2026</span></div><span class="zr-chip zr-chip--success">Activa</span></div>
            <div class="zr-list-item"><div><strong>Sessoes activas</strong><span class="zr-copy">1 dispositivo</span></div><span class="zr-chip">Este telefone</span></div>
          </div>
          <div><label class="zr-label">Nova palavra-passe</label><input class="zr-input" type="password" placeholder="Minimo de 6 caracteres" /></div>
          <button class="zr-button zr-button--block">Actualizar password</button>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="profile-tabs" data-panel="score" hidden>
          <div class="zr-card zr-card--soft">
            <p class="zr-kicker">Zenith Score embed</p>
            <h2 class="zr-title">712</h2>
            <p class="zr-copy">Nivel Excelente - actualizado hoje</p>
            ${makeBars([
              ["Corridas", 82, "328/400"],
              ["Rating", 91, "273/300"],
              ["Nivel", 75, "150/200"],
              ["Consistencia", 81, "81/100"],
            ])}
            <a class="zr-button zr-button--block" href="zenith_score.html" style="margin-top:14px">Abrir score completo</a>
          </div>
        </div>
      </section>

      <section class="zr-card">
        <button class="zr-button zr-button--danger zr-button--block">Terminar sessao</button>
      </section>

      ${modal(
        "modal-referral",
        "Convites",
        "Traz o Mano",
        `
          <div class="zr-stack">
            <div class="zr-alert-box">
              <p class="zr-kicker">O teu codigo</p>
              <h3 class="zr-title zr-title--sm">ZENITH-ARI-24</h3>
              <div class="zr-inline" style="margin-top:12px">
                <button class="zr-button zr-button--secondary" data-copy="ZENITH-ARI-24">Copiar</button>
                <button class="zr-button">Partilhar WhatsApp</button>
              </div>
            </div>
            <div><label class="zr-label">Usar codigo de amigo</label><input class="zr-input" placeholder="Ex: TOMAS21" /></div>
            <button class="zr-button zr-button--block">Aplicar codigo</button>
          </div>
        `,
        true,
      )}
    `,
    nav: bottomNav("passenger", "profile"),
  });

}

function renderPostRideReview(root) {
  const state = {
    step: 0,
    score: 4,
    price: "fair",
    comment: "",
  };

  function panel() {
    const steps = [
      ["Preparacao", "Kaze a preparar a avaliacao da corrida."],
      ["Resumo", "Motorista Mateus Cambuta - total pago 6.800 Kz"],
      ["Estrelas", "Classifica a experiencia de Muito mau ate Excelente."],
      ["Comentario", "Escreve observacoes opcionais com ate 200 caracteres."],
      ["Preco", "Muito barato, Justo, Caro ou Muito caro."],
      ["Concluido", "WhatsApp, guardar no telemovel e fechar."],
    ];

    let body = "";
    if (state.step === 0) {
      body = `
        <div class="zr-card zr-card--soft" style="text-align:center">
          <div class="zr-loading-dots"><span></span><span></span><span></span></div>
          <p class="zr-copy" style="margin-top:12px">A IA so desperta aqui para guiar a recolha de feedback.</p>
          <button class="zr-button" style="margin-top:16px" data-review-next>Continuar</button>
        </div>
      `;
    }

    if (state.step === 1) {
      body = `
        <div class="zr-card">
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Motorista</strong><span class="zr-copy">Mateus Cambuta</span></div><span class="zr-chip zr-chip--gold">4,9</span></div>
            <div class="zr-list-item"><div><strong>Total pago</strong><span class="zr-copy">Corrida concluida ha instantes</span></div><strong>${fmtKz(6800)}</strong></div>
          </div>
          <div class="zr-inline" style="margin-top:16px">
            <button class="zr-button" data-review-next>Avaliar corrida</button>
            <button class="zr-button zr-button--ghost" data-review-jump="5">Saltar</button>
          </div>
        </div>
      `;
    }

    if (state.step === 2) {
      body = `
        <div class="zr-card" style="text-align:center">
          <div class="zr-stars">
            ${[1, 2, 3, 4, 5]
              .map((value) => `<button class="zr-star${value <= state.score ? " is-active" : ""}" data-review-star="${value}">★</button>`)
              .join("")}
          </div>
          <p class="zr-copy" style="margin-top:14px">${["", "Muito mau", "Mau", "OK", "Bom", "Excelente"][state.score]}</p>
          <button class="zr-button" style="margin-top:16px" data-review-next>Continuar</button>
        </div>
      `;
    }

    if (state.step === 3) {
      body = `
        <div class="zr-card">
          <textarea class="zr-textarea" id="review-comment" maxlength="200" placeholder="Motorista pontual, boa conducao, viatura limpa...">${state.comment}</textarea>
          <p class="zr-note" style="margin-top:8px">0 a 200 caracteres - comentario opcional.</p>
          <div class="zr-inline" style="margin-top:16px">
            <button class="zr-button" data-review-save-comment>Submeter avaliacao</button>
            <button class="zr-button zr-button--secondary" data-review-next>Sem comentario</button>
          </div>
        </div>
      `;
    }

    if (state.step === 4) {
      body = `
        <div class="zr-card">
          <div class="zr-grid zr-grid--2">
            ${[
              ["too_cheap", "Muito barato"],
              ["fair", "Justo"],
              ["expensive", "Caro"],
              ["too_expensive", "Muito caro"],
            ]
              .map(
                ([value, label]) => `
                  <button class="zr-option${state.price === value ? " is-active" : ""}" data-price-rate="${value}">
                    <strong>${label}</strong>
                    <span>Feedback de tarifa</span>
                  </button>
                `,
              )
              .join("")}
          </div>
          <button class="zr-button zr-button--block" style="margin-top:16px" data-review-next>Enviar opiniao</button>
        </div>
      `;
    }

    if (state.step === 5) {
      body = `
        <div class="zr-card zr-card--success" style="text-align:center">
          <h2 class="zr-section-title">Obrigado pelo feedback</h2>
          <p class="zr-copy" style="margin-top:10px">A tua avaliacao ajuda a melhorar a experiencia Zenith.</p>
          <div class="zr-inline" style="justify-content:center;margin-top:16px">
            <button class="zr-button zr-button--success">Partilhar via WhatsApp</button>
            <button class="zr-button zr-button--secondary">Guardar no telemovel</button>
          </div>
        </div>
      `;
    }

    return `
      <section class="zr-card">
        <div class="zr-stepper">
          ${steps.map((_step, index) => `<span class="zr-step${index <= state.step ? " is-active" : ""}"></span>`).join("")}
        </div>
        <p class="zr-kicker" style="margin-top:14px">${steps[state.step][0]}</p>
        <h2 class="zr-section-title">${steps[state.step][1]}</h2>
        <div style="margin-top:16px">${body}</div>
      </section>
    `;
  }

  function draw() {
    root.innerHTML = shellPage({
      header: headerBlock(
        "Pos-viagem",
        "Avaliacao guiada pelo Kaze",
        "Fluxo completo de 6 passos com estrelas, comentario, feedback de preco e recibo final.",
      ),
      body: panel(),
      nav: bottomNav("passenger", "rides"),
    });

    root.querySelectorAll("[data-review-next]").forEach((button) => {
      button.addEventListener("click", () => {
        state.step = Math.min(5, state.step + 1);
        draw();
      });
    });

    root.querySelectorAll("[data-review-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        state.step = Number(button.getAttribute("data-review-jump"));
        draw();
      });
    });

    root.querySelectorAll("[data-review-star]").forEach((button) => {
      button.addEventListener("click", () => {
        state.score = Number(button.getAttribute("data-review-star"));
        draw();
      });
    });

    const saveComment = root.querySelector("[data-review-save-comment]");
    if (saveComment) {
      saveComment.addEventListener("click", () => {
        const input = root.querySelector("#review-comment");
        state.comment = input ? input.value : state.comment;
        state.step = 4;
        draw();
      });
    }

    root.querySelectorAll("[data-price-rate]").forEach((button) => {
      button.addEventListener("click", () => {
        state.price = button.getAttribute("data-price-rate");
        draw();
      });
    });
  }

  draw();
}

function renderAdminDashboard(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Admin",
      "Painel de controlo",
      "Mapa, mercado, precos, SOS, utilizadores, servicos, BI/Carros e seguranca num unico painel.",
      `<span class="zr-chip zr-chip--success">Online</span>`,
    ),
    body: `
      <section class="zr-card">
        <div class="zr-scroll-x">
          ${[
            ["map", "Mapa"],
            ["market", "Mercado"],
            ["prices", "Precos"],
            ["sos", "SOS"],
            ["users", "Utilizadores"],
            ["services", "Servicos"],
            ["drivers", "BI / Carros"],
            ["security", "Seguranca"],
          ]
            .map(
              ([key, label], index) => `
                <button class="zr-option${index === 0 ? " is-active" : ""}" data-tab-group="admin-tabs" data-tab-target="${key}">
                  <strong>${label}</strong>
                  <span>Seccao ${index + 1}</span>
                </button>
              `,
            )
            .join("")}
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="map">
          <div class="zr-map" style="min-height:240px">
            <span class="zr-marker zr-marker--success zr-pulse" style="top:30%;left:30%"></span>
            <span class="zr-marker zr-marker--success" style="top:42%;left:58%"></span>
            <span class="zr-marker zr-marker--warning" style="top:52%;left:44%"></span>
            <span class="zr-marker zr-marker--info" style="top:68%;left:70%"></span>
          </div>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Motoristas disponiveis</strong><span class="zr-copy">11 online</span></div><span class="zr-chip zr-chip--success">Ao vivo</span></div>
            <div class="zr-list-item"><div><strong>Corridas activas</strong><span class="zr-copy">7 em curso ou recolha</span></div><span class="zr-chip zr-chip--info">Operacao</span></div>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="market" hidden>
          <div class="zr-kpi-grid">
            ${stat("Receita 24h", fmtKz(2840000))}
            ${stat("Motoristas online", "11")}
            ${stat("Corridas 24h", "186")}
            ${stat("Codigos usados", "54")}
          </div>
          <div class="zr-card">
            <p class="zr-kicker">Heatmap de procura</p>
            ${makeBars([
              ["Talatona", 92, "risco alto"],
              ["Maianga", 74, "bom fluxo"],
              ["Viana", 61, "equilibrado"],
              ["Kilamba", 48, "moderado"],
            ])}
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="prices" hidden>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Mutamba -> Talatona</strong><span class="zr-copy">14 km</span></div><div class="zr-inline"><input class="zr-input" style="width:110px" value="6400" /><button class="zr-button zr-button--sm">Guardar</button></div></div>
            <div class="zr-list-item"><div><strong>Camama -> Viana</strong><span class="zr-copy">19 km</span></div><div class="zr-inline"><input class="zr-input" style="width:110px" value="7200" /><button class="zr-button zr-button--sm">Guardar</button></div></div>
            <div class="zr-list-item"><div><strong>Maianga -> Ilha</strong><span class="zr-copy">6 km</span></div><div class="zr-inline"><input class="zr-input" style="width:110px" value="3800" /><button class="zr-button zr-button--sm">Guardar</button></div></div>
          </div>
          <div class="zr-alert-box zr-alert-box--warning">
            <strong style="display:block">Reflexo instantaneo</strong>
            <span class="zr-copy">Qualquer alteracao invalidaria o cache e apareceria de imediato no app React.</span>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="sos" hidden>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Pax: Joana Silva</strong><span class="zr-copy">+244 923 123 456 - lat -8.83451, lng 13.24531</span></div><span class="zr-chip zr-chip--danger">Critico</span></div>
            <div class="zr-list-item"><div><strong>Motorista: Paulo Banza</strong><span class="zr-copy">audio salvo - alerta activo</span></div><span class="zr-chip zr-chip--warning">Elevado</span></div>
          </div>
          <div class="zr-inline">
            <button class="zr-button zr-button--success">Resolver</button>
            <button class="zr-button zr-button--secondary">Falso alarme</button>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="users" hidden>
          <div class="zr-kpi-grid">
            ${stat("Total utilizadores", "4.281")}
            ${stat("Novos hoje", "84")}
            ${stat("Novos semana", "512")}
            ${stat("Retencao 7d", "62%")}
          </div>
          <div class="zr-table">
            <div class="zr-table-row"><div><strong>Nome</strong>Ana Kiala</div><div><strong>Role</strong>Passageiro</div><div><strong>Rating</strong>4,9</div><div><strong>Status</strong>Activo</div></div>
            <div class="zr-table-row"><div><strong>Nome</strong>Mateus Cambuta</div><div><strong>Role</strong>Motorista</div><div><strong>Rating</strong>4,8</div><div><strong>Status</strong>Suspenso ate 02/05</div></div>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="services" hidden>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Motorista privado</strong><span class="zr-copy">Cliente: Rui Afonso - 4 horas - SUV</span></div><span class="zr-chip zr-chip--gold">${fmtKz(72000)}</span></div>
            <div class="zr-list-item"><div><strong>Fretamento</strong><span class="zr-copy">Evento empresa - 40 pessoas</span></div><span class="zr-chip zr-chip--gold">${fmtKz(156000)}</span></div>
            <div class="zr-list-item"><div><strong>Mercadorias</strong><span class="zr-copy">Carga leve - 2 ajudantes</span></div><span class="zr-chip zr-chip--gold">${fmtKz(38400)}</span></div>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="drivers" hidden>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Paulo Banza</strong><span class="zr-copy">Toyota Corolla - LD-54-88-ZR</span></div><span class="zr-chip">Pendente</span></div>
            <div class="zr-list-item"><div><strong>Neves Manuel</strong><span class="zr-copy">Hyundai H1 - LD-88-33-ZR</span></div><span class="zr-chip zr-chip--success">Aprovado</span></div>
          </div>
          <div class="zr-inline">
            <button class="zr-button">Autorizar motorista</button>
            <button class="zr-button zr-button--secondary">Rejeitar</button>
          </div>
        </div>

        <div class="zr-stack" style="margin-top:16px" data-panel-group="admin-tabs" data-panel="security" hidden>
          <div class="zr-list">
            <div class="zr-list-item"><div><strong>Pico de procura</strong><span class="zr-copy">Talatona - intensidade 1,8x</span></div><span class="zr-chip zr-chip--warning">IA</span></div>
            <div class="zr-list-item"><div><strong>Padrao suspeito</strong><span class="zr-copy">Cancelamentos a subir em Viana</span></div><span class="zr-chip zr-chip--danger">Critico</span></div>
            <div class="zr-list-item"><div><strong>Saude do sistema</strong><span class="zr-copy">Monitorizacao activa sem falhas</span></div><span class="zr-chip zr-chip--success">OK</span></div>
          </div>
          <div class="zr-alert-box zr-alert-box--danger">
            <strong style="display:block">Vigilante IA</strong>
            <span class="zr-copy">Alertas automaticos, cruzamento de zonas e acompanhamento continuo.</span>
          </div>
        </div>
      </section>
    `,
  });

  bindSelectableCards(root, '[data-tab-group="admin-tabs"]');
}

function renderZenithScore(root) {
  let score = 712;

  function draw() {
    const progress = Math.min(100, Math.round((score / 1000) * 100));
    const label = score >= 850 ? "Extraordinario" : score >= 700 ? "Excelente" : score >= 600 ? "Bom" : score >= 450 ? "Medio" : score >= 250 ? "Basico" : "Sem historial";

    root.innerHTML = shellPage({
      header: headerBlock(
        "Zenith Score",
        "Score de credito do motorista",
        "Score 0-1000 com decomposicao por corridas, rating, nivel, consistencia e parceiros bancarios.",
      ),
      body: `
        <section class="zr-card zr-card--hero">
          <p class="zr-kicker">Pontuacao actual</p>
          <h2 class="zr-title" style="font-size:64px">${score}</h2>
          <div class="zr-inline" style="margin-top:8px">
            <span class="zr-chip zr-chip--gold">${label}</span>
            <span class="zr-chip">de 1000 pontos</span>
          </div>
          <div class="zr-progress" style="margin-top:18px"><div class="zr-progress-fill" style="width:${progress}%"></div></div>
          <p class="zr-copy" style="margin-top:10px">Actualizado hoje - elegibilidade financeira activa.</p>
        </section>

        <section class="zr-card">
          <p class="zr-kicker">Como e calculado</p>
          ${makeBars([
            ["Corridas", 82, "328 / 400"],
            ["Rating", 91, "273 / 300"],
            ["Nivel", 75, "150 / 200"],
            ["Consistencia", 81, "81 / 100"],
          ])}
        </section>

        <section class="zr-card">
          <p class="zr-kicker">Parceiros bancarios</p>
          <div class="zr-score-grid" style="margin-top:14px">
            <div class="zr-bank"><strong>BCA</strong><span>Microcredito ate ${fmtKz(2000000)}</span></div>
            <div class="zr-bank"><strong>BFA</strong><span>Credito automovel preferencial</span></div>
            <div class="zr-bank"><strong>BAI</strong><span>Conta poupanca sem comissoes</span></div>
            <div class="zr-bank"><strong>ENSA</strong><span>Seguro com premio reduzido 20%</span></div>
          </div>
        </section>

        <section class="zr-card">
          <button class="zr-button zr-button--block" id="score-recalc">Recalcular score</button>
        </section>
      `,
      nav: bottomNav("driver", "profile"),
    });

    const button = root.querySelector("#score-recalc");
    if (button) {
      button.addEventListener("click", () => {
        score = score >= 760 ? 698 : score + 24;
        draw();
      });
    }
  }

  draw();
}

function renderReferral(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Convites",
      "Traz o Mano",
      "Modal de referencia com codigo pessoal, partilha via WhatsApp e historico de convites.",
    ),
    body: `
      <section class="zr-card zr-card--hero">
        <p class="zr-kicker">O teu codigo</p>
        <h2 class="zr-title">ZENITH-ARI-24</h2>
        <p class="zr-copy">Convida amigos e ganha ${fmtKz(500)} por cada primeira corrida ou assinatura valida.</p>
        <div class="zr-inline" style="margin-top:16px">
          <button class="zr-button zr-button--secondary" data-copy="ZENITH-ARI-24">Copiar codigo</button>
          <button class="zr-button">Partilhar WhatsApp</button>
        </div>
      </section>
      <section class="zr-card">
        <div><label class="zr-label">Usar codigo de amigo</label><input class="zr-input" placeholder="Ex: TOMAS21" /></div>
        <button class="zr-button zr-button--block" style="margin-top:14px">Aplicar</button>
      </section>
      <section class="zr-card">
        <p class="zr-kicker">Historico de convites</p>
        <div class="zr-list" style="margin-top:14px">
          <div class="zr-list-item"><div><strong>Mara Dias</strong><span class="zr-copy">Primeira corrida concluida</span></div><span class="zr-chip zr-chip--success">+ ${fmtKz(500)}</span></div>
          <div class="zr-list-item"><div><strong>Filipe Neto</strong><span class="zr-copy">Conta criada, ainda sem corrida</span></div><span class="zr-chip">Pendente</span></div>
          <div class="zr-list-item"><div><strong>Rui Afonso</strong><span class="zr-copy">Assinatura fleet starter</span></div><span class="zr-chip zr-chip--success">+ ${fmtKz(500)}</span></div>
        </div>
      </section>
    `,
    nav: bottomNav("passenger", "profile"),
  });

  bindCopyButtons(root);
}

function renderHistorico(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Historico",
      "Arquivo de corridas",
      "Lista de viagens, estados, filtros e acesso rapido a recibos e avaliacao.",
    ),
    body: `
      <section class="zr-stat-grid">
        ${stat("Este mes", "24")}
        ${stat("Completadas", "21")}
        ${stat("Canceladas", "3")}
      </section>
      <section class="zr-card">
        <div class="zr-inline">
          <span class="zr-chip zr-chip--gold">Todas</span>
          <span class="zr-chip">Concluidas</span>
          <span class="zr-chip">Canceladas</span>
          <span class="zr-chip">Recibos</span>
        </div>
        <div class="zr-list" style="margin-top:14px">
          <div class="zr-list-item"><div><strong>Mutamba -> Talatona</strong><span class="zr-copy">Hoje, 09:45 - Mateus Cambuta</span></div><div style="text-align:right"><strong>${fmtKz(6800)}</strong><span class="zr-chip zr-chip--success">Concluida</span></div></div>
          <div class="zr-list-item"><div><strong>Camama -> Ilha</strong><span class="zr-copy">Ontem, 18:20 - Ana Kiala</span></div><div style="text-align:right"><strong>${fmtKz(7400)}</strong><span class="zr-chip zr-chip--danger">Cancelada</span></div></div>
          <div class="zr-list-item"><div><strong>Benfica -> Maianga</strong><span class="zr-copy">26/04 - recibo guardado</span></div><div style="text-align:right"><strong>${fmtKz(5200)}</strong><a class="zr-phone-link" href="pos_viagem_review.html">Avaliar</a></div></div>
        </div>
      </section>
    `,
    nav: bottomNav("passenger", "rides"),
  });
}

function renderContratos(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Contratos",
      "Suite de confianca",
      "Clausulas, aceite, vigencia e termos operacionais da experiencia Zenith.",
    ),
    body: `
      <section class="zr-card">
        <div class="zr-tabs">
          <button class="zr-tab is-active" data-tab-group="contract-tabs" data-tab-target="passenger">Passageiro</button>
          <button class="zr-tab" data-tab-group="contract-tabs" data-tab-target="school">Escolas</button>
          <button class="zr-tab" data-tab-group="contract-tabs" data-tab-target="business">Empresas</button>
        </div>

        <!-- ABA PASSAGEIRO -->
        <div class="zr-stack" style="margin-top:16px" data-panel-group="contract-tabs" data-panel="passenger">
          <section class="zr-card zr-card--hero">
            <p class="zr-kicker">Estado actual</p>
            <h2 class="zr-section-title">Contrato Zenith Passageiro Premium</h2>
            <p class="zr-copy">Termos de seguranca, privacidade, pagamentos e cobertura de incidentes em vigor.</p>
            <div class="zr-inline" style="margin-top:14px">
              <span class="zr-chip zr-chip--success">Activo</span>
              <span class="zr-chip">Renova em 12/2026</span>
              <span class="zr-chip zr-chip--gold">Assinado</span>
            </div>
          </section>
          <p class="zr-kicker">Clausulas principais</p>
          <div class="zr-list" style="margin-top:14px">
            <div class="zr-list-item"><div><strong>Privacidade</strong><span class="zr-copy">Numero protegido, localizacao partilhavel e blackout quando aplicavel.</span></div></div>
            <div class="zr-list-item"><div><strong>Pagamentos</strong><span class="zr-copy">Saldo Zenith, Multicaixa Express, ZenithPay QR e saldo controlado.</span></div></div>
            <div class="zr-list-item"><div><strong>Seguranca</strong><span class="zr-copy">Botao SOS, audio de evidencia, contactos 113/112 e painel SOS.</span></div></div>
          </div>
        </div>

        <!-- ABA ESCOLAS -->
        <div class="zr-stack" style="margin-top:16px" data-panel-group="contract-tabs" data-panel="school" hidden>
          <section class="zr-card zr-card--hero" style="background:rgba(50,200,100,0.05); border-color:rgba(50,200,100,0.2)">
            <p class="zr-kicker" style="color:var(--color-success)">Monitoria Escolar</p>
            <h2 class="zr-section-title">Contratos de Transporte Escolar</h2>
            <p class="zr-copy">Autorizacoes de encarregados, delegacao de confianca e acordos com condutores certificados.</p>
            <div class="zr-inline" style="margin-top:14px">
              <span class="zr-chip zr-chip--success">2 Crianças Activas</span>
              <span class="zr-chip zr-chip--gold">Motorista: Neves</span>
            </div>
          </section>
          <p class="zr-kicker">Acordos Vigentes</p>
          <div class="zr-list" style="margin-top:14px">
            <div class="zr-list-item"><div><strong>Colegio Girassol</strong><span class="zr-copy">Rota Casa-Escola, Segunda a Sexta, 07:00 / 15:30.</span></div><span class="zr-chip zr-chip--success">Válido</span></div>
            <div class="zr-list-item"><div><strong>Termo de Responsabilidade</strong><span class="zr-copy">Partilha automatica de Live Link e contacto 112 pre-aprovado.</span></div><span class="zr-chip zr-chip--gold">Assinado</span></div>
          </div>
          <button class="zr-button zr-button--sm zr-button--secondary" style="margin-top:14px">${icon("add")} Novo Acordo Escolar</button>
        </div>

        <!-- ABA EMPRESAS -->
        <div class="zr-stack" style="margin-top:16px" data-panel-group="contract-tabs" data-panel="business" hidden>
          <section class="zr-card zr-card--hero">
            <p class="zr-kicker">Hub B2B</p>
            <h2 class="zr-section-title">Acordos Corporativos e Frotas</h2>
            <p class="zr-copy">Parcerias empresariais, adiantamentos salariais e facturacao consolidada para funcionarios.</p>
            <div class="zr-inline" style="margin-top:14px">
              <span class="zr-chip zr-chip--gold">Pro Tier</span>
              <span class="zr-chip">Pós-pago 30 dias</span>
            </div>
          </section>
          <p class="zr-kicker">Acordos Activos</p>
          <div class="zr-list" style="margin-top:14px">
            <div class="zr-list-item"><div><strong>UNITEL S.A.</strong><span class="zr-copy">Bolsa de deslocacao: 25.000 Kz / mes por colaborador.</span></div><span class="zr-chip zr-chip--success">Activo</span></div>
            <div class="zr-list-item"><div><strong>Sonangol Logistics</strong><span class="zr-copy">Frota dedicada e facturacao consolidada.</span></div><span class="zr-chip zr-chip--warning">Pendente Assinatura</span></div>
          </div>
          <button class="zr-button zr-button--sm" style="margin-top:14px">${icon("apartment")} Associar nova empresa</button>
        </div>
      </section>
    `,
    nav: bottomNav("passenger", "contrato"),
  });
}

function renderPrecos(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Precos",
      "Mapa tarifario inteligente",
      "Zonas de Luanda, precos por trajecto e leitura rapida de procura.",
    ),
    body: `
      <section class="zr-map" style="min-height:200px">
        <span class="zr-marker zr-marker--gold" style="top:30%;left:28%"></span>
        <span class="zr-marker zr-marker--danger" style="top:56%;left:62%"></span>
        <span class="zr-marker zr-marker--info" style="top:46%;left:46%"></span>
      </section>
      <section class="zr-card">
        <p class="zr-kicker">Zonas quentes</p>
        ${makeBars([
          ["Talatona", 92, fmtKz(6400)],
          ["Maianga", 68, fmtKz(4800)],
          ["Viana", 61, fmtKz(7200)],
          ["Kilamba", 48, fmtKz(5400)],
        ])}
      </section>
      <section class="zr-card">
        <div class="zr-list">
          <div class="zr-list-item"><div><strong>Mutamba -> Talatona</strong><span class="zr-copy">Preco fixo por zona</span></div><span class="zr-chip zr-chip--gold">${fmtKz(6400)}</span></div>
          <div class="zr-list-item"><div><strong>Camama -> Viana</strong><span class="zr-copy">Previsao com trafego</span></div><span class="zr-chip">${fmtKz(7200)}</span></div>
          <div class="zr-list-item"><div><strong>Maianga -> Ilha</strong><span class="zr-copy">Curta distancia</span></div><span class="zr-chip">${fmtKz(3800)}</span></div>
        </div>
      </section>
    `,
    nav: bottomNav("passenger", "precos"),
  });
}

function renderKazeAI(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Kaze IA",
      "Co-piloto Zenith",
      "Chat de apoio com respostas sobre rotas, zonas quentes, seguranca, historico e pagamentos.",
      `<span class="zr-chip zr-chip--gold">${icon("smart_toy")} Activo</span>`,
    ),
    body: `
      <section class="zr-card zr-card--hero">
        <p class="zr-kicker">Kaze</p>
        <h2 class="zr-section-title">Como posso ajudar hoje?</h2>
        <p class="zr-copy">Perguntas mais comuns do passageiro, motorista ou dono de frota, com tom Zenith.</p>
      </section>
      <section class="zr-card">
        <div class="zr-chat">
          <div class="zr-bubble">Boa tarde. Consigo sugerir uma rota mais barata entre Mutamba e Talatona.</div>
          <div class="zr-bubble zr-bubble--self">Mostra-me tambem a zona com mais procura agora.</div>
          <div class="zr-bubble">Talatona e Maianga estao com o melhor equilibrio entre procura e oferta neste momento.</div>
        </div>
        <div class="zr-inline" style="margin-top:16px">
          <span class="zr-chip">Previsao de preco</span>
          <span class="zr-chip">Zona quente</span>
          <span class="zr-chip">Seguranca</span>
          <span class="zr-chip">Recibo</span>
        </div>
      </section>
    `,
  });
}

function renderEscolar(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Escudo escolar",
      "Monitoria de criancas",
      "Acompanhamento seguro, encarregados, horarios e canal de emergencia.",
      `<span class="zr-chip zr-chip--success">Em rota</span>`,
    ),
    body: `
      <section class="zr-map" style="min-height:180px">
        <span class="zr-marker zr-marker--success zr-pulse" style="top:38%;left:44%"></span>
        <span class="zr-marker zr-marker--gold" style="top:64%;left:24%"></span>
        <span class="zr-marker zr-marker--danger" style="top:22%;left:70%"></span>
      </section>
      <section class="zr-card">
        <div class="zr-list">
          <div class="zr-list-item"><div><strong>Crianca</strong><span class="zr-copy">Mia Banza - uniforme azul</span></div><span class="zr-chip zr-chip--success">A bordo</span></div>
          <div class="zr-list-item"><div><strong>Motorista</strong><span class="zr-copy">Neves Manuel - Toyota Hiace</span></div><span class="zr-chip">4,9 estrelas</span></div>
          <div class="zr-list-item"><div><strong>Destino</strong><span class="zr-copy">Colegio Girassol - chegada prevista 07:42</span></div><span class="zr-chip zr-chip--gold">Pontual</span></div>
        </div>
      </section>
      <section class="zr-card zr-card--warning">
        <p class="zr-kicker">Partilha protegida</p>
        <p class="zr-copy">Link ao vivo enviado aos encarregados e canal rapido para o contacto de emergencia.</p>
      </section>
    `,
  });
}

function renderStubPage(root, title, subtitle, lines, navKey = "passenger", activeKey = "home") {
  root.innerHTML = shellPage({
    header: headerBlock("Preview", title, subtitle),
    body: `
      <section class="zr-card">
        <div class="zr-list">
          ${lines.map((line) => `<div class="zr-list-item"><span class="zr-copy" style="color:var(--text)">${line}</span></div>`).join("")}
        </div>
      </section>
    `,
    nav: bottomNav(navKey, activeKey),
  });
}

function renderFretamento(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Marketplace premium",
      "Fretamento Zenith",
      "Comeca como marketplace. Capturamos a tua rota agora e alinhamos a operacao com parceiros.",
      `<span class="zr-chip zr-chip--gold">Novo</span>`,
    ),
    body: `
      <section class="zr-card">
        <p class="zr-kicker">1. Tipo de evento</p>
        <div class="zr-scroll-x" style="margin-top:14px">
          <button class="zr-option is-active"><strong>Empresa</strong></button>
          <button class="zr-option"><strong>Escolar</strong></button>
          <button class="zr-option"><strong>Igreja</strong></button>
          <button class="zr-option"><strong>Evento</strong></button>
          <button class="zr-option"><strong>Outro</strong></button>
        </div>
      </section>
      
      <section class="zr-card">
        <p class="zr-kicker">2. Capacidade</p>
        <div class="zr-grid zr-grid--3" style="margin-top:14px">
          <button class="zr-option is-active"><strong>20 pessoas</strong></button>
          <button class="zr-option"><strong>40 pessoas</strong></button>
          <button class="zr-option"><strong>60 pessoas</strong></button>
        </div>
      </section>

      <section class="zr-card">
        <p class="zr-kicker">3. Rota e detalhes</p>
        <div class="zr-stack" style="margin-top:14px">
          <input class="zr-input" placeholder="Data e hora" type="datetime-local" />
          <textarea class="zr-input" placeholder="Pickup, paragens intermédias e destino final." style="min-height: 80px"></textarea>
          <div class="zr-inline zr-inline--between" style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 16px; margin-top: 8px">
            <div>
              <p style="font-weight: 800; font-size: 14px">Ida e volta</p>
              <p class="zr-copy">Acrescenta margem operacional na estimativa</p>
            </div>
            <span class="zr-chip zr-chip--gold">Sim</span>
          </div>
        </div>
      </section>

      <section class="zr-card zr-card--hero" style="background: rgba(17,17,17,1); border-color: rgba(230,195,100,0.2);">
        <p class="zr-kicker" style="color:var(--color-gold)">Estimativa de orcamento</p>
        <div style="margin-top:12px">
          <p class="zr-copy">Evento: Empresa</p>
          <p class="zr-copy">Capacidade: 20 pessoas</p>
          <p class="zr-copy">Modelo: marketplace com confirmacao humana</p>
        </div>
        <div class="zr-inline zr-inline--between" style="margin-top:16px">
          <div>
            <p class="zr-kicker">Preco estimado</p>
            <h2 class="zr-title zr-title--sm" style="color:var(--color-gold)">45.000 Kz</h2>
          </div>
          <span class="zr-chip zr-chip--gold" style="background:rgba(230,195,100,0.15)">Notificar-me</span>
        </div>
      </section>

      <div style="padding: 0 16px">
        <textarea class="zr-input" placeholder="Notas especiais, acessos, horário de embarque, perfil dos passageiros..." style="min-height: 110px"></textarea>
      </div>

      <div style="padding: 16px">
        <button class="zr-button zr-button--block zr-button--primary">Solicitar orcamento</button>
      </div>
    `,
    nav: bottomNav("passenger", "home"),
  });
}

function renderMercadorias(root) {
  root.innerHTML = shellPage({
    header: headerBlock(
      "Industrial premium",
      "Mercadorias Zenith",
      "Visual premium, arranque controlado. Capturamos a procura antes da operacao entrar em tempo real.",
      `<span class="zr-chip zr-chip--gold">Novo</span>`,
    ),
    body: `
      <section class="zr-card">
        <p class="zr-kicker">1. Tipo de carga</p>
        <div class="zr-grid zr-grid--3" style="margin-top:14px">
          <button class="zr-option is-active" style="padding:12px 8px"><strong>Leve <50kg</strong></button>
          <button class="zr-option" style="padding:12px 8px"><strong>Media 50-200kg</strong></button>
          <button class="zr-option" style="padding:12px 8px"><strong>Pesada >200kg</strong></button>
        </div>
      </section>
      
      <section class="zr-card">
        <p class="zr-kicker">2. Ajudantes</p>
        <div class="zr-inline zr-inline--between" style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 16px; margin-top: 14px">
          <div>
            <p style="font-weight: 800; font-size: 14px">Precisa de ajudantes?</p>
            <p class="zr-copy">Cada ajudante acrescenta custo operacional</p>
          </div>
          <span class="zr-chip zr-chip--gold">Sim</span>
        </div>
        <div class="zr-grid zr-grid--3" style="margin-top:12px">
          <button class="zr-option is-active"><strong>1 ajudante</strong></button>
          <button class="zr-option"><strong>2 ajudantes</strong></button>
          <button class="zr-option"><strong>3 ajudantes</strong></button>
        </div>
      </section>

      <section class="zr-card">
        <p class="zr-kicker">3. Pickup e destino</p>
        <div class="zr-stack" style="margin-top:14px">
          <input class="zr-input" placeholder="Local de recolha" value="Marginal de Luanda" />
          <input class="zr-input" placeholder="Destino" value="Viana" />
        </div>
      </section>

      <section class="zr-card">
        <p class="zr-kicker">4. Urgencia e peso</p>
        <div class="zr-grid zr-grid--2" style="margin-top:14px">
          <button class="zr-option is-active"><strong>Normal</strong></button>
          <button class="zr-option"><strong>Express +30%</strong></button>
        </div>
        <div style="padding: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 28px; margin-top: 14px">
          <div class="zr-inline zr-inline--between">
            <p style="font-weight: 800; font-size: 14px">Peso estimado</p>
            <p style="font-weight: 800; font-size: 14px; color: var(--color-gold)">50 kg</p>
          </div>
          <input type="range" min="10" max="500" step="10" value="50" style="width: 100%; margin-top: 16px; accent-color: var(--color-gold);" />
        </div>
      </section>

      <section class="zr-card zr-card--hero" style="background: rgba(17,17,17,1); border-color: rgba(230,195,100,0.2);">
        <p class="zr-kicker" style="color:var(--color-gold)">Estimativa de preco</p>
        <div style="margin-top:12px">
          <p class="zr-copy">Carga: light</p>
          <p class="zr-copy">Urgencia: normal</p>
          <p class="zr-copy">Ajudantes: 1</p>
        </div>
        <div class="zr-inline zr-inline--between" style="margin-top:16px">
          <div>
            <p class="zr-kicker">Preco previsto</p>
            <h2 class="zr-title zr-title--sm" style="color:var(--color-gold)">12.500 Kz</h2>
          </div>
          <span class="zr-chip zr-chip--gold" style="background:rgba(230,195,100,0.15)">Tracking depois</span>
        </div>
      </section>

      <div style="padding: 0 16px">
        <textarea class="zr-input" placeholder="Instruções especiais, acesso ao edifício, fragilidade, contacto na entrega..." style="min-height: 110px"></textarea>
      </div>

      <div style="padding: 16px">
        <button class="zr-button zr-button--block zr-button--primary">Notificar-me</button>
      </div>
    `,
    nav: bottomNav("passenger", "home"),
  });
}

const RENDERERS = {
  index: renderIndex,
  global_shell: renderGlobalShell,
  splash_auth: renderSplashAuth,
  passenger_home: renderPassengerHome,
  active_ride: renderActiveRide,
  driver_home: renderDriverHome,
  fleet_dashboard: renderFleetDashboard,
  wallet: renderWallet,
  feed_social: renderFeedSocial,
  perfil: renderProfile,
  pos_viagem_review: renderPostRideReview,
  admin_dashboard: renderAdminDashboard,
  zenith_score: renderZenithScore,
  referral: renderReferral,
  historico: renderHistorico,
  contratos: renderContratos,
  precos: renderPrecos,
  kaze_ai: renderKazeAI,
  escolar: renderEscolar,
  fretamento: renderFretamento,
  mercadorias: renderMercadorias,
};

function mount() {
  const root = document.getElementById("app");
  const screen = document.body.dataset.screen || "index";
  const renderer = RENDERERS[screen] || (() => renderStubPage(root, "Preview", "Ecran ainda nao mapeado.", ["Conteudo por configurar."]));
  renderer(root);
  bindModals(root);
  bindTabs(root);
  bindCopyButtons(root);
  bindPanic(root);
}

document.addEventListener("DOMContentLoaded", mount);
