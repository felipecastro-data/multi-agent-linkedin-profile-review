"""Renders the LinkedIn profile audit report to a PDF using reportlab Platypus.

Reads the four pipeline JSON files (synthesis, raw profile, career-coach
analysis, recruiter analysis) and lays them out into a PDF. Any missing
or null field is rendered as "Not available" (or omitted, for lines that
don't make sense without the value) rather than guessed at.

Orphan/widow control uses reportlab's native `keepWithNext` mechanism
(set on styles/flowables) rather than manual KeepTogether wrapping, so
only a heading plus the one flowable immediately following it is ever
glued together — the rest of each section flows normally across page
breaks.
"""

from __future__ import annotations

import datetime
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape as _xml_escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# ---------------------------------------------------------------------------
# Layout constants
# ---------------------------------------------------------------------------

PAGE_SIZE = letter
MARGIN = 0.75 * inch
BOTTOM_MARGIN = 1.0 * inch
CONTENT_WIDTH = PAGE_SIZE[0] - 2 * MARGIN

ACCENT = colors.HexColor("#2E9E6B")
NAVY = colors.HexColor("#1A2733")
BODY_GRAY = colors.HexColor("#4A4A4A")
FOOTER_GRAY = colors.HexColor("#9A9A9A")
FOOTER_RULE = colors.HexColor("#C9C9C9")

RULE_WIDTH = 3
RULE_GAP = 10
COL_GAP = 16

# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

EYEBROW_STYLE = ParagraphStyle(
    "Eyebrow",
    fontName="Helvetica-Bold",
    fontSize=8.5,
    textColor=ACCENT,
    leading=11,
    spaceAfter=1,
)

SECTION_TITLE_STYLE = ParagraphStyle(
    "SectionTitle",
    fontName="Helvetica-Bold",
    fontSize=16,
    textColor=NAVY,
    leading=19,
)

# keepWithNext=1: a section subheading always stays glued to the single
# flowable right after it, so it can never be stranded alone at a
# page bottom — without dragging the rest of the section along.
SUBHEADING_STYLE = ParagraphStyle(
    "Subheading",
    fontName="Helvetica-Bold",
    fontSize=11.5,
    textColor=NAVY,
    leading=14,
    spaceBefore=6,
    spaceAfter=3,
    keepWithNext=1,
)

# Same look as SUBHEADING_STYLE but WITHOUT keepWithNext — for a heading
# that's already glued to what precedes it via an explicit KeepTogether,
# where the *next* flowable is a large, variable-length table (e.g. the
# SWOT grid). keepWithNext would otherwise make the heading try to glue
# itself to that entire table too, and silently strand the heading (and
# anything it's KeepTogether'd with) if the table is too tall to fit
# alongside it on one page.
SUBHEADING_NO_GLUE_STYLE = ParagraphStyle(
    "SubheadingNoGlue",
    parent=SUBHEADING_STYLE,
    keepWithNext=0,
)

BODY_STYLE = ParagraphStyle(
    "Body",
    fontName="Helvetica",
    fontSize=10,
    textColor=BODY_GRAY,
    leading=12.5,
    spaceAfter=5,
)

BULLET_TEXT_STYLE = ParagraphStyle(
    "BulletText",
    fontName="Helvetica",
    fontSize=9.5,
    textColor=BODY_GRAY,
    leading=12,
)

BULLET_GLYPH_STYLE = ParagraphStyle(
    "BulletGlyph",
    fontName="Helvetica",
    fontSize=8,
    textColor=ACCENT,
    leading=12,
)

# keepWithNext=1: a recommendation title stays glued to the finding
# summary paragraph right after it (one extra short paragraph — not the
# whole before/after block).
REC_TITLE_STYLE = ParagraphStyle(
    "RecTitle",
    fontName="Helvetica-Bold",
    fontSize=11,
    textColor=NAVY,
    leading=14,
    spaceAfter=2,
    keepWithNext=1,
)

# keepWithNext=1: a "Before"/"After" label stays glued to its own short
# text paragraph right after it.
LABEL_PARA_STYLE = ParagraphStyle(
    "LabelPara",
    fontName="Helvetica-Bold",
    fontSize=9.5,
    textColor=NAVY,
    leading=13,
    spaceAfter=1,
    keepWithNext=1,
)

COVER_TITLE_STYLE = ParagraphStyle(
    "CoverTitle",
    fontName="Helvetica-Bold",
    fontSize=27,
    textColor=NAVY,
    leading=32,
    spaceAfter=8,
    alignment=TA_CENTER,
)

COVER_SUB_STYLE = ParagraphStyle(
    "CoverSub",
    fontName="Helvetica",
    fontSize=13,
    textColor=BODY_GRAY,
    leading=17,
    spaceAfter=2,
    alignment=TA_CENTER,
)

COVER_DATE_STYLE = ParagraphStyle(
    "CoverDate",
    fontName="Helvetica",
    fontSize=10,
    textColor=colors.HexColor("#6E6E6E"),
    leading=13,
    alignment=TA_CENTER,
)

# ---- Career Trajectory section styles -------------------------------------

SWOT_LABEL_STYLE = ParagraphStyle(
    "SwotLabel",
    fontName="Helvetica-Bold",
    fontSize=10,
    textColor=NAVY,
    leading=13,
    spaceAfter=3,
)

SWOT_BULLET_TEXT_STYLE = ParagraphStyle(
    "SwotBulletText",
    fontName="Helvetica",
    fontSize=8.5,
    textColor=BODY_GRAY,
    leading=11,
)

OODA_LABEL_STYLE = ParagraphStyle(
    "OodaLabel",
    fontName="Helvetica-Bold",
    fontSize=9.5,
    textColor=NAVY,
    leading=12,
    spaceAfter=3,
)

OODA_BODY_STYLE = ParagraphStyle(
    "OodaBody",
    fontName="Helvetica",
    fontSize=8.5,
    textColor=BODY_GRAY,
    leading=11,
)

OODA_ARROW_STYLE = ParagraphStyle(
    "OodaArrow",
    fontName="Helvetica-Bold",
    fontSize=13,
    textColor=ACCENT,
    leading=13,
    alignment=TA_CENTER,
)

SWOT_GREEN_BG = colors.HexColor("#E3F5EA")
SWOT_BLUE_BG = colors.HexColor("#E5F0FB")
SWOT_AMBER_BG = colors.HexColor("#FDF3DC")
SWOT_RED_BG = colors.HexColor("#FBE6E6")
QUADRANT_BORDER = colors.HexColor("#D8D8D8")
OODA_BOX_BG = colors.HexColor("#F2F5F3")


# ---------------------------------------------------------------------------
# Reusable flowable builders
# ---------------------------------------------------------------------------


def section_header(label_text: str, title_text: str) -> Table:
    """A left-aligned vertical accent rule beside an eyebrow label + title.

    Marked keepWithNext so it always stays glued to whatever single
    flowable comes right after it in the story.
    """
    label = Paragraph(label_text.upper(), EYEBROW_STYLE)
    title = Paragraph(title_text, SECTION_TITLE_STYLE)
    content = [label, title]
    bar = [Spacer(1, 1)]

    table = Table(
        [[bar, content]],
        colWidths=[RULE_WIDTH, CONTENT_WIDTH - RULE_WIDTH],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), ACCENT),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 0),
                ("LEFTPADDING", (1, 0), (1, 0), RULE_GAP),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    table.keepWithNext = True
    return table


def bullet_item(lead_in: str | None, description: str, width: float = CONTENT_WIDTH) -> Table:
    """A single bulleted list row: colored square + bold lead-in + plain text.

    Escapes lead_in/description before building markup, since real profile
    text (e.g. "FP&A") contains characters reportlab's Paragraph mini-XML
    parser would otherwise misinterpret.
    """
    safe_description = _xml_escape(description) if description else description
    if lead_in:
        text = f"<b>{_xml_escape(lead_in)}</b> {safe_description}"
    else:
        text = safe_description
    glyph = Paragraph("■", BULLET_GLYPH_STYLE)
    body = Paragraph(text, BULLET_TEXT_STYLE)
    glyph_width = 14
    table = Table([[glyph, body]], colWidths=[glyph_width, width - glyph_width])
    table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 4),
                ("LEFTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def finding_item(source_label: str, observation: str, width: float = CONTENT_WIDTH) -> Table:
    """A single full-width finding: colored square + small colored lens tag
    (e.g. "CAREER COACH —") inline before the observation text.

    Each finding is its own atomic flowable (not a cell inside a larger
    single-row table), so a section's findings stack vertically and
    reportlab can break between them at a page boundary — only the section
    subheading-to-first-finding glue (via SUBHEADING_STYLE's keepWithNext)
    is enforced, not the whole list.
    """
    safe_observation = _xml_escape(observation) if observation else "Not available"
    text = (
        f"<font color='#2E9E6B'><b>{_xml_escape(source_label.upper())}</b></font> "
        f"— {safe_observation}"
    )
    glyph = Paragraph("■", BULLET_GLYPH_STYLE)
    body = Paragraph(text, BULLET_TEXT_STYLE)
    glyph_width = 14
    table = Table([[glyph, body]], colWidths=[glyph_width, width - glyph_width])
    table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 4),
                ("LEFTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def two_column_bullets(
    bullets: list[tuple[str | None, str]], width: float = CONTENT_WIDTH
) -> Table:
    """Split a flat bullet list into two side-by-side columns (top-to-bottom
    per column, then left-to-right), for lists with no natural grouping."""
    col_width = (width - COL_GAP) / 2
    half = (len(bullets) + 1) // 2
    left_items, right_items = bullets[:half], bullets[half:]

    left_cell = [bullet_item(lead_in, desc, width=col_width) for lead_in, desc in left_items]
    right_cell = [bullet_item(lead_in, desc, width=col_width) for lead_in, desc in right_items]

    return _two_column_table(left_cell, right_cell, col_width)


def _two_column_table(left_cell: list, right_cell: list, col_width: float) -> Table:
    table = Table([[left_cell, right_cell]], colWidths=[col_width, col_width])
    table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), COL_GAP),
                ("LEFTPADDING", (1, 0), (1, 0), 0),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def recommendation_flowables(
    title: str, impact: str, finding_summary: str,
    before_example: str | None, after_example: str | None,
) -> list:
    """Plain list of flowables for one recommendation (not glued together as
    a block) so they can flow normally across a page break. Only the title
    is keepWithNext'd to the summary paragraph right after it.

    All data-derived strings are XML-escaped before being embedded in
    Paragraph markup (impact is our own internal "High"/"Medium"/"Low"
    label, so it's left unescaped)."""
    flowables = [
        Paragraph(
            f"{_xml_escape(title)} <font color='#2E9E6B'>({impact} Impact)</font>",
            REC_TITLE_STYLE,
        ),
        Paragraph(_xml_escape(finding_summary), BODY_STYLE),
    ]
    if before_example:
        flowables.append(Paragraph("Before", LABEL_PARA_STYLE))
        flowables.append(Paragraph(_xml_escape(before_example), BODY_STYLE))
    if after_example:
        flowables.append(Paragraph("After", LABEL_PARA_STYLE))
        flowables.append(Paragraph(_xml_escape(after_example), BODY_STYLE))
    flowables.append(Spacer(1, 3))
    return flowables


def swot_grid(swot: dict) -> Table:
    """2x2 SWOT grid: Strengths/Opportunities/Weaknesses/Threats, each
    quadrant colored and holding a compact bulleted list of the actual
    entries from career_trajectory.dofa (the JSON key stays `dofa` — it's
    the established data contract with career-coach/synthesis output —
    only the display label is SWOT)."""
    col_width = (CONTENT_WIDTH - COL_GAP) / 2
    inner_width = col_width - 20

    def quadrant(label: str, entries: list) -> list:
        cell = [Paragraph(label, SWOT_LABEL_STYLE)]
        if entries:
            for entry in entries:
                glyph = Paragraph("■", BULLET_GLYPH_STYLE)
                body = Paragraph(_xml_escape(str(entry)), SWOT_BULLET_TEXT_STYLE)
                row = Table([[glyph, body]], colWidths=[12, inner_width - 12])
                row.setStyle(
                    TableStyle(
                        [
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (0, 0), 4),
                            ("TOPPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ]
                    )
                )
                cell.append(row)
        else:
            cell.append(Paragraph("Not available", SWOT_BULLET_TEXT_STYLE))
        return cell

    top_left = quadrant("Strengths", swot.get("strengths") or [])
    top_right = quadrant("Opportunities", swot.get("opportunities") or [])
    bottom_left = quadrant("Weaknesses", swot.get("weaknesses") or [])
    bottom_right = quadrant("Threats", swot.get("threats") or [])

    table = Table(
        [[top_left, top_right], [bottom_left, bottom_right]],
        colWidths=[col_width, col_width],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), SWOT_GREEN_BG),
                ("BACKGROUND", (1, 0), (1, 0), SWOT_BLUE_BG),
                ("BACKGROUND", (0, 1), (0, 1), SWOT_AMBER_BG),
                ("BACKGROUND", (1, 1), (1, 1), SWOT_RED_BG),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.5, QUADRANT_BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, QUADRANT_BORDER),
            ]
        )
    )
    return table


def path_flowables(path: str, rationale: str | None, tradeoffs: str | None) -> list:
    """One recommended-path block: bold title, then labeled Rationale/
    Tradeoffs paragraphs, reusing the Before/After label pattern."""
    flowables = [Paragraph(_xml_escape(path), REC_TITLE_STYLE)]
    if rationale:
        flowables.append(Paragraph("Rationale:", LABEL_PARA_STYLE))
        flowables.append(Paragraph(_xml_escape(rationale), BODY_STYLE))
    if tradeoffs:
        flowables.append(Paragraph("Tradeoffs:", LABEL_PARA_STYLE))
        flowables.append(Paragraph(_xml_escape(tradeoffs), BODY_STYLE))
    flowables.append(Spacer(1, 4))
    return flowables


def skill_recommendation_flowables(skill_or_cert: str, why: str, priority: str | None) -> list:
    """One skill/cert recommendation: bold name + inline priority label
    (same coloring pattern as a recommendation's impact label), plus why."""
    priority_label = str(priority).strip().title() if priority else "Not available"
    flowables = [
        Paragraph(
            f"{_xml_escape(skill_or_cert)} <font color='#2E9E6B'>({priority_label} Priority)</font>",
            REC_TITLE_STYLE,
        ),
        Paragraph(_xml_escape(why), BODY_STYLE),
        Spacer(1, 3),
    ]
    return flowables


def ooda_flow(ooda: dict) -> Table:
    """Horizontal Observe -> Orient -> Decide -> Act flow: 4 boxes joined by
    arrow glyphs in a single-row table."""
    stages = [
        ("Observe", ooda.get("observe")),
        ("Orient", ooda.get("orient")),
        ("Decide", ooda.get("decide")),
        ("Act", ooda.get("act")),
    ]
    arrow_width = 20
    box_width = (CONTENT_WIDTH - 3 * arrow_width) / 4

    row = []
    col_widths = []
    box_cols = []
    arrow_cols = []
    for i, (label, text) in enumerate(stages):
        content = text if text else "Not available"
        cell = [
            Paragraph(label, OODA_LABEL_STYLE),
            Paragraph(_xml_escape(content), OODA_BODY_STYLE),
        ]
        row.append(cell)
        box_cols.append(len(col_widths))
        col_widths.append(box_width)
        if i < len(stages) - 1:
            row.append(Paragraph("→", OODA_ARROW_STYLE))
            arrow_cols.append(len(col_widths))
            col_widths.append(arrow_width)

    table = Table([row], colWidths=col_widths)
    style_cmds = [
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for col in box_cols:
        style_cmds.append(("LEFTPADDING", (col, 0), (col, 0), 8))
        style_cmds.append(("RIGHTPADDING", (col, 0), (col, 0), 8))
        style_cmds.append(("BACKGROUND", (col, 0), (col, 0), OODA_BOX_BG))
        style_cmds.append(("BOX", (col, 0), (col, 0), 0.5, QUADRANT_BORDER))
    for col in arrow_cols:
        style_cmds.append(("LEFTPADDING", (col, 0), (col, 0), 0))
        style_cmds.append(("RIGHTPADDING", (col, 0), (col, 0), 0))
    table.setStyle(TableStyle(style_cmds))
    return table


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _humanize_key(key: str) -> str:
    return key.replace("_", " ").title()


def _cover_profile(raw_profile: dict) -> dict:
    """Pull cover-page fields from the raw profile. The schema has no
    person-name field, so `name` is omitted (never guessed at, e.g. from
    the profile URL slug) when not present."""
    header = raw_profile.get("header") or {}
    return {
        "name": raw_profile.get("name"),
        "headline": header.get("headline") or "Not available",
    }


def _snapshot_bullets(profile_snapshot: dict) -> list[tuple[str, str]]:
    bullets: list[tuple[str, str]] = []
    captured = profile_snapshot.get("sections_captured") or {}
    for label, value in captured.items():
        display_label = _humanize_key(str(label))
        if isinstance(value, bool):
            desc = "present" if value else "not present"
        elif isinstance(value, (int, float)):
            count = int(value)
            desc = "1 captured" if count == 1 else f"{count} captured"
        elif value is None:
            desc = "Not available"
        else:
            desc = str(value)
        bullets.append((f"{display_label}:", desc))

    missing = profile_snapshot.get("sections_missing") or []
    if missing:
        bullets.append(("Missing:", ", ".join(str(m) for m in missing)))
    else:
        bullets.append(("Missing:", "none — all sections captured"))
    return bullets


# Canonical section buckets for grouping career-coach/recruiter findings
# that use different section labels for related topics. Checked in order
# — first keyword match wins — so more specific/compound keywords (e.g.
# "credibility") are listed before ones they could be confused with
# (e.g. "narrative", since a section can be literally "credibility_narrative").
_SECTION_KEYWORD_MAP = [
    ("about", "About"),
    ("credibility", "Credibility & Red Flags"),
    ("red flag", "Credibility & Red Flags"),
    ("keyword", "Skills & Keywords"),
    ("skill", "Skills & Keywords"),
    ("certif", "Certifications"),
    ("featured", "Featured"),
    ("feature", "Featured"),
    ("project", "Projects"),
    ("recommend", "Recommendations"),
    ("post", "Posts & Visibility"),
    ("visibility", "Posts & Visibility"),
    ("position", "Positioning & Narrative"),
    ("narrative", "Positioning & Narrative"),
    ("experience", "Experience"),
    ("education", "Education"),
]

_SECTION_DISPLAY_ORDER = [
    "About", "Positioning & Narrative", "Experience", "Education",
    "Skills & Keywords", "Certifications", "Featured", "Projects",
    "Recommendations", "Posts & Visibility", "Credibility & Red Flags",
]


def _canonical_section(raw_section: str) -> str:
    """Map a finding's raw `section` string to a shared display bucket so
    career-coach and recruiter findings about the same topic — even under
    different exact section names — land in the same two-column block."""
    if not raw_section:
        return "General"
    normalized = re.sub(r"\[\d+\]", "", raw_section)
    normalized = re.sub(r"\([^)]*\)", "", normalized)
    normalized = normalized.replace("_", " ").replace("-", " ").strip().lower()
    if not normalized:
        return "General"
    for keyword, label in _SECTION_KEYWORD_MAP:
        if keyword in normalized:
            return label
    return normalized.title()


def _group_findings_by_section(career_coach_findings: list, recruiter_findings: list) -> list[dict]:
    groups: dict[str, dict[str, list]] = {}

    def add(findings: list, source_key: str) -> None:
        for finding in findings or []:
            label = _canonical_section(finding.get("section", ""))
            bucket = groups.setdefault(label, {"career_coach": [], "recruiter": []})
            observation = finding.get("observation") or "Not available"
            bucket[source_key].append((None, observation))

    add(career_coach_findings, "career_coach")
    add(recruiter_findings, "recruiter")

    def sort_key(label: str):
        try:
            return (0, _SECTION_DISPLAY_ORDER.index(label))
        except ValueError:
            return (1, label)

    return [
        {"section": label, "career_coach": groups[label]["career_coach"], "recruiter": groups[label]["recruiter"]}
        for label in sorted(groups.keys(), key=sort_key)
    ]


# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------


def _make_footer(generated_on: str):
    def draw_footer(canvas, doc):
        canvas.saveState()
        rule_y = 0.62 * inch
        canvas.setStrokeColor(FOOTER_RULE)
        canvas.setLineWidth(0.75)
        canvas.line(MARGIN, rule_y, PAGE_SIZE[0] - MARGIN, rule_y)

        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(FOOTER_GRAY)
        canvas.drawString(MARGIN, 0.45 * inch, f"LinkedIn Profile Audit — generated {generated_on}")
        canvas.restoreState()

    return draw_footer


# ---------------------------------------------------------------------------
# Section builders (operate on mock data structures)
# ---------------------------------------------------------------------------


def build_cover(story: list, profile: dict, generated_on: str) -> None:
    """Centered title block. Flows directly into the Executive Summary on
    the same first page rather than occupying its own mostly-blank page —
    only the extra spacing below sets it apart visually."""
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph("LinkedIn Profile Audit Report", COVER_TITLE_STYLE))
    if profile.get("name"):
        story.append(Paragraph(_xml_escape(profile["name"]), COVER_SUB_STYLE))
    story.append(Paragraph(_xml_escape(profile.get("headline") or "Not available"), COVER_SUB_STYLE))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph(f"Generated {generated_on}", COVER_DATE_STYLE))
    story.append(Spacer(1, 0.4 * inch))


def build_executive_summary(story: list, summary_text: str | None) -> None:
    story.append(section_header("Overview", "Executive Summary"))
    story.append(Spacer(1, 5))
    story.append(Paragraph(_xml_escape(summary_text or "Not available"), BODY_STYLE))
    story.append(Spacer(1, 9))


def build_profile_snapshot(story: list, snapshot: dict) -> None:
    story.append(section_header("Snapshot", "Profile Snapshot"))
    story.append(Spacer(1, 5))
    story.append(two_column_bullets(_snapshot_bullets(snapshot)))
    story.append(Spacer(1, 9))


def build_findings(story: list, findings_by_section: list[dict]) -> None:
    story.append(section_header("Findings", "Section-by-Section Findings"))
    story.append(Spacer(1, 5))

    if not findings_by_section:
        story.append(Paragraph("No findings available.", BODY_STYLE))
        story.append(Spacer(1, 6))
        return

    for entry in findings_by_section:
        story.append(Paragraph(_xml_escape(entry["section"]), SUBHEADING_STYLE))
        for _, observation in entry["career_coach"]:
            story.append(finding_item("Career Coach", observation))
        for _, observation in entry["recruiter"]:
            story.append(finding_item("Recruiter", observation))
        story.append(Spacer(1, 6))

    story.append(Spacer(1, 6))


def build_recommendations(story: list, recommendations: list[dict]) -> None:
    story.append(section_header("Priorities", "Prioritized Recommendations"))
    story.append(Spacer(1, 5))

    if not recommendations:
        story.append(Paragraph("No recommendations available.", BODY_STYLE))
        story.append(Spacer(1, 6))
        return

    for impact_level in ("High", "Medium", "Low"):
        items = [
            r for r in recommendations
            if str(r.get("impact", "")).strip().lower() == impact_level.lower()
        ]
        if not items:
            continue

        story.append(Paragraph(f"{impact_level} Impact", SUBHEADING_STYLE))
        for rec in items:
            story.extend(
                recommendation_flowables(
                    rec.get("title") or "Not available",
                    impact_level,
                    rec.get("finding_summary") or "Not available",
                    rec.get("before_example"),
                    rec.get("after_example"),
                )
            )

    story.append(Spacer(1, 6))


def build_career_trajectory(story: list, career_trajectory: dict | None) -> None:
    """Forward-looking 3-year strategic guidance, passed through from
    career-coach — SWOT, recommended paths, skill/cert recommendations, and
    an OODA execution loop. Kept visually and structurally separate from
    the profile-polish Prioritized Recommendations section above it."""
    if not career_trajectory:
        story.append(
            KeepTogether(
                [
                    section_header("Strategy", "Career Trajectory — 3-Year Outlook"),
                    Spacer(1, 5),
                    Paragraph("Career trajectory analysis not available", BODY_STYLE),
                ]
            )
        )
        story.append(Spacer(1, 9))
        return

    # Keep the section header, its intro line, and the "SWOT Analysis"
    # heading together as one small, fixed-size atomic unit — this always
    # fits on a single page, so it reliably travels together rather than
    # leaving the header stranded alone. The SWOT grid itself is NOT
    # included here: its height depends on how much SWOT content
    # career-coach produced (varies run to run) and can exceed a full
    # page, which would make even a KeepTogether silently give up on
    # atomicity. It's appended below using SUBHEADING_NO_GLUE_STYLE for
    # the heading (no keepWithNext) so the grid is free to flow onto the
    # next page, or split between its two rows, on its own terms — a
    # multi-row Table already splits at row boundaries when it needs to.
    story.append(
        KeepTogether(
            [
                section_header("Strategy", "Career Trajectory — 3-Year Outlook"),
                Spacer(1, 5),
                Paragraph(
                    "Forward-looking strategic guidance on the candidate's career "
                    "trajectory — distinct from the profile-polish recommendations above.",
                    BODY_STYLE,
                ),
                Spacer(1, 6),
                Paragraph("SWOT Analysis", SUBHEADING_NO_GLUE_STYLE),
            ]
        )
    )

    # `career_trajectory`'s JSON key is `dofa` (the career-coach/synthesis
    # data contract — not renamed, see swot_grid's docstring); only the
    # rendered label above it says "SWOT".
    swot = career_trajectory.get("dofa") or {}
    if any(swot.get(k) for k in ("strengths", "weaknesses", "opportunities", "threats")):
        story.append(swot_grid(swot))
    else:
        story.append(Paragraph("Not available", BODY_STYLE))
    story.append(Spacer(1, 9))

    story.append(Paragraph("Recommended Paths", SUBHEADING_STYLE))
    paths = career_trajectory.get("recommended_paths") or []
    if paths:
        for path in paths:
            story.extend(
                path_flowables(
                    path.get("path") or "Not available",
                    path.get("rationale"),
                    path.get("tradeoffs"),
                )
            )
    else:
        story.append(Paragraph("Not available", BODY_STYLE))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Skill & Certification Recommendations", SUBHEADING_STYLE))
    skills = career_trajectory.get("skill_recommendations") or []
    if skills:
        for skill in skills:
            story.extend(
                skill_recommendation_flowables(
                    skill.get("skill_or_cert") or "Not available",
                    skill.get("why") or "Not available",
                    skill.get("priority"),
                )
            )
    else:
        story.append(Paragraph("Not available", BODY_STYLE))
    story.append(Spacer(1, 6))

    story.append(Paragraph("OODA Execution Loop", SUBHEADING_STYLE))
    ooda = career_trajectory.get("ooda_execution_plan") or {}
    if any(ooda.get(k) for k in ("observe", "orient", "decide", "act")):
        story.append(ooda_flow(ooda))
    else:
        story.append(Paragraph("Not available", BODY_STYLE))
    story.append(Spacer(1, 9))


def build_next_steps(story: list, next_steps: dict) -> None:
    """Each time horizon renders as its own full-width, stacked block —
    heading with keepWithNext (via SUBHEADING_STYLE) glued to the bullet
    list right after it, so a heading never gets orphaned at a page
    bottom away from its own items."""
    story.append(section_header("Roadmap", "Next Steps"))
    story.append(Spacer(1, 5))

    horizons = [
        ("This Week", next_steps.get("short_term") or []),
        ("This Month", next_steps.get("medium_term") or []),
        ("This Quarter", next_steps.get("long_term") or []),
    ]
    if not any(items for _, items in horizons):
        story.append(Paragraph("No next steps available.", BODY_STYLE))
        return

    rendered_horizons = [(h, items) for h, items in horizons if items]
    for i, (heading_text, items) in enumerate(rendered_horizons):
        story.append(Paragraph(heading_text, SUBHEADING_STYLE))
        for item in items:
            story.append(bullet_item(None, item))
        # No trailing spacer after the last block — a spacer as the very
        # last flowable in the document can itself overflow the final
        # page's remaining space and force an otherwise-empty extra page.
        if i < len(rendered_horizons) - 1:
            story.append(Spacer(1, 6))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def generate_pdf(
    synthesis_path: str,
    raw_profile_path: str,
    career_coach_path: str,
    recruiter_path: str,
    output_path: str,
) -> None:
    """Render the audit report PDF from the four pipeline JSON files.

    Missing files raise naturally (that's a real setup problem worth
    surfacing clearly). Missing or null *fields* within otherwise-valid
    JSON are rendered as "Not available" / omitted rather than guessed
    at — see the individual build_* functions and the helpers above.
    """
    synthesis = _load_json(synthesis_path)
    raw_profile = _load_json(raw_profile_path)
    career_coach = _load_json(career_coach_path)
    recruiter = _load_json(recruiter_path)

    generated_on = datetime.date.today().strftime("%B %d, %Y")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=PAGE_SIZE,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        title="LinkedIn Profile Audit Report",
    )

    profile = _cover_profile(raw_profile)
    executive_summary = synthesis.get("executive_summary")
    profile_snapshot = synthesis.get("profile_snapshot") or {}
    findings_by_section = _group_findings_by_section(
        career_coach.get("findings") or [], recruiter.get("findings") or []
    )
    recommendations = synthesis.get("recommendations") or []
    career_trajectory = synthesis.get("career_trajectory")
    next_steps = synthesis.get("next_steps") or {}

    story: list = []
    build_cover(story, profile, generated_on)
    build_executive_summary(story, executive_summary)
    build_profile_snapshot(story, profile_snapshot)
    build_findings(story, findings_by_section)
    build_recommendations(story, recommendations)
    build_career_trajectory(story, career_trajectory)
    build_next_steps(story, next_steps)

    footer = _make_footer(generated_on)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parent.parent
    timestamp = "20260826_142809"
    output_file = project_root / "output" / "felipe_castro_linkedin_audit.pdf"
    generate_pdf(
        synthesis_path=str(project_root / "data" / "analysis" / f"synthesis_{timestamp}.json"),
        raw_profile_path=str(project_root / "data" / "raw" / f"profile_{timestamp}.json"),
        career_coach_path=str(project_root / "data" / "analysis" / f"career_coach_{timestamp}.json"),
        recruiter_path=str(project_root / "data" / "analysis" / f"recruiter_{timestamp}.json"),
        output_path=str(output_file),
    )
    print(f"Wrote {output_file}")
