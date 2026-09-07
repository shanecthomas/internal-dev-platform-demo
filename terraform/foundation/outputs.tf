output "kube_config_raw" {
  description = "kubeconfig for the demo AKS cluster. Feed to `kubectl` and Backstage's kubernetes:apply action."
  value       = azurerm_kubernetes_cluster.demo.kube_config_raw
  sensitive   = true
}

output "oidc_issuer_url" {
  description = "OIDC issuer URL for the AKS cluster - not usually needed manually, but useful for debugging federation issues."
  value       = azurerm_kubernetes_cluster.demo.oidc_issuer_url
}

output "crossplane_client_id" {
  description = "Azure AD application (client) ID - goes into the Crossplane ProviderConfig's `identity.clientID` field."
  value       = azuread_application.crossplane.client_id
}

output "tenant_id" {
  description = "Azure AD tenant ID - also required in the Crossplane ProviderConfig."
  value       = data.azurerm_client_config.current.tenant_id
}

data "azurerm_client_config" "current" {}

output "workload_resource_group_name" {
  description = "The single resource group Crossplane is permitted to provision Storage Accounts into."
  value       = azurerm_resource_group.workloads.name
}

output "subscription_id" {
  description = "Azure subscription ID - goes into the Crossplane ProviderConfig alongside clientID/tenantID."
  value       = data.azurerm_client_config.current.subscription_id
}
