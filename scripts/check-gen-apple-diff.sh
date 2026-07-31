#!/usr/bin/env bash
set -euo pipefail

# Check if there are any modified or untracked files under pulse/app/src-tauri/gen/apple/
# except for those under pulse/app/src-tauri/gen/apple/gen/schemas/

# Get all status entries for the apple directory
status_output=$(git status --porcelain -- pulse/app/src-tauri/gen/apple/)

# If there are no changes, exit cleanly
if [ -z "$status_output" ]; then
  echo "OK: No modifications found under pulse/app/src-tauri/gen/apple/"
  exit 0
fi

# Filter out any files under gen/schemas
dirty_files=$(echo "$status_output" | grep -v "^.*pulse/app/src-tauri/gen/apple/gen/schemas/" | wc -l)

if [ "$dirty_files" -gt 0 ]; then
  echo "ERROR: Modified or untracked files found under pulse/app/src-tauri/gen/apple/ outside of gen/schemas/"
  git status --porcelain -- pulse/app/src-tauri/gen/apple/ | grep -v "^.*pulse/app/src-tauri/gen/apple/gen/schemas/"
  exit 1
else
  echo "OK: No modifications found under pulse/app/src-tauri/gen/apple/ except under gen/schemas/"
  exit 0
fi