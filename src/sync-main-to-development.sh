#!/bin/bash
# ─────────────────────────────────────────────────────────
# Safely point main at development's current HEAD.
# Old main is preserved as main-backup (local + remote).
# Run from the repo root. Safe to re-run.
# ─────────────────────────────────────────────────────────

set -e

echo ""
echo "=== Pre-flight checks ==="
echo ""

# Show where things stand
echo "development is at:"
git log --oneline -1 development
echo ""
echo "main is at:"
git log --oneline -1 main
echo ""
echo "Commits on development not in main:"
git rev-list --count main..development
echo ""

read -p "Proceed? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "=== Step 1: Backup old main as main-backup ==="
git branch -f main-backup main
echo "  Local backup: main-backup -> $(git rev-parse --short main-backup)"

echo ""
echo "=== Step 2: Push backup to remote ==="
git push origin main-backup --force
echo "  Remote backup pushed."

echo ""
echo "=== Step 3: Move local main to development's HEAD ==="
git branch -f main development
echo "  Local main -> $(git rev-parse --short main)"

echo ""
echo "=== Step 4: Push main to remote (force-with-lease) ==="
git push origin main --force-with-lease
echo "  Remote main updated."

echo ""
echo "=== Done ==="
echo ""
echo "main and development now point to the same commit:"
git log --oneline -1 main
echo ""
echo "Old main preserved as main-backup:"
git log --oneline -1 main-backup
echo ""
echo "To delete the backup later:  git branch -d main-backup && git push origin --delete main-backup"
