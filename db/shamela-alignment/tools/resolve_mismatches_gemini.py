"""db/shamela-alignment/tools/resolve_mismatches_gemini.py

Use Gemini (gemini-4-hydrogen, structured output via Interactions API) to resolve
only the hard unmatched / split / merged / wording-mismatch rows left over after
deterministic Shamela alignment.

Usage:
  python resolve_mismatches_gemini.py <input_cases.jsonl> <output_decisions.jsonl> [--limit 20]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Literal

from google import genai
from pydantic import BaseModel, Field


class AlignmentDecision(BaseModel):
    action: Literal["match", "merge_into_prev", "split", "keep_as_is"] = Field(
        description="How this database row maps to the new Shamela edition."
    )
    target_nums: List[int] = Field(
        default_factory=list,
        description="Matched hadith number(s) in the new Shamela edition (empty if merge_into_prev or keep_as_is).",
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence from 0.0 to 1.0.",
    )
    reason: str = Field(
        description="Short explanation (e.g. 'زوائد أبي الحسن القطان merged in new edition', 'same hadith with wording variant')."
    )


def load_api_key() -> str:
    env_candidates = [
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parents[3] / ".env.local",
        Path(__file__).resolve().parents[3] / ".env",
    ]
    for p in env_candidates:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "GEMINI_API_KEY" and v.strip():
                    return v.strip().strip('"').strip("'")
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not found in db/shamela-alignment/.env, .env.local, or environment")
    return key


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("input_jsonl", type=Path)
    parser.add_argument("output_jsonl", type=Path)
    parser.add_argument("--limit", type=int, default=0, help="Process at most N rows (0 = all)")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent API workers")
    args = parser.parse_args()

    api_key = load_api_key()
    client = genai.Client(api_key=api_key)

    cases = [json.loads(l) for l in args.input_jsonl.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit > 0:
        cases = cases[: args.limit]

    schema = AlignmentDecision.model_json_schema()

    def process_one(idx: int, c: dict) -> tuple[int, dict]:
        cand_block = "\n".join(
            f"- Hadith #{cand['num']}: {cand['text'][:600]}"
            for cand in c.get("candidates", [])
        )
        prompt = (
            "You are a hadith-edition alignment expert comparing an existing database row "
            "against candidate hadiths from a newer critical edition (سنن ابن ماجه - ت عصام موسى هادي).\n\n"
            f"Existing DB row (main_id={c['main_id']}, old_num={c.get('old_num')}):\n"
            f"{c['old_text'][:800]}\n\n"
            f"Candidate hadiths from new edition:\n{cand_block}\n\n"
            "Decide:\n"
            "- 'match': maps 1-to-1 to one candidate number in target_nums.\n"
            "- 'split': existing row spans multiple candidate numbers in target_nums.\n"
            "- 'merge_into_prev': existing row is a student addition (e.g. زوائد أبي الحسن القطان) or tail note that the new edition folds into the preceding hadith.\n"
            "- 'keep_as_is': none of the candidates correspond to this row."
        )

        interaction = client.interactions.create(
            model="gemini-4-hydrogen",
            input=prompt,
            store=False,
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": schema,
            },
        )
        decision = AlignmentDecision.model_validate_json(interaction.output_text)
        row_out = {
            "main_id": c["main_id"],
            "old_num": c.get("old_num"),
            **decision.model_dump(),
        }
        return idx, row_out

    results: list[dict | None] = [None] * len(cases)
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = [ex.submit(process_one, idx, c) for idx, c in enumerate(cases)]
        done = 0
        for fut in as_completed(futs):
            idx, row_out = fut.result()
            results[idx] = row_out
            done += 1
            if done % 25 == 0 or done == len(cases):
                print(f"[{done}/{len(cases)}] main_id={row_out['main_id']} -> {row_out['action']} {row_out['target_nums']} ({row_out['confidence']:.2f})")

    args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    args.output_jsonl.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in results) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
