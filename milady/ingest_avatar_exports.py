from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from .pipeline_common import (
    INGEST_ROOT,
    EXPORT_ROOT,
    connect_db,
    coalesce_latest,
    discover_export_paths,
    encode_json_list,
    max_timestamp,
    merge_string_lists,
    min_timestamp,
    now_iso,
    parse_json_list,
    read_json_file,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest Milady Shrinkifier avatar exports into the local SQLite catalog.")
    parser.add_argument("inputs", nargs="*", help="Export JSON files to ingest. Defaults to cache/ingest/*.json")
    parser.add_argument("--copy-into-cache", action="store_true", help="Copy each ingested export into cache/exports/raw/ before recording it.")
    parser.add_argument("--force", action="store_true", help="Re-ingest exports even if they were previously seen by path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    connection = connect_db()
    export_paths = discover_export_paths(args.inputs)
    if not export_paths:
        raise SystemExit("No export files found to ingest.")

    ingested = 0
    skipped = 0
    merged_avatars = 0

    for export_path in export_paths:
        source_path = export_path.resolve()
        should_archive = args.copy_into_cache or source_path.parent == INGEST_ROOT.resolve()
        stored_path = EXPORT_ROOT / export_path.name if should_archive else source_path
        if should_archive:
            stored_path.parent.mkdir(parents=True, exist_ok=True)
            if source_path != stored_path.resolve():
                shutil.copy2(source_path, stored_path)
        export_record_path = str(stored_path.resolve())
        source_record_path = str(source_path)

        existing_exports = connection.execute(
            "SELECT export_path FROM exports WHERE export_path IN (?, ?)",
            (export_record_path, source_record_path),
        ).fetchall()
        existing_paths = {str(row["export_path"]) for row in existing_exports}
        existing_export = export_record_path in existing_paths
        existing_source_export = source_record_path in existing_paths

        if existing_export and not args.force:
            skipped += 1
            continue
        if not args.force and should_archive and existing_source_export and source_record_path != export_record_path:
            connection.execute(
                """
                UPDATE exports
                SET export_path = ?, export_name = ?
                WHERE export_path = ?
                """,
                (export_record_path, stored_path.name, source_record_path),
            )
            connection.commit()
            skipped += 1
            continue

        payload = read_json_file(source_path)
        avatars = payload.get("avatars")
        if not isinstance(avatars, list):
            raise SystemExit(f"Export {source_path} does not contain an avatars array.")

        if args.force and existing_paths:
            connection.executemany("DELETE FROM exports WHERE export_path = ?", ((path,) for path in existing_paths))

        for avatar in avatars:
            normalized_url = str(avatar["normalizedUrl"])
            existing = connection.execute(
                "SELECT * FROM avatar_urls WHERE normalized_url = ?",
                (normalized_url,),
            ).fetchone()
            now = now_iso()

            incoming_handles = [str(handle) for handle in avatar.get("handles", []) if isinstance(handle, str)]
            incoming_display_names = [str(name) for name in avatar.get("displayNames", []) if isinstance(name, str)]
            incoming_source_surfaces = [str(name) for name in avatar.get("sourceSurfaces", []) if isinstance(name, str)]

            if existing:
                merged_handles = merge_string_lists(parse_json_list(existing["handles_json"]), incoming_handles)
                merged_display_names = merge_string_lists(parse_json_list(existing["display_names_json"]), incoming_display_names)
                merged_sources = merge_string_lists(parse_json_list(existing["source_surfaces_json"]), incoming_source_surfaces)
                heuristic_match = existing["heuristic_match"]
                if avatar.get("heuristicMatch") is True:
                    heuristic_match = 1
                elif heuristic_match is None and avatar.get("heuristicMatch") is False:
                    heuristic_match = 0
                heuristic_score = existing["heuristic_score"]
                if isinstance(avatar.get("heuristicScore"), (int, float)):
                    candidate_score = float(avatar["heuristicScore"])
                    heuristic_score = candidate_score if heuristic_score is None else max(float(heuristic_score), candidate_score)

                connection.execute(
                    """
                    UPDATE avatar_urls
                    SET original_url = ?,
                        handles_json = ?,
                        display_names_json = ?,
                        source_surfaces_json = ?,
                        seen_count = ?,
                        first_seen_at = ?,
                        last_seen_at = ?,
                        example_profile_url = ?,
                        example_notification_url = ?,
                        example_tweet_url = ?,
                        heuristic_match = ?,
                        heuristic_source = ?,
                        heuristic_score = ?,
                        heuristic_token_id = ?,
                        whitelisted = ?,
                        updated_at = ?
                    WHERE normalized_url = ?
                    """,
                    (
                        str(avatar.get("originalUrl") or existing["original_url"]),
                        encode_json_list(merged_handles),
                        encode_json_list(merged_display_names),
                        encode_json_list(merged_sources),
                        int(existing["seen_count"]) + int(avatar.get("seenCount", 0)),
                        min_timestamp(existing["first_seen_at"], str(avatar.get("firstSeenAt"))),
                        max_timestamp(existing["last_seen_at"], str(avatar.get("lastSeenAt"))),
                        coalesce_latest(existing["example_profile_url"], avatar.get("exampleProfileUrl")),
                        coalesce_latest(existing["example_notification_url"], avatar.get("exampleNotificationUrl")),
                        coalesce_latest(existing["example_tweet_url"], avatar.get("exampleTweetUrl")),
                        heuristic_match,
                        avatar.get("heuristicSource") or existing["heuristic_source"],
                        heuristic_score,
                        avatar.get("heuristicTokenId") or existing["heuristic_token_id"],
                        1 if (bool(existing["whitelisted"]) or avatar.get("whitelisted") is True) else 0,
                        now,
                        normalized_url,
                    ),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO avatar_urls (
                      normalized_url,
                      original_url,
                      handles_json,
                      display_names_json,
                      source_surfaces_json,
                      seen_count,
                      first_seen_at,
                      last_seen_at,
                      example_profile_url,
                      example_notification_url,
                      example_tweet_url,
                      heuristic_match,
                      heuristic_source,
                      heuristic_score,
                      heuristic_token_id,
                      whitelisted,
                      created_at,
                      updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        normalized_url,
                        str(avatar.get("originalUrl") or normalized_url),
                        encode_json_list(incoming_handles),
                        encode_json_list(incoming_display_names),
                        encode_json_list(incoming_source_surfaces),
                        int(avatar.get("seenCount", 0)),
                        str(avatar.get("firstSeenAt") or now),
                        str(avatar.get("lastSeenAt") or now),
                        avatar.get("exampleProfileUrl"),
                        avatar.get("exampleNotificationUrl"),
                        avatar.get("exampleTweetUrl"),
                        1 if avatar.get("heuristicMatch") is True else 0 if avatar.get("heuristicMatch") is False else None,
                        avatar.get("heuristicSource"),
                        float(avatar["heuristicScore"]) if isinstance(avatar.get("heuristicScore"), (int, float)) else None,
                        int(avatar["heuristicTokenId"]) if isinstance(avatar.get("heuristicTokenId"), int) else None,
                        1 if avatar.get("whitelisted") is True else 0,
                        now,
                        now,
                    ),
                )
            merged_avatars += 1

        connection.execute(
            """
            INSERT INTO exports (
              export_path,
              export_name,
              exported_at,
              ingested_at,
              version,
              avatar_count,
              total_sightings
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                export_record_path,
                stored_path.name,
                payload.get("exportedAt"),
                now_iso(),
                int(payload.get("version", 0)),
                int(payload.get("avatarCount", len(avatars))),
                int(payload.get("totalSightings", 0)),
            ),
        )
        connection.commit()
        ingested += 1

    print(
        f"Ingested {ingested} export(s), skipped {skipped}, and merged {merged_avatars} avatar records into {connection.execute('SELECT COUNT(*) FROM avatar_urls').fetchone()[0]} catalog rows."
    )


if __name__ == "__main__":
    main()
