/**
 * Response shapes for the uma.moe API.
 *
 * Transcribed from the published OpenAPI 3.1 document at
 * https://uma.moe/api/docs/openapi.yaml. Every field the spec marks nullable is
 * nullable here, because a circle mid-rollover legitimately omits several of
 * them and silently treating those as zero would corrupt derived figures.
 */

/** A circle, as returned by `/api/v4/circles` and `/api/v4/circles/list`. */
export interface UmaCircle {
    circle_id: number;
    name: string;
    comment: string | null;
    leader_viewer_id: number | null;
    leader_name: string | null;
    member_count: number | null;
    created_at: string | null;
    last_updated: string | null;
    /** Effective display rank; may show last month's during rollover. */
    monthly_rank: number | null;
    /** Effective display points; may show last month's during rollover. */
    monthly_point: number | null;
    last_month_rank: number | null;
    last_month_point: number | null;
    archived: boolean | null;
    yesterday_points: number | null;
    yesterday_rank: number | null;
    /** Live figures, present only inside the live refresh window. */
    live_points: number | null;
    live_rank: number | null;
    last_live_update: string | null;
}

/** One member's fan record for one game month. */
export interface UmaCircleMember {
    id: number;
    circle_id: number;
    viewer_id: number;
    trainer_name: string | null;
    shame_score: number | null;
    year: number;
    month: number;
    /**
     * 31-element array of *cumulative* fan totals, one per day of the game
     * month. Days that have not happened yet, and days before the member
     * joined, are zero.
     */
    daily_fans: number[];
    last_updated: string | null;
    previous_circle_id: number | null;
    previous_circle_name: string | null;
    next_month_start: number | null;
}

/** `GET /api/v4/circles` */
export interface UmaCircleResponse {
    circle: UmaCircle;
    members: UmaCircleMember[];
    club_rank: number | null;
    fans_to_next_tier: number | null;
    fans_to_lower_tier: number | null;
}

/** `GET /api/v4/circles/list` */
export interface UmaCircleListResponse {
    circles: UmaCircle[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}
