#!/bin/bash
model=$1
prompt=$2

payload=$(jq -n --arg model "$model" --arg prompt "$prompt" '{
  "model": $model,
  "messages": [
    {"role": "system", "content": "You are a user preference extractor for cortex. Output ONLY JSON, strictly adhering to the schema."},
    {"role": "user", "content": $prompt}
  ],
  "stream": false,
  "options": {"temperature": 0.1, "seed": 42}
}')

curl -s http://localhost:11434/api/chat -d "$payload" | jq -r .message.content
