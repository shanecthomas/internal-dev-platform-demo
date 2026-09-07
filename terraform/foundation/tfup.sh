#!/usr/bin/env bash
#
# tfup.sh - stand up the ephemeral AKS + OIDC foundation for a work session.
#
# On ANY failure below - init, plan, apply, or even a failed read of one of
# the outputs afterward - this tears the environment back down via tfdown.sh.
# There should never be a half-created, orphaned AKS cluster (and therefore
# accruing cost) left behind after a bad run.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/.session-outputs.env"
KUBECONFIG_FILE="${SCRIPT_DIR}/.kubeconfig"

cd "${SCRIPT_DIR}"

fail_and_teardown() {
  echo ""
  echo "!! $1"
  echo "!! Tearing down via tfdown.sh to avoid leaving orphaned/partial infra..."
  "${SCRIPT_DIR}/tfdown.sh" --auto-approve
  exit 1
}

# Reads a single terraform output and appends VAR_NAME=value to $dest.
# Exits (via teardown) if the read fails, rather than writing a blank value.
get_and_write() {
  local var_name="$1" output_name="$2" dest="$3"
  local val
  if ! val="$(terraform output -raw "${output_name}" 2>&1)"; then
    fail_and_teardown "Failed to read terraform output '${output_name}': ${val}"
  fi
  printf '%s=%s\n' "${var_name}" "${val}" >> "${dest}"
}

if [[ -z "${TF_VAR_subscription_id:-}" ]]; then
  echo "TF_VAR_subscription_id is not set."
  read -r -p "Enter your Azure subscription ID: " sub_id
  export TF_VAR_subscription_id="${sub_id}"
fi

echo "==> terraform init"
terraform init -input=false || fail_and_teardown "terraform init failed"

echo "==> terraform plan -out=tfplan"
terraform plan -out=tfplan -input=false || fail_and_teardown "terraform plan failed"

echo ""
# -t 60 times out and falls through to apply; Ctrl+C exits the script
# outright (nothing has been created yet, so no teardown needed for that).
read -t 60 -p "Press Enter to apply this plan, or Ctrl+C to cancel. Auto-applying in 60s...: " _user_input || echo ""

echo "==> terraform apply tfplan"
terraform apply -input=false "tfplan" || fail_and_teardown "terraform apply failed"
rm -f tfplan

echo "==> Capturing session outputs"
: > "${OUTPUT_FILE}.tmp"
get_and_write AZURE_CLIENT_ID      crossplane_client_id          "${OUTPUT_FILE}.tmp"
get_and_write AZURE_TENANT_ID      tenant_id                     "${OUTPUT_FILE}.tmp"
get_and_write WORKLOAD_RESOURCE_GROUP workload_resource_group_name "${OUTPUT_FILE}.tmp"
get_and_write OIDC_ISSUER_URL      oidc_issuer_url               "${OUTPUT_FILE}.tmp"
get_and_write AZURE_SUBSCRIPTION_ID subscription_id               "${OUTPUT_FILE}.tmp"
mv "${OUTPUT_FILE}.tmp" "${OUTPUT_FILE}"

echo "==> Capturing kubeconfig"
if ! terraform output -raw kube_config_raw > "${KUBECONFIG_FILE}.tmp" 2>/tmp/tfup_sh_kubeconfig_err; then
  fail_and_teardown "Failed to read kubeconfig output: $(cat /tmp/tfup_sh_kubeconfig_err 2>/dev/null)"
fi
mv "${KUBECONFIG_FILE}.tmp" "${KUBECONFIG_FILE}"
chmod 600 "${KUBECONFIG_FILE}"

echo ""
echo "Environment is up."
echo "  Session values written to: ${OUTPUT_FILE}"
echo "  Kubeconfig written to:     ${KUBECONFIG_FILE}"
echo ""
echo "  export KUBECONFIG=${KUBECONFIG_FILE}"
echo ""
echo "When you're done working, run ./tfdown.sh to tear everything down."
