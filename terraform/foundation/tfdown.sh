#!/usr/bin/env bash
#
# tfdown.sh - tear down the ephemeral AKS + OIDC foundation.
#
# Safe to run standalone (end of a work session) or automatically from
# tfup.sh's failure path. Pass --auto-approve to skip terraform's interactive
# confirmation (used by tfup.sh; also handy for your own end-of-session runs).
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/.session-outputs.env"
KUBECONFIG_FILE="${SCRIPT_DIR}/.kubeconfig"

cd "${SCRIPT_DIR}"

AUTO_APPROVE_FLAG=""
if [[ "${1:-}" == "--auto-approve" ]]; then
  AUTO_APPROVE_FLAG="-auto-approve"
fi

if [[ -z "${TF_VAR_subscription_id:-}" ]]; then
  echo "TF_VAR_subscription_id is not set."
  read -r -p "Enter your Azure subscription ID: " sub_id
  export TF_VAR_subscription_id="${sub_id}"
fi

echo "==> terraform destroy"
terraform destroy -input=false ${AUTO_APPROVE_FLAG}
DESTROY_STATUS=$?

# Clean up session artifacts regardless of destroy's outcome - stale
# outputs/kubeconfig pointing at a torn-down (or partially torn-down)
# cluster are actively misleading to leave lying around.
rm -f "${OUTPUT_FILE}" "${OUTPUT_FILE}.tmp" "${KUBECONFIG_FILE}" "${KUBECONFIG_FILE}.tmp" tfplan

if [[ ${DESTROY_STATUS} -ne 0 ]]; then
  echo ""
  echo "!! terraform destroy exited non-zero (status ${DESTROY_STATUS})."
  echo "!! Check 'terraform show' and the Azure portal directly to confirm"
  echo "!! nothing was left running before assuming cost has stopped."
  exit "${DESTROY_STATUS}"
fi

echo "Environment torn down. Session files removed."
