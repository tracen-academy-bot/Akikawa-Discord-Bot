/**
 * Response shapes for the uma.moe API.
 *
 * Transcribed from the published OpenAPI 3.1 document at
 * https://uma.moe/api/docs/openapi.yaml. The spec marks **no** property as
 * required, so every field here is optional as well as nullable: the API may
 * omit a field entirely, and code must handle `undefined`, not only `null`.
 * Treating absent as `null` (rather than as zero) keeps derived figures honest
 * during a mid-month rollover. A missing optional field once crashed every
 * sync with "Cannot convert undefined to a BigInt"; typing them this way makes
 * the compiler catch that class of bug.
 */

/** A circle, as returned by `/api/v4/circles` and `/api/v4/circles/list`. */
export interface UmaCircle {
    circle_id?: number;
    name?: string;
    comment?: string | null;
    leader_viewer_id?: number | null;
    leader_name?: string | null;
    member_count?: number | null;
    created_at?: string | null;
    last_updated?: string | null;
    /** Effective display rank; may show last month's during rollover. */
    monthly_rank?: number | null;
    /** Effective display points; may show last month's during rollover. */
    monthly_point?: number | null;
    last_month_rank?: number | null;
    last_month_point?: number | null;
    archived?: boolean | null;
    yesterday_points?: number | null;
    yesterday_rank?: number | null;
    /** Live figures, present only inside the live refresh window. */
    live_points?: number | null;
    live_rank?: number | null;
    last_live_update?: string | null;
}

/** One member's fan record for one game month. */
export interface UmaCircleMember {
    id?: number;
    circle_id?: number;
    viewer_id?: number;
    trainer_name?: string | null;
    shame_score?: number | null;
    year?: number;
    month?: number;
    /**
     * The trainer's *lifetime* fan count per snapshot. The spec says 31
     * elements; the live API sends 32 (checked 2026-10-04): index 0 is the
     * month's starting value and indices 1-31 are game days. Zero means no
     * snapshot: a day not reached yet, or a day the member was not in the
     * circle. Members who left mid-month stay in the list, zero from then on.
     */
    daily_fans?: number[];
    last_updated?: string | null;
    previous_circle_id?: number | null;
    previous_circle_name?: string | null;
    next_month_start?: number | null;
}

/** `GET /api/v4/circles` */
export interface UmaCircleResponse {
    circle?: UmaCircle;
    members?: UmaCircleMember[];
    club_rank?: number | null;
    fans_to_next_tier?: number | null;
    fans_to_lower_tier?: number | null;
}

/** `GET /api/v4/circles/list` */
export interface UmaCircleListResponse {
    circles?: UmaCircle[];
    total?: number;
    page?: number;
    limit?: number;
    total_pages?: number;
}
