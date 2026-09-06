variable "subscription_id" {
  description = "Azure subscription ID to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "westus2"
}

variable "cluster_name" {
  description = "Name of the ephemeral AKS cluster running Crossplane + Backstage."
  type        = string
  default     = "idp-demo-aks"
}

variable "crossplane_namespace" {
  description = "Kubernetes namespace Crossplane's provider pod runs in."
  type        = string
  default     = "crossplane-system"
}

variable "crossplane_service_account_name" {
  description = "Kubernetes ServiceAccount used by the Azure family provider's pod (workload identity subject)."
  type        = string
  default     = "provider-family-azure"
}

variable "workload_resource_group_name" {
  description = <<-EOT
    Name of the single pre-created resource group that Crossplane is allowed to provision
    Storage Accounts into. This is the ONLY scope the Crossplane service principal can touch -
    it is deliberately not granted subscription-wide Contributor.
  EOT
  type        = string
  default     = "idp-demo-workloads-rg"
}
