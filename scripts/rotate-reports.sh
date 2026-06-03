#!/bin/bash
# WHY: Rotate reports before each run — keeps latest and previous run per env
ENV=${ENV:-qa}
REPORT_DIR="reports/${ENV}"

echo "Rotating reports for env: ${ENV}"

# If latest exists, move to previous (overwrite previous)
if [ -d "${REPORT_DIR}/latest" ]; then
  echo "Moving latest → previous"
  rm -rf "${REPORT_DIR}/previous"
  mv "${REPORT_DIR}/latest" "${REPORT_DIR}/previous"
fi

# Create fresh latest directory
mkdir -p "${REPORT_DIR}/latest"
echo "Report directory ready: ${REPORT_DIR}/latest"
