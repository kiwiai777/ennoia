#!/bin/bash
model=$1
prompt_file=$2
prompt=$(cat "$prompt_file")

payload=$(jq -n --arg model "$model" --arg prompt "$prompt" '{
  "model": $model,
  "prompt": $prompt,
  "stream": false,
  "options": {"temperature": 0.1, "seed": 42}
}')

curl -s http://localhost:11434/api/generate -d "$payload" | jq -r .response
