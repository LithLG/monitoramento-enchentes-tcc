import { formatNumber, formatFullDateTime, STATUS_LABEL } from '../format.js';
import { palette, applyAxisColors, tickFormatter, clockTicks, annotationsPlugin, limitsPlugin, crosshairPlugin, exportChartPng } from './chartKit.js';

// Line colors for the places. They are not green, amber or red, because those colors mean a class.
export const PLACE_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#9a3412', '#0891b2', '#4d7c0f', '#475569'];

const GAP_FACTOR = 3;

function lineData(history) {
  const bucketMs = history.bucketSeconds * 1000;
  const data = [];
  history.points.forEach((point, index) => {
    const previous = history.points[index - 1];
    if (previous && point.timeMs - previous.timeMs > GAP_FACTOR * bucketMs) data.push({ x: previous.timeMs + bucketMs, y: null });
    data.push({ x: point.timeMs, y: point.rulerCm, point });
  });
  return data;
}

// A note of one place says which place; a note for all places is shown once.
function notesOf(histories, hidden) {
  const byId = new Map();
  for (const history of histories) {
    for (const note of history.annotations ?? []) {
      const isVisible = note.nodeId === null || !hidden.has(note.nodeId);
      if (!isVisible || byId.has(note.id)) continue;
      byId.set(note.id, { ...note, label: note.nodeId === null ? note.text : `${history.node.name}: ${note.text}` });
    }
  }
  return [...byId.values()].sort((a, b) => a.timeMs - b.timeMs);
}

export function createCompareChart(canvas) {
  let colors = palette();
  let limits = null;
  let notes = [];
  let lastInput = null;

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: { datasets: [] },
    plugins: [limitsPlugin(() => limits, () => colors), crosshairPlugin(() => colors), annotationsPlugin(() => notes, () => colors)],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? formatFullDateTime(items[0].raw.x) : ''),
            label: (item) => {
              if (item.raw.y === null) return `${item.dataset.label}: sem leitura`;
              const point = item.raw.point;
              const value = point?.above ? `acima de ${formatNumber(item.raw.y)} cm` : `${formatNumber(item.raw.y)} cm`;
              return `${item.dataset.label}: ${value}${point?.status ? ` (${STATUS_LABEL[point.status]})` : ''}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', afterBuildTicks: clockTicks, ticks: { maxRotation: 0, autoSkipPadding: 18 }, grid: { drawTicks: false }, border: { display: false } },
        y: {
          title: { display: true, text: 'Nível na régua (cm)' },
          ticks: { callback: (value) => formatNumber(value, 1) },
          border: { display: false },
        },
      },
    },
  });

  function render(histories, hidden, forceLight) {
    colors = palette(forceLight);
    applyAxisColors(chart, colors, ['x', 'y']);
    limits = histories.find((h) => h.limits)?.limits ?? null;
    notes = notesOf(histories, hidden);
    const range = histories[0]?.range;
    if (range) {
      chart.options.scales.x.min = range.fromMs;
      chart.options.scales.x.max = range.toMs;
      chart.options.scales.x.ticks.callback = tickFormatter(range);
    }
    const values = histories.flatMap((h) => h.points.map((p) => p.rulerCm)).filter((v) => v !== null);
    chart.options.scales.y.min = Math.floor(Math.min(0.8, ...values.map((v) => v - 0.2)) * 10) / 10;
    chart.options.scales.y.max = Math.ceil(Math.max(4, (limits?.overflow.rulerCm ?? 3.5) + 0.35, ...values.map((v) => v + 0.2)) * 10) / 10;

    chart.data.datasets = histories.map((history, index) => ({
      label: history.node.name,
      data: lineData(history),
      borderColor: PLACE_COLORS[index % PLACE_COLORS.length],
      backgroundColor: PLACE_COLORS[index % PLACE_COLORS.length],
      borderWidth: 2.4,
      pointRadius: history.points.length < 20 ? 3 : 0,
      pointHoverRadius: 5,
      tension: 0.25,
      spanGaps: false,
      hidden: hidden.has(history.node.id),
    }));
  }

  function update(histories, hidden) {
    lastInput = { histories, hidden };
    render(histories, hidden, false);
    chart.update();
  }

  function exportPng({ title, subtitle, fileName }) {
    if (!lastInput) return;
    exportChartPng(chart, (forceLight) => render(lastInput.histories, lastInput.hidden, forceLight), {
      title,
      subtitle,
      fileName,
      legend: lastInput.histories
        .map((history, index) => ({ color: PLACE_COLORS[index % PLACE_COLORS.length], label: history.node.name, id: history.node.id }))
        .filter((item) => !lastInput.hidden.has(item.id)),
    });
  }

  return { update, exportPng, destroy: () => chart.destroy() };
}
