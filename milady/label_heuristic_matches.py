from __future__ import annotations

import argparse
import json

from .pipeline_common import connect_db


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Label downloaded avatars as milady when any associated avatar URL matched the heuristic detector."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing non-milady/unclear labels instead of only filling unlabeled images.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report which rows would be updated without changing the catalog.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    connection = connect_db()
    rows = connection.execute(
        """
        SELECT images.sha256,
               images.label,
               images.label_source,
               MAX(COALESCE(avatar_urls.heuristic_score, 0)) AS max_heuristic_score,
               GROUP_CONCAT(DISTINCT avatar_urls.heuristic_source) AS heuristic_sources,
               COUNT(*) AS matched_url_count
        FROM images
        INNER JOIN avatar_urls
          ON avatar_urls.image_sha256 = images.sha256
        WHERE avatar_urls.heuristic_match = 1
        GROUP BY images.sha256, images.label, images.label_source
        ORDER BY matched_url_count DESC, images.sha256 ASC
        """
    ).fetchall()

    updates: list[tuple[str, str]] = []
    skipped_existing = 0
    for row in rows:
        existing_label = row["label"]
        if existing_label == "milady":
            skipped_existing += 1
            continue
        if existing_label is not None and not args.force:
            skipped_existing += 1
            continue

        sources = [source for source in str(row["heuristic_sources"] or "").split(",") if source]
        score = float(row["max_heuristic_score"]) if row["max_heuristic_score"] is not None else 0.0
        note_payload = {
            "sources": sorted(set(sources)),
            "matchedUrlCount": int(row["matched_url_count"]),
            "maxHeuristicScore": score,
        }
        updates.append((str(row["sha256"]), json.dumps(note_payload, sort_keys=True)))

    if not args.dry_run:
        for sha256, note in updates:
            connection.execute(
                """
                UPDATE images
                SET label = 'milady',
                    label_source = 'heuristic',
                    labeled_at = CURRENT_TIMESTAMP,
                    review_notes = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE sha256 = ?
                """,
                (note, sha256),
            )
        connection.commit()

    print(
        json.dumps(
            {
                "matchedImages": len(rows),
                "updatedLabels": len(updates),
                "skippedExisting": skipped_existing,
                "dryRun": args.dry_run,
                "force": args.force,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
