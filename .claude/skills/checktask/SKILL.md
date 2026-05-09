---
name: checktask
description: Read and execute the latest task card from task_cards/
allowed-tools: Bash, Read
---

# Check Task

Read the latest task card from `task_cards/` directory and execute it.

```bash
# Find the latest .md file in task_cards/
latest_file=$(ls -t task_cards/*.md 2>/dev/null | head -1)

if [ -z "$latest_file" ]; then
  echo "No task files found in task_cards/"
  exit 1
fi

echo "Found latest task file: $latest_file"
echo ""
echo "Task file content:"
echo "=================="
cat "$latest_file"
```

After reading the task file, analyze its content and execute the task according to the instructions in the file.
