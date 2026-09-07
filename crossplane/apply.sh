#!/usr/bin/env bash
#
# apply.sh - install Crossplane core + this repo's providers/XRD/Composition
# onto the AKS cluster terraform/foundation's tfup.sh already stood up.
#
# Requires: tfup.sh has already been run this session (so
# terraform/foundation/.session-outputs.env and .kubeconfig exist), and
# KUBECONFIG is pointed at that file.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_DIR="${SCRIPT_DIR}/../terraform/foundation"
SESSION_OUTPUTS="${FOUNDATION_DIR}/.session-outputs.env"

if [[ ! -f "${SESSION_OUTPUTS}" ]]; then
  echo "!! ${SESSION_OUTPUTS} not found - run terraform/foundation/tfup.sh first."
  exit 1
fi

# shellcheck disable=SC1090
source "${SESSION_OUTPUTS}"

for var in AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID WORKLOAD_RESOURCE_GROUP; do
  if [[ -z "${!var:-}" ]]; then
    echo "!! ${var} missing from ${SESSION_OUTPUTS} - re-run tfup.sh."
    exit 1
  fi
done

if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "!! kubectl can't reach a cluster - is KUBECONFIG set to ${FOUNDATION_DIR}/.kubeconfig?"
  exit 1
fi

echo "==> Installing Crossplane core via Helm"
helm repo add crossplane-stable https://charts.crossplane.io/stable >/dev/null
helm repo update >/dev/null
helm upgrade --install crossplane crossplane-stable/crossplane \
  --namespace crossplane-system --create-namespace \
  --wait || { echo "!! Crossplane Helm install failed"; exit 1; }

# envsubst fills in ${AZURE_CLIENT_ID} / ${AZURE_TENANT_ID} /
# ${AZURE_SUBSCRIPTION_ID} / ${WORKLOAD_RESOURCE_GROUP} from the sourced
# session-outputs.env above. Only substitute the vars we expect, so a
# stray literal "${...}" elsewhere in a manifest isn't silently blanked out.
render() {
  envsubst '${AZURE_CLIENT_ID} ${AZURE_TENANT_ID} ${AZURE_SUBSCRIPTION_ID} ${WORKLOAD_RESOURCE_GROUP}' < "$1"
}

echo "==> Applying workload identity (ImageConfig + DeploymentRuntimeConfig)"
render "${SCRIPT_DIR}/install/01-workload-identity.yaml" | kubectl apply -f - || exit 1

echo "==> Installing providers + function"
kubectl apply -f "${SCRIPT_DIR}/install/02-providers.yaml" || exit 1

echo "==> Waiting for provider-azure-storage to become healthy (this also pulls in provider-family-azure)"
kubectl wait provider.pkg.crossplane.io/provider-azure-storage \
  --for=condition=Healthy --timeout=180s || {
    echo "!! Provider didn't report healthy in time - check: kubectl get providers,functions"
    exit 1
  }

echo "==> Applying ProviderConfig"
render "${SCRIPT_DIR}/install/03-provider-config.yaml" | kubectl apply -f - || exit 1

echo "==> Applying XRD + Composition"
kubectl apply -f "${SCRIPT_DIR}/xrd/definition.yaml" || exit 1
render "${SCRIPT_DIR}/xrd/composition.yaml" | kubectl apply -f - || exit 1

echo ""
echo "Done. Try it, e.g.:"
echo "  kubectl create namespace demo"
echo "  cat <<EOF | kubectl apply -f -"
echo "  apiVersion: storage.idp-demo.io/v1alpha1"
echo "  kind: XStorageAccount"
echo "  metadata:"
echo "    name: my-test-storage"
echo "    namespace: demo"
echo "  spec:"
echo "    name: idpdemostorage$RANDOM"
echo "  EOF"
