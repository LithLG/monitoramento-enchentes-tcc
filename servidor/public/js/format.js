export const STATUS_LABEL = { NORMAL: 'Normal', ATENCAO: 'Atenção', RISCO: 'Risco' };
export const STATUS_ORDER = { NORMAL: 0, ATENCAO: 1, RISCO: 2 };

export const RULE_LABEL = {
  NIVEL_NORMAL: 'Nível normal',
  NIVEL_ATENCAO: 'Nível em atenção',
  NIVEL_RISCO: 'Nível de risco',
  TRANSBORDOU: 'Transbordou',
  RIO_SECO: 'Rio seco',
  HISTERESE_MANTEM_ATENCAO: 'Atenção mantida até o nível baixar',
  HISTERESE_MANTEM_RISCO: 'Risco mantido até o nível baixar',
  AVISO_SOLO_CHUVA: 'Chuva com solo encharcado',
  ESCALADA_SOLO_CHUVA: 'Chuva + solo encharcado elevaram o alerta',
  NIVEL_ACIMA_DA_FAIXA: 'Acima da faixa do sensor',
  PRECURSORES_SOLO_CHUVA: 'Precursores (regra antiga)',
};

export const RULE_HELP = {
  NIVEL_NORMAL: 'A água está abaixo do limite de atenção.',
  NIVEL_ATENCAO: 'A água passou do limite de atenção. Possibilidade moderada de enchente.',
  NIVEL_RISCO: 'A água passou do limite de risco. Possibilidade elevada de enchente.',
  TRANSBORDOU: 'A água passou da margem: o rio está transbordando.',
  RIO_SECO: 'Quase não há água no leito. A classe continua Normal, com aviso de seca.',
  HISTERESE_MANTEM_ATENCAO: 'O nível baixou um pouco, mas o alerta só sai quando baixar 2 mm abaixo do limite (evita alerta piscando).',
  HISTERESE_MANTEM_RISCO: 'O nível baixou um pouco, mas o alerta só sai quando baixar 2 mm abaixo do limite (evita alerta piscando).',
  AVISO_SOLO_CHUVA: 'Está chovendo e o solo não absorve mais água. O rio está normal, mas pode subir.',
  ESCALADA_SOLO_CHUVA: 'O rio já estava em atenção e chove sobre solo encharcado: o alerta subiu para Risco antes de o nível chegar lá.',
  NIVEL_ACIMA_DA_FAIXA: 'Leitura antiga: a água estava acima do topo do sensor.',
  PRECURSORES_SOLO_CHUVA: 'Leitura antiga, com a regra anterior de precursores.',
};

export const WARNING_RULES = new Set(['RIO_SECO', 'AVISO_SOLO_CHUVA', 'TRANSBORDOU', 'ESCALADA_SOLO_CHUVA']);

export const CONNECTION_LABEL = {
  ONLINE: 'Online',
  ATRASADO: 'Atrasado',
  SEM_SINAL: 'Sem sinal',
  NUNCA_ENVIOU: 'Aguardando o primeiro envio',
};

export const TREND_LABEL = {
  SUBINDO: 'Subindo',
  ESTAVEL: 'Estável',
  BAIXANDO: 'Baixando',
  TRANSBORDANDO: 'Transbordando',
  INDEFINIDA: 'Sem dados',
};

const numberFormat = (digits) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const ONE_DECIMAL = numberFormat(1);
const TWO_DECIMALS = numberFormat(2);
const NO_DECIMALS = numberFormat(0);

export const formatNumber = (value, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (digits === 0) return NO_DECIMALS.format(value);
  return digits === 2 ? TWO_DECIMALS.format(value) : ONE_DECIMAL.format(value);
};

export const formatCm = (value, digits = 1) => `${formatNumber(value, digits)} cm`;

// Limits such as 2.65 cm need two decimals; levels such as 2.2 cm need one.
export const formatLimitCm = (value) => formatCm(value, Number.isInteger(Math.round(value * 100) / 10) ? 1 : 2);

const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const SHORT_TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const FULL_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const DAY = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export const formatTime = (ms) => (ms ? TIME.format(ms) : '—');
export const formatShortTime = (ms) => (ms ? SHORT_TIME.format(ms) : '—');
export const formatDateTime = (ms) => (ms ? DATE_TIME.format(ms) : '—');
export const formatFullDateTime = (ms) => (ms ? FULL_DATE_TIME.format(ms) : '—');
export const formatDay = (ms) => DAY.format(ms);

export function isSameDay(aMs, bMs) {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

// Value for <input type="datetime-local">, in the local time of the browser.
export const toLocalInputValue = (ms) => {
  const local = new Date(ms - new Date(ms).getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

export const formatAgo = (ms, nowMs) => (ms ? `há ${formatDuration(nowMs - ms)}` : '—');

export function levelText(level, rule) {
  if (!level || level.kind === 'SEM_CALIBRACAO') return { value: '—', unit: '', sub: 'Sem calibração: só valores em mV' };
  if (level.kind === 'ACIMA') return { value: `≥ ${formatNumber(level.rulerCm)}`, unit: 'cm', sub: 'Acima do topo do sensor' };
  const isDry = level.kind === 'ABAIXO' || rule === 'RIO_SECO';
  if (isDry) return { value: 'Seco', unit: '', sub: 'Sem água no leito do rio' };
  return { value: formatNumber(level.rulerCm), unit: 'cm', sub: `Lâmina de ${formatNumber(level.depthMm)} mm sobre o leito` };
}

export function soilText(soilIndex, saturated) {
  if (soilIndex === null || soilIndex === undefined) return { value: '—', sub: 'Sem calibração' };
  const percent = Math.min(100, Math.max(0, Math.round(soilIndex * 100)));
  return { value: `${percent}%`, sub: saturated ? 'Encharcado: não absorve mais água' : 'Ainda absorve água' };
}
