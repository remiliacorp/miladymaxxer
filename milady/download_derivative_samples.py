from __future__ import annotations

import argparse
import html
import random
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .pipeline_common import DERIVATIVE_MANIFEST_PATH, DERIVATIVE_ROOT, guess_extension, read_json_file, write_json_file

IPFS_GATEWAYS = (
    "https://ipfs.io/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
    "https://dweb.link/ipfs/",
    "https://nftstorage.link/ipfs/",
)
DEFAULT_TIMEOUT = 20.0
BATCH_SIZE = 200


@dataclass(frozen=True, slots=True)
class DerivativeCollection:
    slug: str
    name: str
    contract: str
    total_supply: int
    target_count: int
    metadata_url_template: str | None = None
    asset_page_template: str | None = None


COLLECTIONS: tuple[DerivativeCollection, ...] = (
    DerivativeCollection(
        slug="remilio",
        name="Redacted Remilio Babies",
        contract="0xD3D9ddd0CF0A5F0BFB8f7fcEAe075DF687eAEBaB",
        total_supply=10_000,
        target_count=2_000,
        metadata_url_template="https://remilio.org/remilio/json/{token_id}",
    ),
    DerivativeCollection(
        slug="pixelady",
        name="Pixelady Maker",
        contract="0x8Fc0D90f2C45a5e7f94904075c952e0943CFCCfd",
        total_supply=10_000,
        target_count=1_000,
        metadata_url_template="ipfs://bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/{token_id}",
    ),
)


@dataclass(slots=True)
class DownloadResult:
    token_id: int
    success: bool
    local_path: str | None = None
    image_url: str | None = None
    metadata_url: str | None = None
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download deterministic positive samples from Milady derivative collections.")
    parser.add_argument(
        "--collection",
        dest="collections",
        action="append",
        choices=[collection.slug for collection in COLLECTIONS],
        help="Limit to one or more derivative collections. Defaults to all configured collections.",
    )
    parser.add_argument("--concurrency", type=int, default=12, help="Concurrent downloads per batch.")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="Per-request timeout in seconds.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Redownload files even if they already exist locally.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    selected = [collection for collection in COLLECTIONS if not args.collections or collection.slug in args.collections]
    existing_manifest = load_existing_manifest()
    existing_collections = {
        str(collection["slug"]): collection
        for collection in existing_manifest.get("collections", [])
        if isinstance(collection, dict) and isinstance(collection.get("slug"), str)
    }
    manifest_payload: dict[str, object] = {
        "version": 1,
        "generatedAt": None,
        "collections": [],
    }

    with httpx.Client(follow_redirects=True, timeout=args.timeout, headers={"User-Agent": "milady-shrinkifier/0.2.2"}) as client:
        for collection in selected:
            token_ids = sample_token_ids(collection)
            results: list[DownloadResult] = []
            for offset in range(0, len(token_ids), BATCH_SIZE):
                batch = token_ids[offset : offset + BATCH_SIZE]
                with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
                    future_map = {
                        executor.submit(download_token, client, collection, token_id, args.force): token_id
                        for token_id in batch
                    }
                    for future in as_completed(future_map):
                        results.append(future.result())

            successful_results = sorted((result for result in results if result.success), key=lambda result: result.token_id)
            failed_results = sorted((result for result in results if not result.success), key=lambda result: result.token_id)

            existing_collections[collection.slug] = {
                "slug": collection.slug,
                "name": collection.name,
                "contract": collection.contract,
                "totalSupply": collection.total_supply,
                "targetCount": collection.target_count,
                "sampleCount": len(token_ids),
                "downloadedCount": len(successful_results),
                "failedCount": len(failed_results),
                "samples": [
                    {
                        "tokenId": result.token_id,
                        "localPath": result.local_path,
                        "imageUrl": result.image_url,
                        "metadataUrl": result.metadata_url,
                    }
                    for result in successful_results
                ],
                "failures": [
                    {
                        "tokenId": result.token_id,
                        "error": result.error,
                    }
                    for result in failed_results
                ],
            }
            print(
                f"{collection.slug}: downloaded {len(successful_results)}/{len(token_ids)} "
                f"(target {min(collection.target_count, collection.total_supply)}, failed {len(failed_results)})"
            )

    manifest_payload["generatedAt"] = datetime.now(UTC).isoformat()
    manifest_payload["collections"] = [
        existing_collections[collection.slug]
        for collection in COLLECTIONS
        if collection.slug in existing_collections
    ] + [
        payload
        for slug, payload in sorted(existing_collections.items())
        if slug not in {collection.slug for collection in COLLECTIONS}
    ]
    write_json_file(DERIVATIVE_MANIFEST_PATH, manifest_payload)
    print(f"Wrote derivative manifest to {DERIVATIVE_MANIFEST_PATH}")


def sample_token_ids(collection: DerivativeCollection) -> list[int]:
    sample_count = min(collection.target_count, collection.total_supply)
    token_ids = list(range(1, collection.total_supply + 1))
    if sample_count >= len(token_ids):
        return token_ids
    rng = random.Random(f"{collection.slug}:{collection.total_supply}:{sample_count}:v1")
    return sorted(rng.sample(token_ids, sample_count))


def load_existing_manifest() -> dict[str, object]:
    if not DERIVATIVE_MANIFEST_PATH.exists():
        return {"version": 1, "generatedAt": None, "collections": []}
    try:
        payload = read_json_file(DERIVATIVE_MANIFEST_PATH)
    except (OSError, ValueError, TypeError):
        return {"version": 1, "generatedAt": None, "collections": []}
    if not isinstance(payload, dict):
        return {"version": 1, "generatedAt": None, "collections": []}
    if not isinstance(payload.get("collections"), list):
        payload["collections"] = []
    return payload


def download_token(client: httpx.Client, collection: DerivativeCollection, token_id: int, force: bool) -> DownloadResult:
    collection_root = DERIVATIVE_ROOT / collection.slug
    collection_root.mkdir(parents=True, exist_ok=True)
    existing = find_existing_file(collection_root, token_id)
    if existing is not None and not force:
        return DownloadResult(
            token_id=token_id,
            success=True,
            local_path=str(existing),
        )

    try:
        metadata_url, image_url = resolve_urls(client, collection, token_id)
        response = client.get(image_url)
        response.raise_for_status()
        payload = response.content
        extension = guess_extension(response.headers.get("content-type"), image_url)
        destination = collection_root / f"{token_id}{extension}"
        destination.write_bytes(payload)
        return DownloadResult(
            token_id=token_id,
            success=True,
            local_path=str(destination),
            image_url=image_url,
            metadata_url=metadata_url,
        )
    except Exception as error:  # noqa: BLE001
        return DownloadResult(token_id=token_id, success=False, error=str(error))


def find_existing_file(collection_root: Path, token_id: int) -> Path | None:
    matches = sorted(collection_root.glob(f"{token_id}.*"))
    return matches[0] if matches else None


def resolve_urls(client: httpx.Client, collection: DerivativeCollection, token_id: int) -> tuple[str | None, str]:
    if collection.metadata_url_template:
        metadata_url_template = collection.metadata_url_template.format(token_id=token_id)
        metadata_url, payload = fetch_json_with_fallback(client, metadata_url_template)
        image_url = extract_image_url(payload)
        if image_url is None:
            raise ValueError(f"No image URL in metadata for {collection.slug} #{token_id}")
        _, image_url = fetch_head_candidate(client, image_url)
        return metadata_url, image_url

    if collection.asset_page_template:
        asset_url = collection.asset_page_template.format(token_id=token_id)
        response = client.get(asset_url)
        response.raise_for_status()
        image_url = extract_opensea_image_url(response.text, collection.contract)
        if image_url is None:
            raise ValueError(f"No OpenSea cached image URL found for {collection.slug} #{token_id}")
        return asset_url, image_url

    raise ValueError(f"No source configured for {collection.slug}")


def normalize_urls(url: str) -> list[str]:
    if not url.startswith("ipfs://"):
        return [url]
    cid_path = url.removeprefix("ipfs://")
    return [f"{gateway}{cid_path}" for gateway in IPFS_GATEWAYS]


def extract_image_url(payload: dict[str, object]) -> str | None:
    for key in ("image", "image_url", "imageUrl"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def fetch_json_with_fallback(client: httpx.Client, url: str) -> tuple[str, dict[str, object]]:
    errors: list[str] = []
    for candidate in normalize_urls(url):
        try:
            response = client.get(candidate)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                return candidate, payload
            raise ValueError("metadata payload is not an object")
        except Exception as error:  # noqa: BLE001
            errors.append(f"{candidate}: {error}")
    raise ValueError("; ".join(errors))


def fetch_head_candidate(client: httpx.Client, url: str) -> tuple[str, str]:
    errors: list[str] = []
    for candidate in normalize_urls(url):
        try:
            response = client.head(candidate)
            response.raise_for_status()
            return candidate, candidate
        except Exception as error:  # noqa: BLE001
            errors.append(f"{candidate}: {error}")

    for candidate in normalize_urls(url):
        try:
            response = client.get(candidate, headers={"Range": "bytes=0-0"})
            response.raise_for_status()
            return candidate, candidate
        except Exception as error:  # noqa: BLE001
            errors.append(f"{candidate}: {error}")

    raise ValueError("; ".join(errors))


def extract_opensea_image_url(page_html: str, contract: str) -> str | None:
    normalized_contract = contract.lower()
    pattern = re.compile(rf"https://i2c\.seadn\.io/ethereum/{re.escape(normalized_contract)}/[^\"' ]+")
    match = pattern.search(page_html)
    if match is None:
        return None
    return html.unescape(match.group(0)).replace("\\", "")


if __name__ == "__main__":
    main()
