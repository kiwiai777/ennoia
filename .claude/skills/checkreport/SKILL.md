---
name: checkreport
description: Read the latest completion report from task_cards/
allowed-tools: Bash, Read
---

# Check Report

Read the latest completion report from `task_cards/` directory.

```bash
# Find the latest *-REPORT.md file in task_cards/
latest_report=$(ls -t task_cards/*-REPORT.md 2>/dev/null | head -1)

if [ -z "$latest_report" ]; then
  echo "No report files found in task_cards/"
  exit 1
fi

echo "Found latest report: $latest_report"
echo ""
echo "Report content:"
echo "==============="
cat "$latest_report"
```
