#Bicep Azure IaC Reviewer

A GitHub Action that analyzes Azure Bicep files in pull requests, providing cost insights and best practice recommendations while maintaining strict privacy standards.

[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat&logo=github-actions&logoColor=white)](https://github.com/resourcepulse-io/azure-iac-reviewer)
[![License: BSL-1.1](https://img.shields.io/badge/License-BSL--1.1-blue.svg)](LICENSE)

## Features

- **Automated Bicep Analysis**: Automatically detects and analyzes changed `.bicep` files in pull requests
- **Cost Insights**: Provides estimated cost impact of infrastructure changes
- **Best Practices**: Recommends Azure best practices and optimization opportunities
- **Privacy-First Design**: Only anonymized metadata is transmitted - no resource names, IDs, or sensitive data
- **Offline Mode**: Works without API key using local analysis fallback
- **Smart Comments**: Updates existing PR comments to avoid spam

## Privacy Guarantees

This action is designed with privacy as a core principle:

**What is NOT collected or transmitted:**
- Source code contents
- Resource names or identifiers
- Tag values
- Connection strings or secrets
- Resource IDs or GUIDs
- Any personally identifiable information

**What IS collected (anonymized metadata only):**
- Resource types (e.g., `Microsoft.Compute/virtualMachines`)
- SKUs (e.g., `Standard_D2s_v3`)
- Azure regions (e.g., `eastus`)
- Resource counts
- Change types (added, modified, removed)

This makes the action safe to use on private repositories with sensitive infrastructure configurations.

## Installation

### Prerequisites

- GitHub Actions workflow with `pull_request` trigger
- Repository with Azure Bicep files (`.bicep`)

### Basic Setup

Add the following permissions to your workflow:

```yaml
permissions:
  contents: read
  pull-requests: write
```

Then use the action in your workflow:

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
```

### Full Example

Create `.github/workflows/bicep-review.yml`:

```yaml
name: Bicep Review

on:
  pull_request:
    branches: [ main, develop ]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: resourcepulse-io/azure-iac-reviewer@v1
        with:
          # Optional: Provide API key for enhanced analysis
          api_key: ${{ secrets.AZURE_IAC_REVIEWER_API_KEY }}

          # Optional: Comment mode (update existing or create new)
          # comment_mode: 'update'
```

## Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api_key` | No | _(empty)_ | API key for the Azure IaC Reviewer backend service. If not provided, the action uses local analysis. |
| `server_address` | No | `https://api.resourcepulse.io` | Backend API endpoint URL. |
| `comment_mode` | No | `update` | Comment behavior: `update` to update existing PR comment, `new` to create a new comment each time. |

## Action Outputs

| Output | Description |
|--------|-------------|
| `resources_detected` | Number of Azure resources detected in changed Bicep files |
| `analysis_status` | Status of the analysis: `success`, `partial`, or `failed` |

## How It Works

1. **Detects Changes**: Identifies all modified `.bicep` files in the pull request
2. **Compiles Bicep**: Uses the official Bicep CLI to compile files to ARM JSON
3. **Extracts Metadata**: Parses resource definitions from compiled ARM templates
4. **Sanitizes Data**: Removes all identifying information, retaining only anonymized metadata
5. **Analyzes**: Sends sanitized metadata to backend (if API key provided) or performs local analysis
6. **Posts Results**: Creates or updates a PR comment with findings and recommendations

## Usage Examples

### Without API Key (Local Analysis)

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
```

The action will analyze Bicep files and provide basic insights without connecting to the backend service.

### With API Key (Enhanced Analysis)

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
  with:
    api_key: ${{ secrets.AZURE_IAC_REVIEWER_API_KEY }}
```

Store your API key as a repository secret and reference it securely. Enhanced analysis provides:
- Detailed cost estimates
- Advanced optimization recommendations
- Security best practice suggestions

### Custom Comment Behavior

```yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
  with:
    comment_mode: 'new'
```

Creates a new comment for each workflow run instead of updating the existing one.

## Troubleshooting

### No comment appears on PR

**Possible causes:**
- No `.bicep` files were changed in the PR
- Missing `pull-requests: write` permission
- Action running on `push` event instead of `pull_request`

**Solution:** Ensure workflow has proper permissions and triggers on `pull_request` events.

### Compilation errors in PR comment

**What it means:** One or more Bicep files have syntax errors or invalid references.

**Solution:** Review the compilation error details in the PR comment and fix the Bicep syntax. The action will continue analyzing other valid files.

### "Analysis failed" status

**Possible causes:**
- Backend service is unavailable (if using API key)
- Network connectivity issues
- Invalid API key

**Solution:**
- Check backend service status
- Verify API key is correct
- The action will fall back to local analysis if backend is unavailable

### Action fails with "Bicep CLI not found"

**What it means:** Unable to download or cache the Bicep CLI binary.

**Solution:** Ensure the runner has internet access and sufficient disk space in `RUNNER_TEMP`.

## Required Permissions

The action requires the following GitHub token permissions:

```yaml
permissions:
  contents: read        # Read repository files and PR context
  pull-requests: write  # Create/update PR comments
```

These are the minimum required permissions. The action does not require:
- `checks: write` (optional, for future check run feature)
- `issues: write`
- Repository write access

## Security

This action is designed with security and privacy as top priorities. For detailed information about:
- What data is collected
- How data is handled
- Reporting security vulnerabilities

Please see [SECURITY.md](SECURITY.md).

### Building from Source

```bash
npm install
npm run build
npm test
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:unit     # Unit tests only
```

## License

Business Source License 1.1 - see [LICENSE](LICENSE) for details.

This software converts to Apache 2.0 on 2031-01-28.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

- [Report Issues](https://github.com/resourcepulse-io/azure-iac-reviewer/issues)
- [Documentation](https://github.com/resourcepulse-io/azure-iac-reviewer/tree/main/docs)
- [Example Workflows](docs/examples/)

## Acknowledgments

Built with:
- [Azure Bicep](https://github.com/Azure/bicep) - Official Azure IaC language
- [GitHub Actions Toolkit](https://github.com/actions/toolkit) - GitHub Actions development framework
