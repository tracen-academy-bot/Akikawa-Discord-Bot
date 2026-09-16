import type { SKRSContext2D } from '@napi-rs/canvas';
import { font } from './fonts';

/**
 * Line and area chart drawing, shared by the trainer report and the benchmark.
 *
 * Deliberately small: a fixed set of marks that suit these two reports, rather
 * than a general charting library. Both reports plot an evenly spaced day axis,
 * so the x scale is always categorical.
 */

const TEXT_FAINT = '#6b7280';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

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
    ctx.fillStyle = '#12131f';
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
    const plotY = y + legendHeight;
    const plotH = height - legendHeight - 26;

    const all = series.flatMap((s) => s.values);
    const peak = all.length > 0 ? Math.max(...all) : 1;
    const trough = all.length > 0 ? Math.min(...all) : 0;

    // Keep zero as the baseline unless the data sits far above it, in which
    // case an offset baseline makes the variation legible.
    const top = niceCeiling(peak);
    const bottom = trough > top * 0.45 ? Math.floor((trough * 0.9) / (top / GRID_LINES)) * (top / GRID_LINES) : 0;
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

            ctx.font = font('bold 12px');
            ctx.fillStyle = '#c9d1d9';
            ctx.fillText(s.label, legendX + 36, y + 12);
            legendX += 36 + ctx.measureText(s.label).width + 28;
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
            ctx.font = font('bold 11px');
            ctx.fillStyle = '#e6e6e6';
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
        ctx.font = font('bold 11px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText(options.xAxisTitle, plotX + plotW / 2, plotY + plotH + 40);
    }

    if (options.yAxisTitle) {
        ctx.save();
        ctx.translate(x + 14, plotY + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = font('bold 11px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText(options.yAxisTitle, 0, 0);
        ctx.restore();
    }
}
