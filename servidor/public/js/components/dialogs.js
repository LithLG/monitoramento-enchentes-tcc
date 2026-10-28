import { html, $ } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { formatLimitCm, formatNumber, levelText, toLocalInputValue } from '../format.js';
import { toast } from './alerts.js';
import { createRiverMap } from './riverMap.js';
import { ZONE_LABEL, ZONE_ORDER } from './zoneScene.js';

const dialog = () => $('#dialog');
const ANNOTATION_MAX = 140;

function open(content, { wide = false } = {}) {
  const element = dialog();
  element.className = `dialog${wide ? ' wide' : ''}`;
  element.innerHTML = String(content);
  element.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => element.close()));
  if (!element.open) element.showModal();
  return element;
}

function closeOnBackdropClick(event) {
  if (event.target === dialog()) dialog().close();
}

export function setupDialog() {
  dialog().addEventListener('click', closeOnBackdropClick);
}

function header(title, subtitle) {
  return html`
    <div class="dialog-head">
      <div><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
      <button class="icon-button close" type="button" data-close aria-label="Fechar">${icon('close')}</button>
    </div>`;
}

function showError(form, message) {
  const box = form.querySelector('.form-error');
  box.textContent = message.charAt(0).toUpperCase() + message.slice(1);
  box.classList.add('show');
}

const evenPosition = (index, count) => ((index + 1) * 100) / (count + 1);

function withPositions(nodes) {
  return nodes.map((node, index) => ({ ...node, riverPosition: node.riverPosition ?? evenPosition(index, nodes.length) }))
    .sort((a, b) => a.riverPosition - b.riverPosition);
}

// Each option is a gap between two places along the river. The value is the new position (0 to 100).
function slotOptions(others, currentPosition) {
  if (!others.length) return [{ label: 'No meio do rio', value: currentPosition ?? 50, neighbours: [] }];
  const options = [];
  for (let k = 0; k <= others.length; k += 1) {
    const before = others[k - 1];
    const after = others[k];
    const low = before ? before.riverPosition : 0;
    const high = after ? after.riverPosition : 100;
    const keepsCurrent = currentPosition !== null && currentPosition > low && currentPosition < high;
    const value = keepsCurrent ? currentPosition : Math.round(((low + high) / 2) * 100) / 100;
    let label;
    if (!before) label = `No início do rio (antes de ${after.name})`;
    else if (!after) label = `No fim do rio (depois de ${before.name})`;
    else label = `Entre ${before.name} e ${after.name}`;
    options.push({ label, value, neighbours: [before, after].filter(Boolean), keepsCurrent });
  }
  return options;
}

function placementFields(options, selectedIndex, zone, zonesReady) {
  return html`
    <div class="field-row two">
      <div class="field">
        <label for="node-zone">Zona</label>
        <select id="node-zone" name="zone">
          ${ZONE_ORDER.map((key) => html`<option value="${key}" ${key === zone ? 'selected' : ''}>${ZONE_LABEL[key]}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="node-slot">Posição no rio</label>
        <select id="node-slot" name="slot">
          ${options.map((option, index) => html`<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${option.label}</option>`)}
        </select>
      </div>
    </div>
    <div class="map-preview river-map" id="place-preview" aria-label="Prévia do mapa do rio"></div>
    <span class="help" style="margin-top:-8px">Prévia do mapa: da esquerda para a direita o rio passa pela zona rural, periurbana e urbana.</span>
    ${zonesReady === false ? html`<div class="note-box">Para guardar a zona e a posição, rode antes o script <code>13_zonas.sql</code>.</div>` : ''}`;
}

function setupPlacement(element, { others, options, previewNode, startZoneTouched }) {
  const zoneSelect = element.querySelector('#node-zone');
  const slotSelect = element.querySelector('#node-slot');
  const nameInput = element.querySelector('input[name="name"]');
  const preview = createRiverMap(element.querySelector('#place-preview'), { interactive: false });
  let zoneTouched = startZoneTouched;

  const suggestedZone = (option) => option.neighbours[0]?.zone ?? option.neighbours[1]?.zone ?? zoneSelect.value;
  const selected = () => options[Number(slotSelect.value)];
  function refresh() {
    const placed = { ...previewNode, name: nameInput.value.trim() || previewNode.name, zone: zoneSelect.value, riverPosition: selected().value };
    preview.update([...others, placed].sort((a, b) => a.riverPosition - b.riverPosition));
  }
  zoneSelect.addEventListener('change', () => {
    zoneTouched = true;
    refresh();
  });
  slotSelect.addEventListener('change', () => {
    if (!zoneTouched) zoneSelect.value = suggestedZone(selected()) ?? zoneSelect.value;
    refresh();
  });
  nameInput.addEventListener('input', refresh);
  refresh();
  return () => ({ zone: zoneSelect.value, riverPosition: selected().value });
}

export function openAddNodeDialog(overview, { presetId = null, onCreated }) {
  const calibrated = overview.nodes.filter((node) => node.calibration);
  const defaultSource = calibrated.find((node) => node.id === 2) ?? calibrated[0];
  const suggestedId = presetId ?? overview.nextFreeNodeId ?? '';
  const others = withPositions(overview.nodes);
  const options = slotOptions(others, null);
  const lastIndex = options.length - 1;
  const startZone = others[others.length - 1]?.zone ?? 'URBANA';

  const element = open(html`
    <form method="dialog" novalidate>
      ${header('Adicionar local', 'Cadastre um novo ponto do rio com um sensor (nó ESP32).')}
      <div class="dialog-body">
        <div class="field-row">
          <div class="field">
            <label for="node-id">Número do nó</label>
            <input id="node-id" name="id" type="number" min="1" max="255" required value="${suggestedId}">
          </div>
          <div class="field">
            <label for="node-name">Nome do local</label>
            <input id="node-name" name="name" type="text" maxlength="50" required placeholder="Ex.: Ponte da Rua das Flores" autocomplete="off">
          </div>
        </div>
        <p class="help" style="margin-top:-8px;color:var(--muted);font-size:12.5px">
          O número tem que ser igual ao <code>NODE_ID</code> gravado no ESP32 (arquivo <code>config.h</code>).
        </p>
        <div class="field">
          <label for="node-description">Descrição <span style="color:var(--muted);font-weight:500">(opcional)</span></label>
          <textarea id="node-description" name="description" maxlength="255" placeholder="Ex.: trecho baixo onde o rio transborda primeiro"></textarea>
        </div>
        ${placementFields(options, lastIndex, startZone, overview.zonesReady)}
        <div class="field">
          <label for="node-calibration">Calibração inicial</label>
          <select id="node-calibration" name="copyCalibrationFrom">
            ${calibrated.map((node) => html`<option value="${node.id}" ${node === defaultSource ? 'selected' : ''}>Copiar de ${node.name}${node === defaultSource ? ' (recomendado)' : ''}</option>`)}
            <option value="">Sem calibração (só valores em mV)</option>
          </select>
          <span class="help">A cópia é provisória: depois, meça os pontos seco, normal e transbordando no novo local.</span>
        </div>
        <div class="form-error" role="alert"></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">${icon('plus')} Cadastrar local</button>
      </div>
    </form>`, { wide: true });

  const form = element.querySelector('form');
  const placement = setupPlacement(element, {
    others,
    options,
    previewNode: { id: 'novo', name: 'Novo local', preview: true },
    startZoneTouched: false,
  });
  setTimeout(() => form.querySelector(presetId ? '#node-name' : '#node-id').focus(), 50);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const payload = {
      id: Number(data.id),
      name: data.name,
      description: data.description,
      ...placement(),
      copyCalibrationFrom: data.copyCalibrationFrom === '' ? null : Number(data.copyCalibrationFrom),
    };
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await api.createNode(payload);
      showCreated(result.node);
      onCreated?.(result.node);
    } catch (error) {
      showError(form, error.message);
      button.disabled = false;
    }
  });
}

function showCreated(node) {
  const element = open(html`
    <div class="dialog-content">
      ${header('Local cadastrado', '')}
      <div class="dialog-body">
        <div style="display:flex;gap:14px;align-items:center">
          <div class="success-mark">${icon('check')}</div>
          <div><strong style="font-size:17px">${node.name}</strong><br><span style="color:var(--muted)">Nó ${node.id} pronto para receber leituras.</span></div>
        </div>
        <div class="note-box">
          No ESP32 deste local, troque no <code>config.h</code> a linha do <code>NODE_ID</code> pela linha abaixo e grave o firmware <code>no_sensor</code>.
          Em até 15 segundos a primeira leitura aparece no painel.
        </div>
        <div class="code-line"><span>constexpr uint8_t NODE_ID = ${node.id};</span>
          <button class="btn btn-ghost" type="button" data-copy>${icon('copy')} Copiar</button></div>
        ${node.calibrated ? '' : html`<div class="note-box">Sem calibração: o painel vai mostrar só os valores em mV até a calibração ser cadastrada.</div>`}
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Fechar</button>
        <a class="btn btn-primary" href="#/local/${node.id}" data-close>Ver o local</a>
      </div>
    </div>`);
  element.querySelector('[data-copy]').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText(`constexpr uint8_t NODE_ID = ${node.id};`);
      event.currentTarget.textContent = 'Copiado';
    } catch {
      event.currentTarget.textContent = 'Copie à mão';
    }
  });
}

export function openEditNodeDialog(node, overview, { onSaved }) {
  const all = withPositions(overview.nodes);
  const self = all.find((item) => item.id === node.id);
  const others = all.filter((item) => item.id !== node.id);
  const options = slotOptions(others, self?.riverPosition ?? null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.keepsCurrent));

  const element = open(html`
    <form method="dialog" novalidate>
      ${header('Editar local', `Nó ${node.id}`)}
      <div class="dialog-body">
        <div class="field">
          <label for="edit-name">Nome do local</label>
          <input id="edit-name" name="name" type="text" maxlength="50" required value="${node.name}">
        </div>
        <div class="field">
          <label for="edit-description">Descrição</label>
          <textarea id="edit-description" name="description" maxlength="255">${node.description ?? ''}</textarea>
        </div>
        ${placementFields(options, selectedIndex, node.zone ?? 'URBANA', overview.zonesReady)}
        <div class="form-error" role="alert"></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">Salvar</button>
      </div>
    </form>`, { wide: true });
  const form = element.querySelector('form');
  const placement = setupPlacement(element, {
    others,
    options,
    previewNode: { ...node, preview: true },
    startZoneTouched: true,
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await api.updateNode(node.id, { name: data.name, description: data.description, ...placement() });
      element.close();
      onSaved?.();
    } catch (error) {
      showError(form, error.message);
    }
  });
}

function levelPhrase(level) {
  const text = levelText(level, null);
  return text.unit ? `${text.value} ${text.unit}` : text.value;
}

const signedMm = (mm) => `${mm > 0 ? '+' : mm < 0 ? '−' : ''}${formatNumber(Math.abs(mm))} mm`;

function rulerPreview(plan, uncertaintyMm) {
  const isWithinUncertainty = plan.errorMm !== null && Math.abs(plan.errorMm) <= uncertaintyMm;
  const verdict = plan.errorMm === null
    ? 'A água está fora da faixa do sensor: dá para guardar a medida, mas sem número de erro.'
    : isWithinUncertainty
      ? `Dentro da incerteza do sensor (± ${formatNumber(uncertaintyMm)} mm): não precisa ajustar. Vale guardar a medida.`
      : 'Diferença maior que a incerteza do sensor: vale ajustar.';
  return html`
    <div class="adjust-row"><span>Régua</span><b>${formatNumber(plan.rulerCm, 2)} cm <small>(${formatNumber(plan.rulerDepthMm)} mm de água)</small></b></div>
    <div class="adjust-row"><span>Sensor agora <small>mediana do último minuto · ${plan.sensorMv} mV</small></span><b>${levelPhrase(plan.before.level)}</b></div>
    <div class="adjust-row highlight ${isWithinUncertainty ? 'ok' : 'warn'}"><span>Diferença (sensor − régua)</span>
      <b>${plan.errorMm === null ? '—' : signedMm(plan.errorMm)}</b></div>
    <p class="tech-note">${verdict}</p>
    ${plan.after ? html`<div class="adjust-row"><span>Se ajustar, o painel passa a mostrar</span>
      <b>${levelPhrase(plan.after.level)} <small>(curva ${plan.shiftMv > 0 ? '+' : ''}${plan.shiftMv} mV)</small></b></div>`
      : html`<p class="tech-note">Ajuste indisponível: ${plan.adjustProblem}.</p>`}
    ${plan.canRecord ? '' : html`<p class="tech-note">Para guardar medidas, rode o <code>banco/14_anotacoes_regua.sql</code> e reinicie o sistema.</p>`}`;
}

export function openRulerAdjustDialog(node, { onDone }) {
  const current = node.latest?.level;
  const uncertaintyMm = node.geometry?.uncertaintyMm ?? 2;
  const element = open(html`
    <form method="dialog" novalidate>
      ${header('Medir com a régua', `${node.name} · nó ${node.id}`)}
      <div class="dialog-body">
        <ol class="steps">
          <li>Não mexa na água e espere 1 minuto.</li>
          <li>Encoste a régua no fundo da caixa, perto do sensor, e veja a altura da água.</li>
          <li>Digite o valor. O painel compara com o sensor no mesmo momento.</li>
        </ol>
        <div class="field-row">
          <div class="field">
            <label for="ruler-cm">A régua marca (cm)</label>
            <input id="ruler-cm" name="rulerCm" type="text" inputmode="decimal" placeholder="Ex.: 2,0" autocomplete="off" required>
          </div>
          <div class="field">
            <label>O painel mostra agora</label>
            <div class="readout">${current ? levelPhrase(current) : '—'} <small>(sensor ${node.latest?.levelMv ?? '—'} mV)</small></div>
          </div>
        </div>
        <div class="adjust-preview" id="adjust-preview" aria-live="polite"><span class="tech-note">Digite o valor da régua para comparar.</span></div>
        <p class="tech-note"><b>Só guardar a medida</b> não muda nada no sensor: serve para calcular o erro (página Sensores).
          <b>Guardar e ajustar</b> também cria uma nova versão da calibração; as leituras antigas continuam como estavam.</p>
        <div class="form-error" role="alert"></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn" type="submit" value="record" disabled>${icon('check')} Só guardar a medida</button>
        <button class="btn btn-primary" type="submit" value="adjust" disabled>${icon('ruler')} Guardar e ajustar</button>
      </div>
    </form>`);

  const form = element.querySelector('form');
  const input = element.querySelector('#ruler-cm');
  const previewBox = element.querySelector('#adjust-preview');
  const recordButton = form.querySelector('[value="record"]');
  const adjustButton = form.querySelector('[value="adjust"]');
  const errorBox = form.querySelector('.form-error');
  let timer = null;
  let request = 0;
  setTimeout(() => input.focus(), 50);

  async function loadPreview() {
    const value = input.value.trim();
    recordButton.disabled = true;
    adjustButton.disabled = true;
    errorBox.classList.remove('show');
    if (!value) return;
    const mine = ++request;
    try {
      const plan = await api.rulerPreview(node.id, value);
      if (mine !== request) return;
      previewBox.innerHTML = String(rulerPreview(plan, uncertaintyMm));
      recordButton.disabled = !plan.canRecord;
      adjustButton.disabled = plan.after === null;
    } catch (error) {
      if (mine !== request) return;
      previewBox.innerHTML = '';
      showError(form, error.message);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(loadPreview, 400);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const isAdjust = event.submitter?.value === 'adjust';
    recordButton.disabled = true;
    adjustButton.disabled = true;
    try {
      if (!isAdjust) {
        const { check } = await api.recordRuler(node.id, input.value.trim());
        dialog().close();
        toast({
          title: 'Medida guardada',
          message: check.errorMm === null ? `${node.name}: água fora da faixa do sensor.` : `${node.name}: diferença do sensor ${signedMm(check.errorMm)}.`,
        });
        onDone?.();
        return;
      }
      const result = await api.applyRuler(node.id, input.value.trim());
      open(html`
        <div class="dialog-content">
          ${header('Sensor ajustado', '')}
          <div class="dialog-body">
            <div style="display:flex;gap:14px;align-items:center">
              <div class="success-mark">${icon('check')}</div>
              <div><strong style="font-size:17px">${node.name}: agora ${levelPhrase(result.after.level)}</strong><br>
                <span style="color:var(--muted)">Calibração nº ${result.calibrationId} criada (curva deslocada ${result.shiftMv} mV).
                As próximas leituras já usam o ajuste.${result.checkRecorded ? ` A medida de antes (${result.errorMm === null ? 'fora da faixa' : signedMm(result.errorMm)}) foi guardada.` : ''}</span></div>
            </div>
          </div>
          <div class="dialog-foot"><button class="btn btn-primary" type="button" data-close>Fechar</button></div>
        </div>`);
      onDone?.();
    } catch (error) {
      showError(form, error.message);
      loadPreview();
    }
  });
}

const QUICK_NOTES = ['Coloquei água', 'Tirei água', 'Borrifei a placa (chuva)', 'Molhei o solo', 'Mexi no sensor', 'Teste de subida', 'Medi com a régua'];

export function openAnnotationDialog({ node, timeMs = Date.now(), onSaved }) {
  const element = open(html`
    <form method="dialog" novalidate>
      ${header('Nova anotação', node ? `${node.name} · aparece no gráfico, no replay e em "O que aconteceu"` : 'Aparece nos gráficos')}
      <div class="dialog-body">
        <div class="field">
          <label for="note-text">O que aconteceu</label>
          <input id="note-text" type="text" maxlength="${ANNOTATION_MAX}" placeholder="Ex.: coloquei 200 ml de água" autocomplete="off" required>
          <div class="quick-notes">${QUICK_NOTES.map((text) => html`<button class="btn btn-small" type="button" data-quick="${text}">${text}</button>`)}</div>
        </div>
        <div class="field-row two">
          <div class="field">
            <label for="note-time">Quando</label>
            <input id="note-time" type="datetime-local" value="${toLocalInputValue(timeMs)}" step="60">
          </div>
          ${node ? html`<label class="check-field"><input id="note-all" type="checkbox"> Vale para todos os locais</label>` : ''}
        </div>
        <div class="form-error" role="alert"></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">${icon('edit')} Anotar</button>
      </div>
    </form>`);

  const form = element.querySelector('form');
  const text = element.querySelector('#note-text');
  setTimeout(() => text.focus(), 50);
  element.querySelectorAll('[data-quick]').forEach((button) => button.addEventListener('click', () => {
    text.value = button.dataset.quick;
    text.focus();
  }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const when = new Date(element.querySelector('#note-time').value).getTime();
    const forAll = element.querySelector('#note-all')?.checked ?? true;
    try {
      const { annotation } = await api.addAnnotation({
        nodeId: node && !forAll ? node.id : null,
        timeMs: Number.isFinite(when) ? when : Date.now(),
        text: text.value,
      });
      dialog().close();
      toast({ title: 'Anotação guardada', message: annotation.text });
      onSaved?.(annotation);
    } catch (error) {
      showError(form, error.message);
    }
  });
}

export function openExplainDialog(overview) {
  const reference = overview.nodes.find((node) => node.limits);
  const limits = reference?.limits;
  const thresholds = overview.thresholds;
  // The v2 limits divide the free board in thirds, so the normal depth is 2 x attention - risk.
  const normalMm = limits ? 2 * limits.attention.depthMm - limits.risk.depthMm : null;
  const normalCm = limits ? limits.bed.rulerCm + normalMm / 10 : null;

  open(html`
    <div class="dialog-content">
      ${header('Como o alerta é calculado', thresholds ? `Limiares ativos: ${thresholds.name}` : '')}
      <div class="dialog-body explain">
        <p>A classe de cada local vem de uma <strong>árvore de decisão</strong> (sistema especialista) que roda no
          serviço em Python. Ela olha primeiro o <strong>nível do rio</strong>; chuva e solo só entram depois.</p>
        ${limits ? html`
          <h3>Os limites na régua da maquete</h3>
          <p>O espaço entre o rio normal (${formatLimitCm(normalCm)}) e a margem (${formatLimitCm(limits.overflow.rulerCm)})
            foi dividido em <strong>três partes iguais</strong>:</p>
          <div class="formula">folga = margem − normal = ${formatNumber(limits.overflow.depthMm, 1)} − ${formatNumber(normalMm, 1)} = ${formatNumber(limits.overflow.depthMm - normalMm, 1)} mm (lâmina sobre o leito)<br>
            Atenção = normal + folga/3 &nbsp;→ ${formatLimitCm(limits.attention.rulerCm)}<br>
            Risco &nbsp;&nbsp;= normal + 2·folga/3 → ${formatLimitCm(limits.risk.rulerCm)}</div>
          <table class="zone-table">
            <tr><td><span class="chip NORMAL">Normal</span></td><td>rio dentro do esperado</td><td>abaixo de ${formatLimitCm(limits.attention.rulerCm)}</td></tr>
            <tr><td><span class="chip ATENCAO">Atenção</span></td><td>possibilidade moderada de enchente</td><td>a partir de ${formatLimitCm(limits.attention.rulerCm)}</td></tr>
            <tr><td><span class="chip RISCO">Risco</span></td><td>possibilidade elevada de enchente</td><td>a partir de ${formatLimitCm(limits.risk.rulerCm)}</td></tr>
            <tr><td><span class="chip RISCO">Risco</span></td><td>transbordou: já é enchente</td><td>a partir de ${formatLimitCm(limits.overflow.rulerCm)}</td></tr>
          </table>
          <p>É a mesma ideia das três cotas do Serviço Geológico do Brasil (atenção, alerta e inundação). O SGB calcula
            essas cotas com o histórico de cheias de cada rio; a maquete não tem histórico, então a folga foi dividida em partes iguais.</p>` : ''}
        <h3>Regras extras</h3>
        <ul>
          <li><strong>Histerese:</strong> para sair de um alerta, o nível precisa baixar ${formatNumber(thresholds?.hysteresisMm ?? 2, 0)} mm abaixo do limite. Isso evita o alerta piscar.</li>
          <li><strong>Chuva + solo encharcado com rio normal:</strong> só aparece um aviso; a classe continua Normal.</li>
          <li><strong>Chuva + solo encharcado com rio em atenção:</strong> o alerta sobe para Risco antes de o nível chegar lá.</li>
          <li><strong>Rio seco:</strong> lâmina abaixo de ${formatNumber(thresholds?.dryDepthMm ?? 1, 0)} mm → aviso de seca, classe Normal.</li>
        </ul>
        <p class="tech-note">O nível mostrado é aproximado: no teste de 26/10 a diferença para a régua ficou em cerca de ±${formatNumber((overview.display?.uncertaintyMm ?? 2) / 10, 1)} cm.</p>
      </div>
      <div class="dialog-foot"><button class="btn btn-primary" type="button" data-close>Entendi</button></div>
    </div>`, { wide: true });
}
