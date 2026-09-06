# --- Control-plane cluster -----------------------------------------------
# This AKS cluster exists to run Crossplane (and Backstage) for the demo.
# It is NOT where the provisioned workloads live - Crossplane reaches out
# to Azure to create real resources in workload_resource_group below.
# Node pool is intentionally tiny; nothing compute-heavy runs here.

resource "azurerm_resource_group" "platform" {
  name     = "${var.cluster_name}-rg"
  location = var.location
}

resource "azurerm_kubernetes_cluster" "demo" {
  name                = var.cluster_name
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  dns_prefix          = var.cluster_name

  # These two flags are what expose a public OIDC issuer URL for the
  # cluster and let pods request Azure AD tokens via a projected service
  # account token - this is what makes federated (passwordless) auth
  # possible. Without both, there's no OIDC endpoint for Azure to trust.
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  default_node_pool {
    name       = "system"
    node_count = 1
    vm_size    = "Standard_D2s_v3"
  }

  identity {
    type = "SystemAssigned"
  }
}

# --- Scoped workload resource group ----------------------------------------
# The ONLY resource group Crossplane's service principal can touch.
# Storage Accounts provisioned via Backstage claims land in here.

resource "azurerm_resource_group" "workloads" {
  name     = var.workload_resource_group_name
  location = var.location
}

# --- Azure AD app + federated credential (workload identity) --------------
# No client secret anywhere: Azure AD trusts tokens issued by the AKS
# cluster's OIDC issuer for this specific namespace/service account pair.

resource "azuread_application" "crossplane" {
  display_name = "${var.cluster_name}-crossplane"
}

resource "azuread_service_principal" "crossplane" {
  client_id = azuread_application.crossplane.client_id
}

resource "azuread_application_federated_identity_credential" "crossplane" {
  application_id = azuread_application.crossplane.id
  display_name   = "aks-workload-identity"
  description    = "Trusts tokens for the Crossplane provider ServiceAccount running on ${var.cluster_name}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = azurerm_kubernetes_cluster.demo.oidc_issuer_url
  subject        = "system:serviceaccount:${var.crossplane_namespace}:${var.crossplane_service_account_name}"
}

# --- Least-privilege role assignment ---------------------------------------
# Contributor scoped to ONLY the workloads resource group - not the
# subscription. Crossplane cannot create or touch anything outside it.

resource "azurerm_role_assignment" "crossplane_workloads_contributor" {
  scope                = azurerm_resource_group.workloads.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.crossplane.object_id
}
