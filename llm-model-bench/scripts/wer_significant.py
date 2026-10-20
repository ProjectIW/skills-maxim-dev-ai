#!/usr/bin/env python3
"""WER по всем и по значимым словам, точность чисел и терминов.

Запуск (только стандартная библиотека):
    python3 -I wer_significant.py --ref truth.tsv --hyp out.txt [--terms terms.txt] [--json]

ref: TSV истины (start, end, speaker, text – берётся последний столбец) или обычный текст.
hyp: текст модели (TXT) или TSV того же вида.
terms: по термину в строке (имена, бренды, латиница) – считается доля найденных в гипотезе.

Значимые слова – все, кроме слов-паразитов и междометий: ошибки в них люди не замечают,
а в общем WER они перевешивают ошибки в именах и числах.
"""
import argparse
import json
import re
import sys
from collections import Counter

FILLERS = {
    "ну", "вот", "э", "ээ", "эм", "мм", "а", "ага", "угу", "ой", "ах", "как", "бы", "типа",
    "короче", "значит", "так", "же", "ли", "то", "вообще", "кстати", "собственно", "да", "нет",
}
NUM_WORDS = re.compile(
    r"^(ноль|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|"
    r"\w*надцать|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|"
    r"сто|двести|триста|четыреста|\w*сот|тысяч\w*|миллион\w*|миллиард\w*|\w*сотых|половин\w*)$"
)


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    if lines and all("\t" in ln for ln in lines if ln.strip()):
        rows = [ln.split("\t") for ln in lines if ln.strip()]
        if rows and rows[0][0].lower() in ("start", "start_sec"):
            rows = rows[1:]
        return " ".join(r[-1] for r in rows)
    return " ".join(lines)


def norm(text: str) -> list[str]:
    text = text.lower().replace("ё", "е")
    text = re.sub(r"(\d)[\s ](?=\d{3}\b)", r"\1", text)  # 2 400 000 → 2400000
    text = re.sub(r"[^\w\s%-]", " ", text)
    return [t.strip("-") for t in text.split() if t.strip("-")]


def align(ref: list[str], hyp: list[str]):
    """Левенштейн с восстановлением пути: возвращает список пар (r, h), где None – вставка/удаление."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    pairs, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            pairs.append((ref[i - 1], hyp[j - 1])); i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            pairs.append((ref[i - 1], None)); i -= 1
        else:
            pairs.append((None, hyp[j - 1])); j -= 1
    return list(reversed(pairs)), d[n][m]


def wer(ref: list[str], hyp: list[str]) -> float:
    return align(ref, hyp)[1] / max(1, len(ref))


def is_number(tok: str) -> bool:
    return bool(re.search(r"\d", tok)) or bool(NUM_WORDS.match(tok))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--hyp", required=True)
    ap.add_argument("--terms")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    ref, hyp = norm(read_text(a.ref)), norm(read_text(a.hyp))
    sig_ref = [t for t in ref if t not in FILLERS]
    sig_hyp = [t for t in hyp if t not in FILLERS]
    pairs, _ = align(sig_ref, sig_hyp)

    nums = [(r, h) for r, h in pairs if r is not None and is_number(r)]
    num_ok = sum(1 for r, h in nums if r == h)
    subs = Counter(f"{r} → {h}" for r, h in pairs if r and h and r != h)

    res = {
        "ref_words": len(ref),
        "wer_all": round(wer(ref, hyp) * 100, 1),
        "wer_significant": round(wer(sig_ref, sig_hyp) * 100, 1),
        "numbers_total": len(nums),
        "numbers_ok_pct": round(100 * num_ok / len(nums), 1) if nums else None,
        "top_substitutions": subs.most_common(10),
    }
    if a.terms:
        with open(a.terms, encoding="utf-8") as fh:
            terms = [t.strip() for t in fh if t.strip()]
        hyp_text = " " + " ".join(hyp) + " "
        found = [t for t in terms if " " + " ".join(norm(t)) + " " in hyp_text]
        res["terms_total"] = len(terms)
        res["terms_found_pct"] = round(100 * len(found) / len(terms), 1) if terms else None
        res["terms_missed"] = [t for t in terms if t not in found][:20]

    if a.json:
        json.dump(res, sys.stdout, ensure_ascii=False, indent=1)
        print()
    else:
        print(f"слов в истине: {res['ref_words']}")
        print(f"WER общий: {res['wer_all']} %   WER по значимым словам: {res['wer_significant']} %")
        if nums:
            print(f"числа: {num_ok} из {len(nums)} верно ({res['numbers_ok_pct']} %)")
        if a.terms:
            print(f"термины: найдено {res['terms_found_pct']} %, пропущены: {', '.join(res['terms_missed'])}")
        print("частые замены:", "; ".join(f"{k} ({v})" for k, v in res["top_substitutions"]))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
