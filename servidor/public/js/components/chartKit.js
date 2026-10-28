import { cssVar } from '../dom.js';
import { ApiError } from '../api.js';
import { formatLimitCm, formatShortTime, formatDateTime, formatFullDateTime, isSameDay, formatDay } from '../format.js';

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
const EXPORT_PIXEL_RATIO = 3;

// Images for the article always use the light theme, whatever the theme on screen.
const LIGHT = Object.freeze({
  text: '#334155', muted: '#64748b', grid: '#e2e8f0', surface: '#ffffff', water: '#2563eb',
  normal: '#22c55e', attention: '#f59e0b', risk: '#ef4444', offline: '#64748b', overflow: '#334155',
  note: '#7c3aed', ruler: '#0f172a',
});

export function palette(forceLight = false) {
  if (forceLight) return { ...LIGHT };
  return {
    text: cssVar('--text-2'),
    muted: cssVar('--muted'),
    grid: cssVar('--border'),
    surface: cssVar('--surface'),
    water: cssVar('--water'),
    normal: cssVar('--normal-line'),
    attention: cssVar('--attention-line'),
    risk: cssVar('--risk-line'),
    offline: cssVar('--offline'),
    overflow: cssVar('--text-2'),
    note: cssVar('--note'),
    ruler: cssVar('--text'),
  };
}

// Canvas does not read every CSS color syntax, so theme colors (hex) become rgba() here.
export function withAlpha(hexColor, alpha) {
  const hex = hexColor.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  if ([r, g, b].some(Number.isNaN)) return hexColor;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function statusColor(status, colors) {
  if (status === 'RISCO') return colors.risk;
  if (status === 'ATENCAO') return colors.attention;
  if (status === 'NORMAL') return colors.normal;
  return colors.offline;
}

const MINUTE_MS = 60 * 1000;
const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];
const TICK_MIN_SPACING_PX = 110;

function isMidnight(ms) {
  const date = new Date(ms);
  return date.getHours() === 0 && date.getMinutes() === 0;
}

export function tickFormatter(range) {
  const sameDay = isSameDay(range.fromMs, range.toMs);
  return (value) => {
    if (sameDay) return formatShortTime(value);
    return isMidnight(value) ? formatDay(value) : formatDateTime(value);
  };
}

// Time axis ticks on round clock times (09:00, 09:30…), counted from local midnight.
export function clockTicks(scale) {
  const { min, max } = scale;
  if (!(max > min)) return;
  const maxTicks = Math.max(3, Math.floor(scale.width / TICK_MIN_SPACING_PX));
  const stepMin = TICK_STEPS_MIN.find((step) => (max - min) / (step * MINUTE_MS) <= maxTicks) ?? TICK_STEPS_MIN.at(-1);
  const stepMs = stepMin * MINUTE_MS;
  const midnight = new Date(min);
  midnight.setHours(0, 0, 0, 0);
  const ticks = [];
  for (let value = midnight.getTime() + Math.ceil((min - midnight.getTime()) / stepMs) * stepMs; value <= max; value += stepMs) {
    ticks.push({ value });
  }
  scale.ticks = ticks;
}

export function applyAxisColors(chart, colors, axes) {
  window.Chart.defaults.font.family = FONT;
  for (const axis of axes) {
    const scale = chart.options.scales[axis];
    scale.ticks.color = colors.muted;
    scale.grid.color = colors.grid;
    if (scale.title) scale.title.color = colors.muted;
  }
  chart.options.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.92)';
}

export function limitsPlugin(getLimits, getColors) {
  return {
    id: 'limits',
    beforeDatasetsDraw(chart) {
      const limits = getLimits();
      if (!limits) return;
      const colors = getColors();
      const { ctx, chartArea: area, scales: { y } } = chart;
      const band = (fromCm, toCm, color) => {
        const top = Math.max(area.top, y.getPixelForValue(toCm));
        const bottom = Math.min(area.bottom, y.getPixelForValue(fromCm));
        if (bottom > top) {
          ctx.fillStyle = color;
          ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
        }
      };
      ctx.save();
      band(limits.attention.rulerCm, limits.risk.rulerCm, withAlpha(colors.attention, 0.08));
      band(limits.risk.rulerCm, limits.overflow.rulerCm, withAlpha(colors.risk, 0.08));
      band(limits.overflow.rulerCm, y.max, withAlpha(colors.risk, 0.15));
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const limits = getLimits();
      if (!limits) return;
      const colors = getColors();
      const { ctx, chartArea: area, scales: { y } } = chart;
      const lines = [
        { cm: limits.attention.rulerCm, color: colors.attention, label: `Atenção ${formatLimitCm(limits.attention.rulerCm)}`, dash: [6, 5] },
        { cm: limits.risk.rulerCm, color: colors.risk, label: `Risco ${formatLimitCm(limits.risk.rulerCm)}`, dash: [6, 5] },
        { cm: limits.overflow.rulerCm, color: colors.overflow, label: `Transborda ${formatLimitCm(limits.overflow.rulerCm)}`, dash: [2, 4] },
      ];
      ctx.save();
      ctx.font = `600 11.5px ${FONT}`;
      ctx.textAlign = 'right';
      for (const line of lines) {
        const py = y.getPixelForValue(line.cm);
        if (py < area.top || py > area.bottom) continue;
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(line.dash);
        ctx.beginPath();
        ctx.moveTo(area.left, py);
        ctx.lineTo(area.right, py);
        ctx.stroke();
        ctx.setLineDash([]);
        const textWidth = ctx.measureText(line.label).width;
        ctx.fillStyle = withAlpha(colors.surface, 0.85);
        ctx.fillRect(area.right - textWidth - 10, py - 16, textWidth + 8, 14);
        ctx.fillStyle = line.color;
        ctx.fillText(line.label, area.right - 6, py - 5);
      }
      ctx.restore();
    },
  };
}

const NOTE_LABEL_CHARS = 32;
const NOTE_ROW_HEIGHT = 18;

const shortNote = (text) => (text.length > NOTE_LABEL_CHARS ? `${text.slice(0, NOTE_LABEL_CHARS - 1)}…` : text);

// Notes of the authors: a dashed line at the time and a label at the top. Labels that would touch go one row down.
export function annotationsPlugin(getNotes, getColors) {
  return {
    id: 'annotations',
    afterDatasetsDraw(chart) {
      const notes = getNotes() ?? [];
      if (!notes.length) return;
      const colors = getColors();
      const { ctx, chartArea: area, scales: { x } } = chart;
      const placed = [];
      ctx.save();
      ctx.font = `600 11px ${FONT}`;
      for (const note of notes) {
        const px = x.getPixelForValue(note.timeMs);
        if (px < area.left || px > area.right) continue;
        ctx.strokeStyle = withAlpha(colors.note, 0.9);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, area.top);
        ctx.lineTo(px, area.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        const label = shortNote(note.label ?? note.text);
        const width = ctx.measureText(label).width + 12;
        const left = px + width + 4 > area.right ? px - width - 4 : px + 4;
        let row = 0;
        while (placed.some((other) => other.row === row && left < other.right + 4 && left + width > other.left - 4)) row += 1;
        placed.push({ left, right: left + width, row });
        const top = area.top + 4 + row * NOTE_ROW_HEIGHT;
        ctx.fillStyle = colors.note;
        ctx.beginPath();
        ctx.roundRect(left, top, width, NOTE_ROW_HEIGHT - 3, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, left + 6, top + 11.5);
      }
      ctx.restore();
    },
  };
}

export function crosshairPlugin(getColors) {
  return {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.() ?? [];
      if (!active.length) return;
      const { ctx, chartArea: area } = chart;
      ctx.save();
      ctx.strokeStyle = withAlpha(getColors().muted, 0.6);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(active[0].element.x, area.top);
      ctx.lineTo(active[0].element.x, area.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

// During a replay the future part of the chart is covered and a line shows the replay time.
export function replayPlugin(getReplayMs, getColors) {
  return {
    id: 'replay',
    afterDraw(chart) {
      const replayMs = getReplayMs();
      if (replayMs === null) return;
      const { ctx, chartArea: area, scales: { x } } = chart;
      const px = Math.min(area.right, Math.max(area.left, x.getPixelForValue(replayMs)));
      const colors = getColors();
      ctx.save();
      ctx.fillStyle = withAlpha(colors.surface, 0.72);
      ctx.fillRect(px, area.top, area.right - px, area.bottom - area.top);
      ctx.strokeStyle = colors.water;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, area.top);
      ctx.lineTo(px, area.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/*
 * Takes a picture of the chart for the article: light colors, three times the screen resolution,
 * a title, a legend line and the source. The chart on screen is restored after.
 */
export function exportChartPng(chart, rerender, { title, subtitle, legend = [], fileName }) {
  const previousRatio = chart.options.devicePixelRatio;
  const previousAnimation = chart.options.animation;
  chart.options.animation = false;
  chart.options.devicePixelRatio = EXPORT_PIXEL_RATIO;
  rerender(true);
  chart.resize();
  chart.update('none');

  const source = chart.canvas;
  const scale = EXPORT_PIXEL_RATIO;
  const pad = 24 * scale;
  const header = 78 * scale;
  const footer = (legend.length ? 62 : 34) * scale;
  const output = document.createElement('canvas');
  output.width = source.width + pad * 2;
  output.height = source.height + header + footer;
  const ctx = output.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 ${20 * scale}px ${FONT}`;
  ctx.fillText(title, pad, pad + 18 * scale);
  ctx.fillStyle = '#64748b';
  ctx.font = `500 ${13 * scale}px ${FONT}`;
  ctx.fillText(subtitle, pad, pad + 42 * scale);
  ctx.drawImage(source, pad, header);

  let legendX = pad;
  const legendY = header + source.height + 22 * scale;
  ctx.font = `600 ${12 * scale}px ${FONT}`;
  for (const item of legend) {
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, legendY - 8 * scale, 16 * scale, 6 * scale);
    ctx.fillStyle = '#334155';
    ctx.fillText(item.label, legendX + 22 * scale, legendY);
    legendX += ctx.measureText(item.label).width + 44 * scale;
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = `500 ${11 * scale}px ${FONT}`;
  ctx.fillText(`Fonte: painel do protótipo de monitoramento de enchentes (TCC) · gerado em ${formatFullDateTime(Date.now())}`,
    pad, output.height - 14 * scale);

  chart.options.devicePixelRatio = previousRatio;
  chart.options.animation = previousAnimation;
  rerender(false);
  chart.resize();
  chart.update('none');

  output.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

// A server answer has a message for the user; any other error is a fault in the page code.
export function showChartError(box, error) {
  const isServerAnswer = error instanceof ApiError;
  box.textContent = isServerAnswer ? error.message : 'Não consegui desenhar o gráfico. Recarregue a página (F5).';
  box.classList.add('show');
  if (!isServerAnswer) console.error(error);
}
