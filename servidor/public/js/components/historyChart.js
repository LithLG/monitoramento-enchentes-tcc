import { STATUS_LABEL, formatNumber, formatFullDateTime } from '../format.js';
import {
  palette, withAlpha, statusColor, tickFormatter, clockTicks, applyAxisColors,
  limitsPlugin, crosshairPlugin, replayPlugin, annotationsPlugin, exportChartPng,
} from './chartKit.js';

const STRIP_HEIGHT = 7;
const GAP_FACTOR = 3;
const SERIES = Object.freeze({ LEVEL: 0, BAND_MIN: 1, BAND_MAX: 2, RAIN: 3, SOIL: 4, LEVEL_AREA: 5, RULER: 6 });
const NEAR_CHECK_MS = 60 * 1000;

const signedMm = (mm) => `${mm > 0 ? '+' : mm < 0 ? '−' : ''}${formatNumber(Math.abs(mm))} mm`;

// A long time without readings must show as a hole in the line, not as a straight line.
function withGaps(points, bucketMs) {
  const result = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const hasGap = previous && point.timeMs - previous.timeMs > GAP_FACTOR * bucketMs;
    if (hasGap) result.push({ timeMs: previous.timeMs + bucketMs, gap: true });
    result.push(point);
  });
  return result;
}

export function createHistoryChart(canvas) {
  let colors = palette();
  let state = { limits: null, points: [], range: null, notes: [], checks: [], bucketMs: 0 };
  let lastInput = null;
  let replayMs = null;

  const statusStripPlugin = {
    id: 'statusStrip',
    afterDraw(chart) {
      const { points } = state;
      if (!points.length) return;
      const { ctx, chartArea: area, scales: { x } } = chart;
      const top = area.bottom + 4;
      ctx.save();
      points.forEach((point, index) => {
        if (point.gap || !point.status) return;
        const next = points[index + 1];
        const startX = Math.max(area.left, x.getPixelForValue(point.timeMs));
        const endX = Math.min(area.right, next ? x.getPixelForValue(next.timeMs) : startX + 3);
        if (endX <= startX) return;
        ctx.fillStyle = statusColor(point.status, colors);
        ctx.fillRect(startX, top, Math.max(1, endX - startX), STRIP_HEIGHT);
      });
      ctx.restore();
    },
  };

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: { datasets: [] },
    plugins: [
      limitsPlugin(() => state.limits, () => colors),
      statusStripPlugin,
      crosshairPlugin(() => colors),
      annotationsPlugin(() => state.notes, () => colors),
      replayPlugin(() => replayMs, () => colors),
    ],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      normalized: true,
      parsing: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => ![SERIES.BAND_MIN, SERIES.BAND_MAX, SERIES.LEVEL_AREA, SERIES.RULER].includes(item.datasetIndex)
            && !(item.datasetIndex === SERIES.RAIN && !item.raw?.y),
          callbacks: {
            title: (items) => (items.length ? formatFullDateTime(items[0].raw.x) : ''),
            label: (item) => {
              const point = item.raw.point;
              if (item.datasetIndex === SERIES.LEVEL) {
                if (item.raw.y === null) return 'Nível: sem leitura';
                return point?.above ? `Nível: acima de ${formatNumber(item.raw.y)} cm (transbordou)` : `Nível: ${formatNumber(item.raw.y)} cm na régua`;
              }
              if (item.datasetIndex === SERIES.RAIN) return `Chuva: placa molhada em ${Math.round(item.raw.y * 100)}% das leituras`;
              if (item.datasetIndex === SERIES.SOIL) return `Solo: ${Math.min(100, Math.round(item.raw.y * 100))}% do encharcado`;
              return '';
            },
            afterBody: (items) => {
              const level = items.find((item) => item.datasetIndex === SERIES.LEVEL)?.raw;
              const point = level?.point;
              const lines = point?.status ? [`Classe: ${STATUS_LABEL[point.status]}`] : [];
              const nearMs = Math.max(NEAR_CHECK_MS, state.bucketMs);
              const near = (timeMs) => level && Math.abs(timeMs - level.x) <= nearMs;
              state.checks.filter((check) => near(check.timeMs)).forEach((check) => lines.push(
                `Régua: ${formatNumber(check.rulerCm, 2)} cm${check.errorMm === null ? '' : ` (sensor ${signedMm(check.errorMm)})`}`,
              ));
              state.notes.filter((note) => near(note.timeMs)).forEach((note) => lines.push(`Anotação: ${note.text}`));
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          afterBuildTicks: clockTicks,
          ticks: { maxRotation: 0, autoSkipPadding: 18, padding: 14 },
          grid: { drawTicks: false },
          border: { display: false },
        },
        y: {
          title: { display: true, text: 'Nível na régua (cm)' },
          ticks: { callback: (value) => formatNumber(value, 1) },
          border: { display: false },
        },
        yRain: { display: false, min: 0, max: 6 },
        ySoil: {
          position: 'right',
          min: 0,
          title: { display: true, text: 'Solo (% do encharcado)' },
          ticks: { callback: (value) => `${Math.round(value * 100)}%` },
          grid: { drawOnChartArea: false },
          border: { display: false },
        },
      },
    },
  });

  function render(history, visibility, forceLight) {
    colors = palette(forceLight);
    applyAxisColors(chart, colors, ['x', 'y', 'ySoil']);
    const bucketMs = history.bucketSeconds * 1000;
    const points = withGaps(history.points, bucketMs);
    state = {
      limits: history.limits,
      points,
      range: history.range,
      notes: history.annotations ?? [],
      checks: history.rulerChecks ?? [],
      bucketMs,
    };

    const levelData = points.map((p) => ({ x: p.timeMs, y: p.gap ? null : p.rulerCm, point: p }));
    const values = levelData.map((p) => p.y).filter((v) => v !== null);
    const topCm = Math.max(4, (history.limits?.overflow.rulerCm ?? 3.5) + 0.35, ...values.map((v) => v + 0.2));
    const bottomCm = Math.min(0.8, ...values.map((v) => v - 0.2));
    const soilValues = points.map((p) => p.soilIndex ?? 0);

    chart.options.scales.x.min = history.range.fromMs;
    chart.options.scales.x.max = history.range.toMs;
    chart.options.scales.x.ticks.callback = tickFormatter(history.range);
    chart.options.scales.y.min = Math.floor(bottomCm * 10) / 10;
    chart.options.scales.y.max = Math.ceil(topCm * 10) / 10;
    chart.options.scales.ySoil.max = Math.max(1.2, ...soilValues);
    chart.options.scales.ySoil.display = visibility.soil;

    chart.data.datasets = [
      {
        label: 'Nível',
        data: levelData,
        yAxisID: 'y',
        borderWidth: 2.6,
        pointRadius: points.length < 20 ? 3 : 0,
        pointBackgroundColor: colors.water,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: colors.water,
        tension: 0.25,
        spanGaps: false,
        fill: false,
        borderColor: colors.water,
        segment: { borderColor: (ctx) => statusColor(ctx.p1.raw?.point?.status ?? ctx.p0.raw?.point?.status, colors) },
        order: 1,
      },
      {
        label: 'mín',
        data: points.map((p) => ({ x: p.timeMs, y: p.gap ? null : p.minCm })),
        yAxisID: 'y',
        borderWidth: 0,
        pointRadius: 0,
        fill: false,
        hidden: !visibility.band,
        order: 3,
      },
      {
        label: 'máx',
        data: points.map((p) => ({ x: p.timeMs, y: p.gap ? null : p.maxCm })),
        yAxisID: 'y',
        borderWidth: 0,
        pointRadius: 0,
        fill: '-1',
        backgroundColor: withAlpha(colors.water, 0.18),
        hidden: !visibility.band,
        order: 3,
      },
      {
        type: 'bar',
        label: 'Chuva',
        data: points.map((p) => ({ x: p.timeMs, y: p.gap ? 0 : p.rainShare })),
        yAxisID: 'yRain',
        backgroundColor: withAlpha('#0ea5e9', 0.35),
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1,
        hidden: !visibility.rain,
        order: 4,
      },
      {
        label: 'Solo',
        data: points.map((p) => ({ x: p.timeMs, y: p.gap ? null : p.soilIndex })),
        yAxisID: 'ySoil',
        borderColor: '#a16207',
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        hidden: !visibility.soil,
        order: 2,
      },
      {
        // The colored line is drawn in segments; the area under it is one shape, so it has no seams.
        label: 'Área do nível',
        data: levelData,
        yAxisID: 'y',
        borderWidth: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.25,
        spanGaps: false,
        fill: 'start',
        backgroundColor: withAlpha(colors.water, 0.14),
        order: 5,
      },
      {
        type: 'scatter',
        label: 'Régua',
        data: state.checks.map((check) => ({ x: check.timeMs, y: check.rulerCm })),
        yAxisID: 'y',
        pointStyle: 'rectRot',
        pointRadius: 7,
        pointHoverRadius: 8,
        backgroundColor: colors.ruler,
        borderColor: colors.surface,
        borderWidth: 1.5,
        order: 0,
      },
    ];
  }

  function update(history, visibility) {
    lastInput = { history, visibility };
    render(history, visibility, false);
    chart.update();
  }

  function setReplayTime(timeMs) {
    replayMs = timeMs;
    chart.draw();
  }

  function exportPng({ title, subtitle, fileName }) {
    if (!lastInput) return;
    const light = palette(true);
    exportChartPng(chart, (forceLight) => render(lastInput.history, lastInput.visibility, forceLight), {
      title,
      subtitle,
      fileName,
      legend: [
        { color: light.normal, label: 'Normal' },
        { color: light.attention, label: 'Atenção' },
        { color: light.risk, label: 'Risco' },
        ...(lastInput.visibility.rain ? [{ color: '#7dd3fc', label: 'Chuva' }] : []),
        ...(lastInput.visibility.soil ? [{ color: '#a16207', label: 'Solo' }] : []),
        ...(lastInput.history.rulerChecks?.length ? [{ color: light.ruler, label: 'Régua (medida)' }] : []),
        ...(lastInput.history.annotations?.length ? [{ color: light.note, label: 'Anotação' }] : []),
      ],
    });
  }

  return { update, setReplayTime, exportPng, destroy: () => chart.destroy() };
}
