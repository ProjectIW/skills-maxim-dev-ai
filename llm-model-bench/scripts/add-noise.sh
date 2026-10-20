#!/usr/bin/env bash
# Добавляет к озвучке розовый шум около −50 дБ полной шкалы, чтобы между фразами
# не было цифровой тишины: на ней модели разметки говорящих ошибаются в числе людей.
# Сухой файл сохраняется рядом как <имя>-dry.wav. Нужен ffmpeg 5+ (amix normalize=0).
#
#   bash add-noise.sh ref/sales.wav [ref/school.wav ...]
# Переменные: LEVEL_DB (по умолчанию -50), SEED (по умолчанию 7), RATE (16000).
set -euo pipefail

LEVEL_DB="${LEVEL_DB:--50}"
SEED="${SEED:-7}"
RATE="${RATE:-16000}"
# амплитуда шума из децибел: 10^(дБ/20)
AMP=$(awk -v db="$LEVEL_DB" 'BEGIN { printf "%.6f", 10^(db/20) }')

for f in "$@"; do
  base="${f%.wav}"
  dry="$base-dry.wav"
  if [ -e "$dry" ]; then
    echo "пропуск $f: уже есть $dry (шум добавлен раньше)" >&2
    continue
  fi
  mv "$f" "$dry"
  ffmpeg -hide_banner -loglevel error -i "$dry" \
    -filter_complex "anoisesrc=color=pink:amplitude=$AMP:seed=$SEED:sample_rate=$RATE[n];[0:a]aresample=$RATE,aformat=channel_layouts=mono[s];[s][n]amix=inputs=2:duration=first:normalize=0" \
    -ac 1 -ar "$RATE" -c:a pcm_s16le "$f"
  chmod 644 "$f" "$dry"   # контейнеры не от root не читают файлы 600
  echo "$f: шум ${LEVEL_DB} дБ (seed $SEED), сухой – $dry"
done
