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

"""Row-level Sources for offline CSV tables.

Each data row is captured independently so a citation can be traced back to
its exact record without relying on physical row numbers.
"""

from __future__ import annotations

import csv
import io
import json
from urllib.parse import quote

from pydantic import BaseModel, JsonValue, field_validator, model_validator

from powercontext.limits import MAX_SOURCE_ID_LENGTH
from powercontext.sources.definitions import AdapterSourceDefinition, SourceDefinition
from powercontext.sources.models import Source, SourceMaterialization
from powercontext.sources.projections import TEXT_EVIDENCE_PROJECTION_KEY, TextEvidence

CSV_ROW_SOURCE_NAME = "csv-row"


class CSVDocumentInput(BaseModel):
    """A complete offline CSV document and the primary key used for row identity."""

    document_id: str
    primary_key: str
    content: bytes


class CSVRowInput(BaseModel):
    """One validated CSV row, preserving the original column order and values."""

    document_id: str
    primary_key: str
    primary_key_value: str
    columns: tuple[str, ...]
    values: tuple[str, ...]


class CSVRowSource(Source):
    """A captured CSV row with a stable identity derived from the document and key."""

    source_id: str
    document_id: str
    primary_key: str
    primary_key_value: str
    columns: tuple[str, ...]
    values: tuple[str, ...]

    @field_validator("source_id")
    @classmethod
    def validate_source_id(cls, value: str) -> str:
        if not value or value != value.strip() or len(value) > MAX_SOURCE_ID_LENGTH:
            raise ValueError("source_id must be a bounded, non-empty trimmed string")  # noqa: TRY003
        return value

    @model_validator(mode="after")
    def validate_row_identity(self) -> CSVRowSource:
        if self.name != self.source_id:
            raise ValueError("source name must equal source_id")  # noqa: TRY003
        if len(self.columns) != len(self.values):
            raise ValueError("columns and values must have the same length")  # noqa: TRY003
        return self


class CSVRowSourceAdapter:
    """Resolve CSV row inputs into captured Sources and read them back unchanged."""

    input_class = CSVRowInput
    name = CSV_ROW_SOURCE_NAME
    source_class = CSVRowSource

    async def resolve(self, value: CSVRowInput, /) -> CSVRowSource:
        source_id = csv_row_source_id(value.document_id, value.primary_key_value)
        return CSVRowSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            document_id=value.document_id,
            primary_key=value.primary_key,
            primary_key_value=value.primary_key_value,
            columns=value.columns,
            values=value.values,
        )

    async def read(self, source: CSVRowSource, /) -> CSVRowInput:
        return CSVRowInput(
            document_id=source.document_id,
            primary_key=source.primary_key,
            primary_key_value=source.primary_key_value,
            columns=source.columns,
            values=source.values,
        )


class CSVRowTextEvidenceProjection:
    """Expose a CSV row as a JSON object keyed by its original header columns."""

    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = CSVRowSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: CSVRowSource, /) -> TextEvidence:
        row: dict[str, JsonValue] = dict(zip(source.columns, source.values, strict=True))
        content = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
        return TextEvidence(
            source_type=CSV_ROW_SOURCE_NAME,
            source_id=source.source_id,
            content=content,
            metadata={
                "document_id": source.document_id,
                "primary_key": source.primary_key,
                "primary_key_value": source.primary_key_value,
                "columns": list(source.columns),
                "row": row,
            },
        )


def parse_csv_document(value: CSVDocumentInput) -> tuple[CSVRowInput, ...]:
    """Parse and validate a whole CSV document before returning any row.

    The implementation follows ``csv.reader`` with its default Excel dialect and
    ``strict=True``.  Every failure is reported as ``ValueError`` and no partial
    result is returned.
    """

    _validate_document_id(value.document_id)
    _validate_primary_key(value.primary_key)
    records = _read_records(_decode_content(value.content))
    if not records:
        raise ValueError("CSV document must contain a header record")  # noqa: TRY003

    columns, key_index = _validate_header(records[0], value.primary_key)
    return _build_rows(value.document_id, value.primary_key, columns, key_index, records[1:])


def csv_row_source_id(document_id: str, primary_key_value: str) -> str:
    """Build the stable, delimiter-safe identity for one CSV row."""

    _validate_document_id(document_id)
    if not isinstance(primary_key_value, str):
        raise ValueError("primary_key_value must be a string")  # noqa: TRY003, TRY004
    source_id = f"csv:{quote(document_id, safe='')}:{quote(primary_key_value, safe='')}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        raise ValueError(  # noqa: TRY003
            f"CSV row source_id must not exceed {MAX_SOURCE_ID_LENGTH} characters"
        )
    return source_id


def _decode_content(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("CSV content must be valid UTF-8") from error  # noqa: TRY003


def _read_records(text: str) -> list[list[str]]:
    records: list[list[str]] = []
    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        for record in reader:
            records.append(record)
    except csv.Error as error:
        raise ValueError(f"malformed CSV document: {error}") from error  # noqa: TRY003
    return records


def _validate_header(header: list[str], primary_key: str) -> tuple[tuple[str, ...], int]:
    if not header:
        raise ValueError("CSV header must not be empty")  # noqa: TRY003

    seen: set[str] = set()
    for column in header:
        if not column.strip():
            raise ValueError("CSV header fields must be non-empty and not blank")  # noqa: TRY003
        if column in seen:
            raise ValueError(f"duplicate CSV header field: {column!r}")  # noqa: TRY003
        seen.add(column)

    try:
        key_index = header.index(primary_key)
    except ValueError:
        raise ValueError(f"primary key column not found: {primary_key!r}") from None  # noqa: TRY003
    return tuple(header), key_index


def _build_rows(
    document_id: str,
    primary_key: str,
    columns: tuple[str, ...],
    key_index: int,
    records: list[list[str]],
) -> tuple[CSVRowInput, ...]:
    rows: list[CSVRowInput] = []
    seen_keys: set[str] = set()
    for record in records:
        if not record:
            # A completely empty physical record is not a data row.
            continue
        if len(record) != len(columns):
            raise ValueError(  # noqa: TRY003
                f"CSV data record has {len(record)} fields, expected {len(columns)}"
            )

        primary_key_value = record[key_index]
        if not primary_key_value.strip():
            raise ValueError("primary key values must be non-empty and not blank")  # noqa: TRY003
        if primary_key_value in seen_keys:
            raise ValueError(f"duplicate primary key value: {primary_key_value!r}")  # noqa: TRY003
        seen_keys.add(primary_key_value)

        rows.append(
            CSVRowInput(
                document_id=document_id,
                primary_key=primary_key,
                primary_key_value=primary_key_value,
                columns=columns,
                values=tuple(record),
            )
        )
    return tuple(rows)


def _validate_primary_key(primary_key: object) -> None:
    if not isinstance(primary_key, str) or not primary_key:
        raise ValueError("primary_key must be a non-empty string")  # noqa: TRY003


def _validate_document_id(document_id: object) -> None:
    if not isinstance(document_id, str) or not document_id:
        raise ValueError("document_id must be a non-empty string")  # noqa: TRY003
    if document_id != document_id.strip():
        raise ValueError("document_id must not contain leading or trailing whitespace")  # noqa: TRY003


CSV_ROW_SOURCE_ADAPTER = CSVRowSourceAdapter()
CSV_ROW_SOURCE_DEFINITION: SourceDefinition[CSVRowInput, CSVRowSource, CSVRowInput] = AdapterSourceDefinition(
    CSV_ROW_SOURCE_ADAPTER,
    projections=(CSVRowTextEvidenceProjection(),),
)


__all__ = [
    "CSV_ROW_SOURCE_DEFINITION",
    "CSV_ROW_SOURCE_NAME",
    "CSVDocumentInput",
    "CSVRowInput",
    "CSVRowSource",
    "CSVRowSourceAdapter",
    "CSVRowTextEvidenceProjection",
    "csv_row_source_id",
    "parse_csv_document",
]
