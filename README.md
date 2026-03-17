# ResourcePulse — Bicep IaC Reviewer

A GitHub Action that analyzes Azure Bicep files in pull requests, providing cost impact estimates and best-practice findings — no signup required.

[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat&logo=github-actions&logoColor=white)](https://github.com/resourcepulse-io/azure-iac-reviewer)
[![License: BSL-1.1](https://img.shields.io/badge/License-BSL--1.1-blue.svg)](LICENSE)

---

## How it works

```
Pull request opened / updated
        │
        ▼
Changed .bicep files detected
        │
        ▼
Compiled → resources extracted → anonymized
        │
        ├─ api_key provided  ──────────────► Starter / Team backend path
        │
        └─ no api_key        ──────────────► GitHub OIDC token obtained
                                             └─► Preview backend path (free, no signup)
                                                        │
                                                        ▼
                                              Cost estimate posted as PR comment
```

ResourcePulse never sees your source code. Only anonymized resource metadata (type, SKU, region, change type) is transmitted.

---

## Plans

| | **Preview** | **Starter** | **Team** |
|--|------------|-------------|----------|
| Setup | No signup · uses OIDC | API key | API key |
| Price | Free | $29/mo | $79/mo |
| Cost estimates | ✓ | ✓ | ✓ |
| Ruleset findings | ✓ | ✓ | ✓ |
| SKU suggestions | — | ✓ | ✓ |
| Org policy | — | — | ✓ |
| Repos | 1 (rate-limited) | 3 | 10 |
| Analyses/month | 25 | 1,000 | 5,000 |

Get an API key at [resourcepulseapp.com](https://www.resourcepulseapp.com).

---

## Quick start

### Preview (free, no signup)

Add `id-token: write` permission — the action automatically requests a GitHub OIDC token and uses the preview backend path. No API key or account needed.

```yaml
name: IaC Review

on:
  pull_request:
    paths: ['**/*.bicep', '**/*.bicepparam']

permissions:
  contents: read
  pull-requests: write
  id-token: write          # required for preview OIDC auth

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: resourcepulse-io/azure-iac-reviewer@main
        with:
          param_file: infra/params/dev.bicepparam   # for region resolution
          comment_mode: update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Starter / Team (API key)

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@main
  with:
    api_key: ${{ secrets.RESOURCEPULSE_API_KEY }}
    param_file: infra/params/dev.bicepparam
    comment_mode: update
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Get an API key at [resourcepulseapp.com](https://www.resourcepulseapp.com).

---

## Demo

Example PR comment produced by the preview path (no API key, `param_file` provided):

---

**Region resolution**
Regions: westeurope
Param file: infra/params/dev.bicepparam

## ResourcePulse Report

### Cost Estimate

**Estimated Monthly Cost: $117.33**
**Coverage: 2 of 2 resources (100%)**

| Resource | Change | SKU | Monthly Cost |
|----------|--------|-----|--------------|
| Appservice | changed | B1 → P1v3 | +$116.80 |
| Storage | changed | Standard_LRS → Standard_GRS | +$0.53 |

### Findings

#### Warnings (2)
- **Missing environment tag** (2 resources): Resource is missing `environment` tag
  > Add `environment` tag (dev/staging/prod) for cost tracking

### Summary
0 critical · 2 warnings · Status: **warn**

---
<sub>Pricing: 20260207 | Ruleset: embedded-v1 | Policy: n/a | [ResourcePulse](https://www.resourcepulseapp.com)</sub>
<sub>Mode: Preview · [Sign up free →](https://www.resourcepulseapp.com)</sub>

---

## Supported resources

### Cost-estimated

These resources produce a monthly cost row in the PR comment.

| Resource | ARM type(s) |
|----------|-------------|
| Virtual Machines | `Microsoft.Compute/virtualMachines` · `Microsoft.Compute/virtualMachineScaleSets` |
| App Service | `Microsoft.Web/serverfarms` · `Microsoft.Web/sites` |
| Azure Kubernetes Service | `Microsoft.ContainerService/managedClusters` |
| Azure SQL Database | `Microsoft.Sql/servers/databases` |
| PostgreSQL Flexible Server | `Microsoft.DBforPostgreSQL/flexibleServers` · `Microsoft.DBforPostgreSQL/servers` |
| Azure Cache for Redis | `Microsoft.Cache/redis` |
| Storage Accounts | `Microsoft.Storage/storageAccounts` |
| Container Registry | `Microsoft.ContainerRegistry/registries` |
| Service Bus | `Microsoft.ServiceBus/namespaces` |
| API Management | `Microsoft.ApiManagement/service` |
| Key Vault | `Microsoft.KeyVault/vaults` |

> **PostgreSQL note** — only modern compute series are estimatable (Dadsv5, Ddsv5). Legacy Dsv3 SKUs (e.g. `Standard_D4s_v3`) show as "Coverage in progress".

### Consumption-based (no fixed cost)

Tracked in findings and rulesets, but cost estimation requires actual usage data.

| Resource | ARM type |
|----------|----------|
| Container Apps | `Microsoft.App/containerApps` |
| Azure Functions | `Microsoft.Web/sites` (kind: `functionapp`) |
| Cosmos DB | `Microsoft.DocumentDB/databaseAccounts` |
| Application Insights | `Microsoft.Insights/components` |

### Free / infrastructure-only

Tracked for ruleset findings (e.g. missing tags). No cost row produced.

| Resource | ARM type |
|----------|----------|
| Virtual Networks | `Microsoft.Network/virtualNetworks` |
| Network Security Groups | `Microsoft.Network/networkSecurityGroups` |

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api_key` | No | — | API key for Starter/Team plans. If omitted, the action uses preview mode via OIDC. |
| `param_file` | No | — | Path to a `.bicepparam` file. Required for region resolution and cost estimates. |
| `comment_mode` | No | `update` | `update` — edit existing comment in place. `new` — post a new comment each run. |
| `main_region` | No | — | Fallback region (e.g. `westeurope`) when no `param_file` is available. |
| `env` | No | — | Environment hint for policy selection (`dev`, `staging`, `prod`). |

## Outputs

| Output | Description |
|--------|-------------|
| `resources_detected` | Number of Azure resources detected in changed Bicep files. |
| `analysis_status` | `success`, `partial`, or `failed`. |

---

## Region resolution

Cost estimates require a region. Provide one of:

- **`param_file`** (recommended) — path to a `.bicepparam` file; the action parses `param location = '...'` automatically.
- **`main_region`** — explicit fallback region string.

Without either, cost rows will show:
> _Add `param_file` or `main_region` to your workflow for cost estimates_

---

## Privacy

**Transmitted (anonymized metadata only):**
- Resource types (`Microsoft.Storage/storageAccounts`)
- SKUs (`Standard_GRS`)
- Azure regions (`westeurope`)
- Resource counts and change types
- Tag **keys** only (values are stripped)

**Never transmitted:**
- Source code
- Resource names or IDs
- Tag values
- Secrets or connection strings
- Any personally identifiable information

---

## Required permissions

```yaml
permissions:
  contents: read        # read repo files and PR diff
  pull-requests: write  # post / update PR comment
  id-token: write       # preview OIDC auth (omit if using api_key)
```

---

## Troubleshooting

**No comment appears**
- Confirm the workflow triggers on `pull_request`
- Confirm `pull-requests: write` permission is set
- Confirm at least one `.bicep` file changed in the PR

**Cost shows "Add param_file..."**
- Add `param_file: path/to/your.bicepparam` to the action inputs
- Or add `main_region: westeurope`

**Backend returns 401**
- For preview: confirm `id-token: write` is in the workflow permissions
- For Starter/Team: verify the `api_key` secret is set correctly

**Compilation errors in comment**
- Fix the Bicep syntax errors shown; the action continues analyzing other valid files

---

## License

Business Source License 1.1 — see [LICENSE](LICENSE) for details. Converts to Apache 2.0 on 2031-01-28.

## Support

- [Report an issue](https://github.com/resourcepulse-io/azure-iac-reviewer/issues)
- [resourcepulseapp.com](https://www.resourcepulseapp.com)
