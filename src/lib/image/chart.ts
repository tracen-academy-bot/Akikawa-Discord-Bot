import type { SKRSContext2D } from '@napi-rs/canvas';
import { font } from './fonts';
import { THEME, drawLabel } from './theme';

/**
 * Line and area chart drawing, shared by the trainer report and the benchmark.
 *
 * Deliberately small: a fixed set of marks that suit these two reports, rather
 * than a general charting library. Both reports plot an evenly spaced day axis,
 * so the x scale is always categorical.
 */

const TEXT_FAINT = THEME.faint;
const HAIRLINE = THEME.line;

/** How a series' line is stroked. Distinguishes series without relying on colour alone. */
export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** Marker drawn at each data point. */
export type Marker = 'none' | 'circle' | 'triangle' | 'diamond';

/** One plotted series. */
export interface ChartSeries {
    label: string;
    color: string;
    /** One value per x-axis label. */
    values: number[];
    style?: LineStyle;
    marker?: Marker;
    /** Fills the area under the line with a fade of `color`. */
    fill?: boolean;
}

export interface ChartOptions {
    x: number;
    y: number;
    width: number;
    height: number;
    /** X-axis category labels, one per data point. */
    labels: string[];
    series: ChartSeries[];
    /** Formats y-axis ticks and point labels. */
    formatValue: (value: number) => string;
    /** Writes each point's value above it. Only legible for a single series. */
    pointLabels?: boolean;
    /** Draws a legend above the plot. */
    legend?: boolean;
    /** Rotated label for the y-axis. */
    yAxisTitle?: string;
    /** Label for the x-axis, centred beneath it. */
    xAxisTitle?: string;
    /** Horizontal guide lines, e.g. the daily quota a trainer must clear. */
    referenceLines?: { value: number; label: string; color: string }[];
}

/** Gridline count. Five lines give four bands, which reads cleanly at this size. */
const GRID_LINES = 5;

/** Width reserved for y-axis tick labels. */
const Y_AXIS_WIDTH = 74;

/** Applies a line style to the context's dash pattern. */
function applyLineStyle(ctx: SKRSContext2D, style: LineStyle) {
    if (style === 'dashed') ctx.setLineDash([10, 6]);
    else if (style === 'dotted') ctx.setLineDash([2, 5]);
    else ctx.setLineDash([]);
}

/** Draws a point marker centred on (cx, cy). */
function drawMarker(ctx: SKRSContext2D, marker: Marker, cx: number, cy: number, color: string) {
    if (marker === 'none') return;

    ctx.setLineDash([]);
    ctx.fillStyle = THEME.bg;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const r = 4.5;

    ctx.beginPath();
    if (marker === 'circle') {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (marker === 'triangle') {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.lineTo(cx - r, cy + r);
        ctx.closePath();
    } else {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
}

/**
 * Picks a rounded axis maximum at or above `peak`.
 *
 * Rounds up to one, two or five times a power of ten so tick labels land on
 * readable numbers instead of arbitrary fractions of the data's maximum.
 */
function niceCeiling(peak: number): number {
    if (peak <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const normalised = peak / magnitude;
    const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
    return step * magnitude;
}

/**
 * Draws a chart into an existing canvas context.
 *
 * The y-axis starts at the rounded floor below the data rather than at zero
 * when every value sits well above zero, so day-to-day movement stays visible
 * instead of being flattened against the baseline.
 */
export function drawChart(ctx: SKRSContext2D, options: ChartOptions): void {
    const { x, y, width, height, labels, series, formatValue } = options;

    const plotX = x + Y_AXIS_WIDTH;
    const plotW = width - Y_AXIS_WIDTH;
    const legendHeight = options.legend ? 26 : 0;
    // Point labels sit 12px above their point; without this headroom the label
    // on a point at the very top of the plot lands on the legend row.
    const labelHeadroom = options.pointLabels ? 18 : 0;
    const plotY = y + legendHeight + labelHeadroom;
    const plotH = height - legendHeight - labelHeadroom - 26;

    // Reference lines take part in scaling so a guide is never drawn off-plot.
    const all = [...series.flatMap((s) => s.values), ...(options.referenceLines ?? []).map((r) => r.value)];
    const peak = all.length > 0 ? Math.max(...all) : 1;
    const trough = all.length > 0 ? Math.min(...all) : 0;

    // Keep zero as the baseline unless the data sits far above it, in which
    // case an offset baseline makes the variation legible.
    let top = niceCeiling(peak);
    let bottom = trough > top * 0.45 ? Math.floor((trough * 0.9) / (top / GRID_LINES)) * (top / GRID_LINES) : 0;

    // A flat series -- a trainer earning the same amount every day -- would
    // otherwise be pinned against the bottom of an axis sized for a peak it
    // never approaches. Centre it in a padded band instead.
    if (peak > 0 && peak - trough <= peak * 0.02) {
        bottom = Math.max(0, peak * 0.9);
        top = peak * 1.1;
    }

    const span = Math.max(1, top - bottom);

    const valueToY = (value: number) => plotY + plotH - ((value - bottom) / span) * plotH;
    const indexToX = (index: number) =>
        labels.length === 1 ? plotX + plotW / 2 : plotX + (plotW * index) / (labels.length - 1);

    // ── Legend ────────────────────────────────────────────────────────────────
    if (options.legend) {
        let legendX = plotX;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const s of series) {
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 3;
            applyLineStyle(ctx, s.style ?? 'solid');
            ctx.beginPath();
            ctx.moveTo(legendX, y + 12);
            ctx.lineTo(legendX + 28, y + 12);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = font('400 12px');
            ctx.fillStyle = THEME.muted;
            ctx.letterSpacing = '1.5px';
            ctx.fillText(s.label.toUpperCase(), legendX + 36, y + 12);
            legendX += 36 + ctx.measureText(s.label.toUpperCase()).width + 28;
            ctx.letterSpacing = '0px';
        }
    }

    // ── Gridlines and y-axis ──────────────────────────────────────────────────
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = font('12px');
    for (let i = 0; i <= GRID_LINES; i += 1) {
        const value = bottom + (span * i) / GRID_LINES;
        const lineY = valueToY(value);

        ctx.setLineDash([]);
        ctx.strokeStyle = HAIRLINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotX, lineY);
        ctx.lineTo(plotX + plotW, lineY);
        ctx.stroke();

        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText(formatValue(value), plotX - 12, lineY);
    }

    // ── Reference lines ───────────────────────────────────────────────────────
    for (const ref of options.referenceLines ?? []) {
        const ry = valueToY(ref.value);
        ctx.strokeStyle = ref.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(plotX, ry);
        ctx.lineTo(plotX + plotW, ry);
        ctx.stroke();
        ctx.setLineDash([]);
        drawLabel(ctx, ref.label, plotX + plotW, ry - 6, ref.color, 10, 'right');
    }

    // ── Series ────────────────────────────────────────────────────────────────
    for (const s of series) {
        const points = s.values.map((value, i) => ({ px: indexToX(i), py: valueToY(value) }));
        if (points.length === 0) continue;

        if (s.fill) {
            const gradient = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
            gradient.addColorStop(0, `${s.color}66`);
            gradient.addColorStop(1, `${s.color}0d`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(points[0]!.px, plotY + plotH);
            for (const p of points) ctx.lineTo(p.px, p.py);
            ctx.lineTo(points[points.length - 1]!.px, plotY + plotH);
            ctx.closePath();
            ctx.fill();
        }

        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        applyLineStyle(ctx, s.style ?? 'solid');
        ctx.beginPath();
        points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py)));
        ctx.stroke();
        ctx.setLineDash([]);

        for (const p of points) drawMarker(ctx, s.marker ?? 'none', p.px, p.py, s.color);

        if (options.pointLabels) {
            ctx.textBaseline = 'alphabetic';
            ctx.font = font('500 11px');
            ctx.fillStyle = THEME.text;
            points.forEach((p, i) => {
                // The first and last labels would otherwise be centred on the
                // plot edge and spill over the axis. Anchor them inward.
                ctx.textAlign = i === 0 ? 'left' : i === points.length - 1 ? 'right' : 'center';
                ctx.fillText(formatValue(s.values[i] ?? 0), p.px, p.py - 12);
            });
            ctx.textAlign = 'center';
        }
    }

    // ── X-axis labels ─────────────────────────────────────────────────────────
    // Thin the labels so they never collide, whatever the series length.
    const maxLabels = Math.max(2, Math.floor(plotW / 70));
    const stride = Math.ceil(labels.length / maxLabels);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font('11px');
    ctx.fillStyle = TEXT_FAINT;
    labels.forEach((label, i) => {
        if (i % stride !== 0 && i !== labels.length - 1) return;
        ctx.fillText(label, indexToX(i), plotY + plotH + 20);
    });

    if (options.xAxisTitle) {
        drawLabel(ctx, options.xAxisTitle, plotX + plotW / 2, plotY + plotH + 40, TEXT_FAINT, 11, 'center');
    }

    if (options.yAxisTitle) {
        ctx.save();
        ctx.translate(x + 14, plotY + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'middle';
        drawLabel(ctx, options.yAxisTitle, 0, 0, TEXT_FAINT, 11, 'center');
        ctx.restore();
    }
}
