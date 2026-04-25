# 创建 fixture workspace
FIXTURE=$(mktemp -d)
cat > $FIXTURE/USER.md << 'END'
# USER.md - About Your Human
- **Name:** Test User

This is existing content that should be preserved.
END

export HOME=$FIXTURE

# 写入一些测试数据
mkdir -p $FIXTURE/.cortex
cat > $FIXTURE/.cortex/user_model.json << 'END'
{
  "schema_version": "0.1",
  "projects": [],
  "goals": [{"id": "g1", "label": "learn Rust this year", "created_at": "", "updated_at": ""}],
  "preferences": [{"id": "p1", "label": "TypeScript over JavaScript for all projects", "created_at": "", "updated_at": ""}],
  "constraints": [],
  "skills": [],
  "states": [],
  "decision_rules": [],
  "meta": { "last_updated": null, "sources": [], "confidence": null }
}
END

echo "=== USER.md before inject ==="
cat $FIXTURE/USER.md
echo

# 实际写入
npx tsx src/index.ts inject --target openclaw --workspace $FIXTURE

echo
echo "=== USER.md after inject ==="
cat $FIXTURE/USER.md

# 清理
rm -rf $FIXTURE
