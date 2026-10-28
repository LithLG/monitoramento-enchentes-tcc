import { html } from '../dom.js';
import { icon } from '../icons.js';
import { STATUS_LABEL, RULE_LABEL, RULE_HELP, formatLimitCm, formatNumber } from '../format.js';

const ANSWER = Object.freeze({ YES: 'yes', NO: 'no', SKIPPED: 'skip' });
const ANSWER_TEXT = { yes: 'sim', no: 'não', skip: '' };

const chip = (status, note = '') => html`<span class="chip ${status}">${STATUS_LABEL[status]}</span>${note ? html`<small class="flow-note">${note}</small>` : ''}`;

// Rows before the chosen one were tested and failed; rows after it were not reached.
const answersUntil = (count, chosenIndex) => Array.from({ length: count }, (_, i) => {
  if (i < chosenIndex) return ANSWER.NO;
  return i === chosenIndex ? ANSWER.YES : ANSWER.SKIPPED;
});

function row({ answer, question, outcome, detail = '' }) {
  return html`
    <li class="flow-row ${answer}">
      <span class="flow-answer" aria-hidden="true">${answer === ANSWER.YES ? icon('check') : answer === ANSWER.NO ? icon('close') : ''}</span>
      <div class="flow-question">${question}${detail ? html`<small>${detail}</small>` : ''}</div>
      <div class="flow-outcome">${outcome}</div>
      <span class="sr-only">${ANSWER_TEXT[answer]}</span>
    </li>`;
}

function step(number, title, inputs, rows, result) {
  return html`
    <section class="flow-step">
      <header class="flow-head">
        <span class="flow-number">${number}</span>
        <div><h3>${title}</h3><div class="flow-inputs">${inputs}</div></div>
      </header>
      <ol class="flow-rows">${rows}</ol>
      <footer class="flow-result"><span>Saída deste passo</span>${chip(result.status)}</footer>
    </section>`;
}

function levelText(level) {
  if (level.kind === 'ACIMA') return 'acima do topo do sensor';
  return `${formatNumber(level.rulerCm, 2)} cm na régua (${formatNumber(level.depthMm)} mm de água)`;
}

function levelStep({ inputs, steps, limits }) {
  const isAbove = inputs.level.kind === 'ACIMA';
  const rules = [
    { rule: 'TRANSBORDOU', above: true, question: 'A água passou do topo do sensor?', outcome: chip('RISCO', 'Transbordou') },
    { rule: 'RIO_SECO', question: `Quase sem água? (menos de ${formatNumber(limits.dry.depthMm)} mm · régua abaixo de ${formatLimitCm(limits.dry.rulerCm)})`, outcome: chip('NORMAL', 'Rio seco') },
    { rule: 'TRANSBORDOU', above: false, question: `Chegou na margem? (${formatLimitCm(limits.overflow.rulerCm)} ou mais)`, outcome: chip('RISCO', 'Transbordou') },
    { rule: 'NIVEL_RISCO', question: `Passou do limite de risco? (${formatLimitCm(limits.risk.rulerCm)} ou mais)`, outcome: chip('RISCO') },
    { rule: 'NIVEL_ATENCAO', question: `Passou do limite de atenção? (${formatLimitCm(limits.attention.rulerCm)} ou mais)`, outcome: chip('ATENCAO') },
    { rule: 'NIVEL_NORMAL', question: `Abaixo de ${formatLimitCm(limits.attention.rulerCm)}`, outcome: chip('NORMAL') },
  ];
  const chosen = rules.findIndex((item) => item.rule === steps.byLevel.rule && (item.above === undefined || item.above === isAbove));
  const answers = answersUntil(rules.length, chosen);
  return step(1, 'Nível do rio', html`<span class="flow-input">${icon('ruler')} ${levelText(inputs.level)}</span>`,
    rules.map((item, i) => row({ answer: answers[i], question: item.question, outcome: item.outcome })), steps.byLevel);
}

function hysteresisStep({ inputs, steps, limits }) {
  const held = steps.afterHysteresis.rule.startsWith('HISTERESE_MANTEM');
  const previous = inputs.previousStatus;
  const first = steps.previousWasHigher ? ANSWER.YES : ANSWER.NO;
  const second = !steps.previousWasHigher ? ANSWER.SKIPPED : held ? ANSWER.YES : ANSWER.NO;
  const exits = `Risco só sai abaixo de ${formatLimitCm(limits.riskExit.rulerCm)} · Atenção só sai abaixo de ${formatLimitCm(limits.attentionExit.rulerCm)}`;
  return step(2, 'Folga para o alerta descer',
    html`<span class="flow-input">${icon('clock')} Classe da leitura anterior: ${previous ? STATUS_LABEL[previous] : 'nenhuma'}</span>`,
    [
      row({
        answer: first,
        question: 'A leitura anterior estava numa classe mais alta?',
        detail: 'Só vale com a água dentro da faixa do sensor.',
        outcome: first === ANSWER.NO ? html`<span class="flow-keep">segue igual</span>` : '',
      }),
      row({
        answer: second,
        question: 'A água ainda está dentro da folga de 2 mm?',
        detail: exits,
        outcome: second === ANSWER.YES ? chip(steps.afterHysteresis.status, 'mantém')
          : second === ANSWER.NO ? html`<span class="flow-keep">pode descer</span>` : '',
      }),
    ], steps.afterHysteresis);
}

function rainStep({ inputs, steps, soilSaturatedIndex }) {
  const both = steps.isRaining && steps.soilIsSaturated;
  const before = steps.afterHysteresis.status;
  const soilPercent = Math.max(0, Math.min(100, Math.round(inputs.soilIndex * 100)));
  const branches = [
    { status: 'ATENCAO', question: 'Estava em Atenção?', outcome: chip('RISCO', 'sobe antes do nível chegar') },
    { status: 'NORMAL', question: 'Estava Normal?', outcome: chip('NORMAL', 'continua, com aviso') },
    { status: 'RISCO', question: 'Estava em Risco?', outcome: chip('RISCO', 'continua') },
  ];
  const chosen = both ? branches.findIndex((item) => item.status === before) : -1;
  const answers = both ? answersUntil(branches.length, chosen) : branches.map(() => ANSWER.SKIPPED);
  return step(3, 'Chuva com solo encharcado',
    html`<span class="flow-input">${icon(steps.isRaining ? 'rain' : 'sun')} ${steps.isRaining ? 'Chovendo' : 'Sem chuva'}</span>
      <span class="flow-input">${icon('soil')} Solo ${soilPercent}% (encharcado a partir de ${Math.round(soilSaturatedIndex * 100)}%)</span>`,
    [
      row({
        answer: both ? ANSWER.YES : ANSWER.NO,
        question: 'Está chovendo E o solo está encharcado?',
        detail: 'Chuva sozinha não muda a classe: o rio precisa subir primeiro.',
        outcome: both ? '' : html`<span class="flow-keep">segue igual</span>`,
      }),
      ...branches.map((item, i) => row({ answer: answers[i], question: item.question, outcome: item.outcome })),
    ], steps.final);
}

export function decisionFlow(result) {
  const { final } = result.steps;
  return html`
    <div class="flow">
      ${levelStep(result)}
      <span class="flow-arrow" aria-hidden="true">${icon('back')}</span>
      ${hysteresisStep(result)}
      <span class="flow-arrow" aria-hidden="true">${icon('back')}</span>
      ${rainStep(result)}
    </div>
    <div class="flow-final ${final.status}">
      <span class="flow-final-label">Resultado</span>
      <span class="chip lg ${final.status}">${STATUS_LABEL[final.status]}</span>
      <div><strong>${RULE_LABEL[final.rule] ?? final.rule}</strong><p>${RULE_HELP[final.rule] ?? ''}</p></div>
    </div>`;
}
