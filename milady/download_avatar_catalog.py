from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import httpx

from .pipeline_common import AVATAR_ROOT, connect_db, guess_extension, inspect_image_bytes, now_iso, sha256_bytes


@dataclass(slots=True)
class DownloadResult:
    normalized_url: str
    sha256: str | None
    local_path: str | None
    byte_size: int | None
    width: int | None
    height: int | None
    mime_type: str | None
    error: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download unique avatars from the catalog and dedupe them by SHA-256.")
    parser.add_argument("--limit", type=int, default=None, help="Only download this many pending avatars.")
    parser.add_argument("--concurrency", type=int, default=8, help="Concurrent download workers.")
    parser.add_argument("--timeout", type=float, default=20.0, help="Per-request timeout in seconds.")
    parser.add_argument("--retry-failed", action="store_true", help="Retry rows previously marked as failed.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    connection = connect_db()

    query = """
        SELECT normalized_url
        FROM avatar_urls
        WHERE image_sha256 IS NULL
          AND (
            download_status = 'pending'
            OR (? = 1 AND download_status = 'failed')
          )
        ORDER BY seen_count DESC, updated_at DESC
    """
    rows = connection.execute(query, (1 if args.retry_failed else 0,)).fetchall()
    urls = [str(row["normalized_url"]) for row in rows]
    if args.limit is not None:
        urls = urls[: args.limit]

    if not urls:
        print("No pending avatar URLs to download.")
        return

    completed = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        future_map = {
            executor.submit(download_one, normalized_url, args.timeout): normalized_url
            for normalized_url in urls
        }
        for future in as_completed(future_map):
            normalized_url = future_map[future]
            result = future.result()
            completed += 1
            if result.error:
                failed += 1
                connection.execute(
                    """
                    UPDATE avatar_urls
                    SET download_status = 'failed',
                        last_download_error = ?,
                        updated_at = ?
                    WHERE normalized_url = ?
                    """,
                    (result.error, now_iso(), normalized_url),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO images (
                      sha256,
                      local_path,
                      mime_type,
                      width,
                      height,
                      byte_size,
                      created_at,
                      updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(sha256) DO UPDATE SET
                      local_path = excluded.local_path,
                      mime_type = excluded.mime_type,
                      width = excluded.width,
                      height = excluded.height,
                      byte_size = excluded.byte_size,
                      updated_at = excluded.updated_at
                    """,
                    (
                        result.sha256,
                        result.local_path,
                        result.mime_type,
                        result.width,
                        result.height,
                        result.byte_size,
                        now_iso(),
                        now_iso(),
                    ),
                )
                connection.execute(
                    """
                    UPDATE avatar_urls
                    SET image_sha256 = ?,
                        download_status = 'downloaded',
                        last_download_error = NULL,
                        updated_at = ?
                    WHERE normalized_url = ?
                    """,
                    (result.sha256, now_iso(), normalized_url),
                )

            connection.commit()

    print(f"Downloaded {completed - failed} avatar(s), failed {failed}, total attempted {completed}.")


def download_one(normalized_url: str, timeout: float) -> DownloadResult:
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            response = client.get(normalized_url)
            response.raise_for_status()
            payload = response.content

        sha256 = sha256_bytes(payload)
        width, height, mime_type = inspect_image_bytes(payload)
        extension = guess_extension(response.headers.get("content-type"), normalized_url)
        local_path = AVATAR_ROOT / f"{sha256}{extension}"
        local_path.parent.mkdir(parents=True, exist_ok=True)
        if not local_path.exists():
            local_path.write_bytes(payload)

        return DownloadResult(
            normalized_url=normalized_url,
            sha256=sha256,
            local_path=str(local_path),
            byte_size=len(payload),
            width=width,
            height=height,
            mime_type=mime_type or response.headers.get("content-type"),
            error=None,
        )
    except Exception as error:  # noqa: BLE001
        return DownloadResult(
            normalized_url=normalized_url,
            sha256=None,
            local_path=None,
            byte_size=None,
            width=None,
            height=None,
            mime_type=None,
            error=str(error),
        )


if __name__ == "__main__":
    main()
