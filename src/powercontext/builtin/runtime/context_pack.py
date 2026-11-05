# Copyright (c) 2026 OceanBase.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Chunked, checksummed Context Pack transport with prefix deltas.

The JSON shapes in this module are an interoperability contract.  Keep the
canonical encoding, field sets, Base64 representation, and SHA-256 digest
stable when changing the implementation.
"""

# ruff: noqa: TRY003

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

PACK_SCHEMA = "powercontext.context-pack.v1"
DELTA_SCHEMA = "powercontext.context-pack-delta.v1"
DEFAULT_CHUNK_BYTES = 512


class ContextPackError(ValueError):
    """The wire payload, chunking, or prefix reconstruction is invalid."""


class ContextPack:
    """A complete Context Pack made of ordered, independently encoded chunks."""

    __slots__ = ("_byte_count", "_digest", "_items")

    def __init__(self, items: tuple[bytes, ...], digest: str, byte_count: int) -> None:
        self._items = _coerce_items(items)
        _validate_digest(digest)
        if type(byte_count) is not int or byte_count < 0:
            raise ContextPackError("byte_count must be a non-negative integer")
        self._digest = digest
        self._byte_count = byte_count

    @classmethod
    def build(cls, items: tuple[bytes, ...] | list[bytes]) -> ContextPack:
        """Build a complete pack from ordered raw byte chunks."""

        values = _coerce_items(items)
        digest = _pack_digest(values)
        byte_count = _packed_byte_count(values, digest)
        return cls(values, digest, byte_count)

    @classmethod
    def from_content(cls, content: str | bytes, *, chunk_bytes: int = DEFAULT_CHUNK_BYTES) -> ContextPack:
        """Split UTF-8 content at character boundaries without exceeding ``chunk_bytes``."""

        chunks = _chunk_utf8(content, chunk_bytes)
        return cls.build(chunks)

    @classmethod
    def from_bytes(cls, value: bytes) -> ContextPack:
        """Decode and fully validate one canonical complete Pack."""

        payload = _load_wire_object(value)
        _require_exact_fields(payload, {"schema", "items", "digest", "byte_count"})
        if payload["schema"] != PACK_SCHEMA:
            raise ContextPackError("unsupported Context Pack schema")
        items = _decode_items(payload["items"])
        digest = payload["digest"]
        _validate_digest(digest)
        byte_count = payload["byte_count"]
        if type(byte_count) is not int or byte_count < 0:
            raise ContextPackError("byte_count must be a non-negative integer")
        expected_digest = _pack_digest(items)
        if digest != expected_digest:
            raise ContextPackError("Context Pack digest does not match its items")
        pack = cls(items, digest, byte_count)
        if byte_count != len(value):
            raise ContextPackError("byte_count does not match the encoded Pack")
        if len(pack.to_bytes()) != byte_count:
            raise ContextPackError("byte_count does not match the canonical Pack")
        return pack

    @property
    def items(self) -> tuple[bytes, ...]:
        return self._items

    @property
    def digest(self) -> str:
        return self._digest

    @property
    def byte_count(self) -> int:
        return self._byte_count

    def to_bytes(self) -> bytes:
        """Serialize the complete Pack using the canonical wire encoding."""

        return _pack_bytes(self._items, self._digest, self._byte_count)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ContextPack):
            return NotImplemented
        return self._items == other._items and self._digest == other._digest and self._byte_count == other._byte_count

    def __hash__(self) -> int:
        return hash((self._items, self._digest, self._byte_count))

    def __repr__(self) -> str:
        return f"ContextPack(items={self._items!r}, digest={self._digest!r}, byte_count={self._byte_count})"


@dataclass(frozen=True)
class ContextPackDelta:
    """A prefix-reuse delta that turns one complete Pack into another."""

    base_digest: str
    target_digest: str
    prefix_items: int
    appended: tuple[bytes, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not isinstance(self.appended, tuple):
            object.__setattr__(self, "appended", tuple(self.appended))
        for item in self.appended:
            if not isinstance(item, bytes):
                raise ContextPackError("every delta appended item must be bytes")

    @classmethod
    def between(cls, base: ContextPack, target: ContextPack) -> ContextPackDelta:
        """Select the longest reusable chunk prefix and carry the target suffix."""

        if not isinstance(base, ContextPack) or not isinstance(target, ContextPack):
            raise ContextPackError("delta endpoints must be ContextPack values")
        prefix_items = _common_prefix_length(base.items, target.items)
        return cls(base.digest, target.digest, prefix_items, target.items[prefix_items:])

    @classmethod
    def from_bytes(cls, value: bytes) -> ContextPackDelta:
        """Decode and validate one delta wire payload."""

        payload = _load_wire_object(value)
        _require_exact_fields(payload, {"schema", "base_digest", "target_digest", "prefix_items", "appended"})
        if payload["schema"] != DELTA_SCHEMA:
            raise ContextPackError("unsupported Context Pack delta schema")
        base_digest = payload["base_digest"]
        target_digest = payload["target_digest"]
        _validate_digest(base_digest)
        _validate_digest(target_digest)
        prefix_items = payload["prefix_items"]
        if type(prefix_items) is not int or prefix_items < 0:
            raise ContextPackError("prefix_items must be a non-negative integer")
        appended = _decode_items(payload["appended"])
        return cls(base_digest, target_digest, prefix_items, appended)

    @property
    def byte_count(self) -> int:
        return len(self.to_bytes())

    def to_bytes(self) -> bytes:
        """Serialize the delta without an extra ``byte_count`` field."""

        payload = {
            "schema": DELTA_SCHEMA,
            "base_digest": self.base_digest,
            "target_digest": self.target_digest,
            "prefix_items": self.prefix_items,
            "appended": [_encode_item(item) for item in self.appended],
        }
        return _canonical_json(payload)


def apply_context_pack_delta(base: ContextPack, delta: ContextPackDelta) -> ContextPack:
    """Validate a delta against ``base`` and return the reconstructed target Pack."""

    if not isinstance(base, ContextPack) or not isinstance(delta, ContextPackDelta):
        raise ContextPackError("apply requires a ContextPack and a ContextPackDelta")
    if base.digest != delta.base_digest:
        raise ContextPackError("delta base_digest does not match the provided base Pack")
    if type(delta.prefix_items) is not int or delta.prefix_items < 0:
        raise ContextPackError("prefix_items must be a non-negative integer")
    if delta.prefix_items > len(base.items):
        raise ContextPackError("prefix_items exceeds the base Pack chunk count")
    items = base.items[: delta.prefix_items] + delta.appended
    target = ContextPack.build(items)
    if target.digest != delta.target_digest:
        raise ContextPackError("reconstructed target digest does not match delta target_digest")
    return target


def _coerce_items(items: tuple[bytes, ...] | list[bytes]) -> tuple[bytes, ...]:
    if isinstance(items, (bytes, bytearray, str)):
        raise ContextPackError("items must be an iterable of bytes chunks")
    try:
        values = tuple(items)
    except TypeError as error:
        raise ContextPackError("items must be an iterable of bytes chunks") from error
    for item in values:
        if not isinstance(item, bytes):
            raise ContextPackError("every Context Pack item must be bytes")
    return values


def _chunk_utf8(content: str | bytes, chunk_bytes: int) -> tuple[bytes, ...]:
    if type(chunk_bytes) is not int or chunk_bytes <= 0:
        raise ContextPackError("chunk_bytes must be a positive integer")
    if isinstance(content, bytes):
        try:
            content = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ContextPackError("content must be valid UTF-8") from error
    elif not isinstance(content, str):
        raise ContextPackError("content must be text or UTF-8 bytes")

    chunks: list[bytes] = []
    current = bytearray()
    for character in content:
        encoded = character.encode("utf-8")
        if len(encoded) > chunk_bytes:
            raise ContextPackError("a single UTF-8 character exceeds chunk_bytes")
        if current and len(current) + len(encoded) > chunk_bytes:
            chunks.append(bytes(current))
            current.clear()
        current.extend(encoded)
    if current:
        chunks.append(bytes(current))
    return tuple(chunks)


def _common_prefix_length(left: tuple[bytes, ...], right: tuple[bytes, ...]) -> int:
    limit = min(len(left), len(right))
    index = 0
    while index < limit and left[index] == right[index]:
        index += 1
    return index


def _pack_digest(items: tuple[bytes, ...]) -> str:
    unsigned = {"schema": PACK_SCHEMA, "items": [_encode_item(item) for item in items]}
    return "sha256:" + hashlib.sha256(_canonical_json(unsigned)).hexdigest()


def _packed_byte_count(items: tuple[bytes, ...], digest: str) -> int:
    byte_count = 0
    # The decimal width of byte_count is part of its own length.  Iterate to
    # the fixed point instead of assuming a fixed number of digits.
    while True:
        encoded = _pack_bytes(items, digest, byte_count)
        if len(encoded) == byte_count:
            return byte_count
        byte_count = len(encoded)


def _pack_bytes(items: tuple[bytes, ...], digest: str, byte_count: int) -> bytes:
    payload = {
        "schema": PACK_SCHEMA,
        "items": [_encode_item(item) for item in items],
        "digest": digest,
        "byte_count": byte_count,
    }
    return _canonical_json(payload)


def _encode_item(item: bytes) -> str:
    return base64.b64encode(item).decode("ascii")


def _decode_items(value: Any) -> tuple[bytes, ...]:
    if not isinstance(value, list):
        raise ContextPackError("items must be a JSON array")
    return tuple(_decode_item(item) for item in value)


def _decode_item(value: Any) -> bytes:
    if not isinstance(value, str):
        raise ContextPackError("Base64 item must be a string")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ContextPackError("invalid Base64 item") from error
    if _encode_item(decoded) != value:
        raise ContextPackError("Base64 item is not canonical")
    return decoded


def _canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _load_wire_object(value: bytes) -> dict[str, Any]:
    if not isinstance(value, bytes):
        raise ContextPackError("wire payload must be bytes")
    try:
        text = value.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ContextPackError("wire payload must be valid UTF-8") from error

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, nested in pairs:
            if key in result:
                raise ContextPackError(f"duplicate wire field: {key}")
            result[key] = nested
        return result

    try:
        payload = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except ContextPackError:
        raise
    except json.JSONDecodeError as error:
        raise ContextPackError("wire payload must be valid JSON") from error
    if not isinstance(payload, dict):
        raise ContextPackError("wire payload must be a JSON object")
    return payload


def _require_exact_fields(payload: dict[str, Any], expected: set[str]) -> None:
    actual = set(payload)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ContextPackError(f"invalid wire fields (missing={missing!r}, extra={extra!r})")


def _validate_digest(value: object) -> None:
    if not isinstance(value, str) or not value.startswith("sha256:"):
        raise ContextPackError("digest must be a sha256:<hex> string")
    hexadecimal = value.removeprefix("sha256:")
    if len(hexadecimal) != 64 or hexadecimal != hexadecimal.lower():
        raise ContextPackError("digest must be a lowercase sha256:<64 hex> string")
    try:
        int(hexadecimal, 16)
    except ValueError as error:
        raise ContextPackError("digest must contain hexadecimal characters") from error


__all__ = [
    "DEFAULT_CHUNK_BYTES",
    "DELTA_SCHEMA",
    "PACK_SCHEMA",
    "ContextPack",
    "ContextPackDelta",
    "ContextPackError",
    "apply_context_pack_delta",
]
