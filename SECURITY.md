# Security Policy

## Privacy and Data Handling

Azure IaC Reviewer is built with privacy as a fundamental design principle. This document explains what data is collected, how it is handled, and our commitment to protecting your infrastructure information.

## Data Collection and Privacy

### What We DO NOT Collect

The following data is **NEVER** collected, transmitted, or stored:

- **Source Code**: Your Bicep files and infrastructure code remain completely private
- **Resource Names**: Names you assign to resources (e.g., `my-production-vm`)
- **Resource Identifiers**: Azure resource IDs, GUIDs, or subscription IDs
- **Tag Values**: Custom tags and their values
- **Connection Strings**: Database connections, storage keys, or any credentials
- **Secrets**: Environment variables, passwords, or sensitive configuration
- **IP Addresses**: Public or private IP addresses configured in resources
- **Domain Names**: Custom domains or DNS entries
- **Personally Identifiable Information (PII)**: Any data that could identify individuals or organizations

### What We DO Collect (Anonymized Metadata Only)

When using the backend service (with API key or OIDC preview mode), the following metadata is transmitted:

- **Repository identifier**: Owner and repository name (e.g., `myorg/myrepo`) — used for authentication, repo binding, and rate limiting
- **PR number and commit SHA**: Used to correlate the analysis with the pull request
- **Resource Types**: The Azure resource type (e.g., `Microsoft.Compute/virtualMachines`)
- **SKUs**: Resource sizing information (e.g., `Standard_D2s_v3`)
- **Azure Regions**: Deployment locations (e.g., `eastus`, `westeurope`)
- **Resource Counts**: Number of resources by type
- **Change Types**: Whether resources were added, modified, or removed in the PR
- **Tag keys only**: Tag names without their values (e.g., `environment` but not `production`)

Resource metadata is:
- Anonymized — resource names, IDs, and identifiers are stripped before transmission
- Cannot be traced back to specific Azure resources
- Safe for use in regulated environments

### Example: What Gets Sent vs. What Stays Private

**Your Bicep File (PRIVATE - never transmitted):**
```bicep
resource productionDatabase 'Microsoft.Sql/servers/databases@2021-11-01' = {
  name: 'company-prod-db-001'
  location: 'eastus'
  sku: {
    name: 'S3'
    tier: 'Standard'
  }
  tags: {
    environment: 'production'
    costCenter: '12345'
    owner: 'jane.doe@company.com'
  }
}
```

**Anonymized Metadata Sent to Backend (if API key provided):**
```json
{
  "resources": [
    {
      "type": "Microsoft.Sql/servers/databases",
      "kind": "sql_db",
      "sku": "S3",
      "region": "eastus",
      "count": 1,
      "changeType": "added"
    }
  ]
}
```

Notice that all identifying information (name, tags, specific identifiers) is stripped before transmission.

## Privacy Enforcement

### Technical Safeguards

1. **Sanitization Layer**: All data passes through `src/iac/sanitize.ts` before any external transmission
2. **Automated Testing**: Unit tests verify that forbidden data types are never included in payloads
3. **No Source Code Access**: The backend never receives Bicep source code or ARM templates
4. **Local Fallback**: The action works completely offline without any API key

### Audit Trail

All data sanitization is:
- Deterministic and testable
- Logged in GitHub Actions workflow logs (visible to repository administrators)
- Open source and auditable in this repository

## Offline Mode

The action can operate entirely without connecting to any external service:

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
  # No api_key = no external communication
```

In offline mode:
- No data leaves your GitHub Actions runner
- All analysis is performed locally
- Basic insights are provided without backend integration

This mode is ideal for:
- Highly regulated environments
- Air-gapped deployments
- Maximum privacy requirements

## Backend Communication

When an API key is provided, the action communicates with the backend service over HTTPS:

- **Endpoint**: `https://api.resourcepulse.io` (configurable)
- **Protocol**: TLS 1.2+ encrypted
- **Authentication**: API key via HTTP header
- **Payload**: Only anonymized metadata (see above)
- **Retry Policy**: Graceful fallback to local analysis if backend is unavailable

### Backend Service Privacy Commitment

The ResourcePulse backend service:
- Does not log or store resource identifiers
- Processes requests in memory
- Does not share raw request data with third parties

### AI-Assisted Features (Starter/Team Plans)

On paid plans, SKU alternative suggestions include AI-generated descriptions to help explain the
trade-offs between SKUs. This feature uses Azure OpenAI (GPT-5-mini) during a daily pricing
refresh cycle — not at request time. Only generic SKU names and Azure service names are sent to
the AI model; no customer data, repository names, or resource identifiers are included.

AI-generated content is clearly marked in PR comments with a note:
> Suggestions are AI-generated and may not be accurate. Always verify before applying changes.

## Reporting Security Vulnerabilities

We take security seriously and appreciate your efforts to responsibly disclose findings.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please email security reports to:

**security@resourcepulse.io**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if available)

### What to Expect

- **Acknowledgment**: Within 24 hours
- **Initial Assessment**: Within 72 hours
- **Resolution Timeline**: Depends on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 90 days

### Bug Bounty

We currently do not offer a formal bug bounty program, but we acknowledge security researchers in our release notes and documentation (with permission).

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes    |
| < 1.0   | ❌ No     |

We recommend always using the latest v1 release:

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
```

## Security Best Practices

### API Key Management

If using the backend service:

1. **Store API keys as GitHub Secrets**:
   ```yaml
   api_key: ${{ secrets.AZURE_IAC_REVIEWER_API_KEY }}
   ```

2. **Never commit API keys to repository**
3. **Rotate API keys periodically** (every 90 days recommended)
4. **Use separate keys per environment** (production, staging, development)

### Workflow Permissions

Use the principle of least privilege:

```yaml
permissions:
  contents: read        # Minimum required
  pull-requests: write  # For PR comments only
```

Do not grant:
- `contents: write`
- `actions: write`
- `repository-administration: write`

### Repository Security

1. **Enable branch protection** on main branches
2. **Require pull request reviews** before merging
3. **Enable GitHub secret scanning**
4. **Use Dependabot** for dependency updates

## Compliance

- **GDPR**: No personal data is collected from Bicep files. Repository identifiers transmitted for authentication are processed under legitimate interest (service delivery). See our [Privacy Policy](https://www.resourcepulseapp.com/ResourcePulse_Privacy_Policy.pdf) for details.
- **No PHI or cardholder data**: The action never transmits health information, payment card data, or other regulated content — only infrastructure metadata.

## Data Retention

- **GitHub Actions Logs**: Retained per your GitHub organization settings
- **Backend Service**: Analysis requests are processed in memory and not persisted. Structured logs (containing repository name, PR number, and analysis status) are retained in Application Insights for 90 days for operational monitoring.
- **PR Comments**: Visible in pull requests until deleted by repository administrators

## Third-Party Services

This action uses the following third-party services:

1. **Bicep CLI**: Downloaded directly from Microsoft's official releases (verified checksums)
2. **GitHub API**: For PR context and comment posting (OAuth via GITHUB_TOKEN)
3. **ResourcePulse Backend** (optional): Hosted on Azure Container Apps. Only contacted when an API key is provided or OIDC preview mode is used.
4. **Azure OpenAI** (indirect): Used during daily pricing refresh to generate SKU descriptions. No customer data is sent — only generic Azure SKU and service names. Not called at analysis request time.
5. **Paddle** (indirect): Payment processing for paid plans. Paddle acts as Merchant of Record. See [Paddle's privacy policy](https://www.paddle.com/legal/privacy).

Code dependencies are:
- Pinned to specific versions
- Scanned for vulnerabilities via Dependabot
- Reviewed before updates

## Open Source Transparency

This action is 100% open source:
- **Code**: Public GitHub repository
- **Dependencies**: Documented in `package.json`
- **Build Process**: Reproducible via `npm run build`
- **Tests**: Full test suite in `__tests__/`

You can audit the entire codebase to verify our privacy and security claims.

## Contact

For security concerns: **security@resourcepulse.io**

For general questions: [GitHub Discussions](https://github.com/resourcepulse-io/azure-iac-reviewer/discussions)

## Updates to This Policy

This security policy may be updated periodically. Significant changes will be:
- Announced in release notes
- Communicated via GitHub Security Advisories
- Versioned in this repository

Last updated: 2026-04-08
