import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as log from './utils/log';
import { initializeGitHub } from './github/context';
import { listBicepFilesWithStatus, BicepFileWithStatus, getBaseFileContent, getBaseModuleFiles } from './github/prFiles';
import { parseBicepParamFile } from './iac/bicepParams';
import type { BicepParamValue } from './iac/bicepParams';
import type { ResourceMetadata } from './iac/armExtract';
import type { BackendCallContext } from './backend/client';
import type { ResourceWithChange } from './iac/sanitize';

/**
 * Filter out module files when a parent .bicep file is also being compiled.
 * Bicep compiles recursively, so the parent's ARM output already contains all
 * module resources. Compiling both parent and module produces duplicate entries.
 * Only skip a module if a root-level file in the same tree is also changing —
 * if only the module changed (no parent in the PR), compile it directly.
 * @param files - List of changed .bicep files with status
 * @returns Filtered list with redundant module files removed
 */
function deduplicateModuleFiles(files: BicepFileWithStatus[]): BicepFileWithStatus[] {
  // Collect the directory of each non-module .bicep file (root-level files)
  const rootFileDirs = new Set<string>(
    files
      .filter(f => !f.filename.split('/').includes('modules'))
      .map(f => {
        const lastSlash = f.filename.lastIndexOf('/');
        return lastSlash >= 0 ? f.filename.substring(0, lastSlash) : '';
      })
  );

  return files.filter(f => {
    const parts = f.filename.split('/');
    const modulesIdx = parts.indexOf('modules');
    if (modulesIdx === -1) return true; // not inside a modules/ dir — always include

    // Parent dir is everything before the 'modules/' segment
    const parentDir = parts.slice(0, modulesIdx).join('/');
    if (rootFileDirs.has(parentDir)) {
      // A root file in the same tree is also being compiled — skip this module
      // (the root compilation will resolve it)
      return false;
    }
    return true; // no parent being compiled — include so the change is captured
  });
}

/**
 * Main entry point for the Azure IaC Reviewer GitHub Action
 */
async function run(): Promise<void> {
  try {
    log.info('Azure IaC Reviewer started');

    // Initialize GitHub context and Octokit client
    const [prContext, octokit] = initializeGitHub();

    log.info(
      `Processing PR #${prContext.prNumber} in ${prContext.owner}/${prContext.repo}`
    );

    // List and filter .bicep files with change status
    const bicepFilesWithStatus = await listBicepFilesWithStatus(octokit, prContext);

    // Exit successfully if no .bicep files found (no comment spam)
    if (bicepFilesWithStatus.length === 0) {
      log.info('No .bicep files to analyze. Exiting successfully.');
      return;
    }

    // Remove module files that will be covered by a parent compilation to avoid duplicates
    const dedupedBicepFiles = deduplicateModuleFiles(bicepFilesWithStatus);
    if (dedupedBicepFiles.length < bicepFilesWithStatus.length) {
      const skipped = bicepFilesWithStatus.length - dedupedBicepFiles.length;
      log.info(`Skipped ${skipped} module file(s) — covered by parent compilation`);
    }

    log.info(`Found ${dedupedBicepFiles.length} .bicep file(s) to analyze`);

    // Resolve workspace root for absolute path resolution
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();

    // Resolve workspace-relative paths from GitHub API to absolute paths
    const bicepFiles = dedupedBicepFiles.map((f) =>
      path.resolve(workspaceRoot, f.filename)
    );

    // Create a map of absolute path to change type for later use
    const fileChangeMap = new Map<string, BicepFileWithStatus['change']>();
    for (const file of dedupedBicepFiles) {
      fileChangeMap.set(path.resolve(workspaceRoot, file.filename), file.change);
    }

    // Download and cache Bicep CLI
    const { ensureBicepCli, compileBicepFiles, formatCompilationErrors } =
      await import('./iac/bicep');
    const bicepCliPath = await ensureBicepCli();

    // Compile all .bicep files
    const compilationResults = await compileBicepFiles(bicepCliPath, bicepFiles);

    // Check for compilation errors
    const compilationErrors = formatCompilationErrors(compilationResults);
    if (compilationErrors) {
      // Post compilation errors to PR
      const { createOrUpdateComment } = await import('./github/comments');
      await createOrUpdateComment(octokit, prContext, compilationErrors);

      log.warning('Some Bicep files failed to compile, but continuing analysis');
    }

    // Filter successful compilations for further processing
    const successfulCompilations = compilationResults.filter((r) => r.success);

    if (successfulCompilations.length === 0) {
      log.warning('No Bicep files compiled successfully. Analysis cannot proceed.');
      return;
    }

    log.info(
      `${successfulCompilations.length} file(s) compiled successfully, proceeding with analysis`
    );

    // Extract resource metadata from ARM templates with change tracking
    const { extractResourceMetadata } = await import('./iac/armExtract');
    const { diffResources } = await import('./iac/resourceDiff');
    const { compileBicepContent } = await import('./iac/bicep');
    const resourcesWithChange: ResourceWithChange[] = [];
    const paramFileInput = core.getInput('param_file').trim();
    const mainRegionInput = core.getInput('main_region').trim();
    let paramFileValues: Record<string, BicepParamValue> | undefined;
    let enableRegionResolution = paramFileInput.length > 0;
    const resolvedRegions = new Set<string>();
    const unresolvedLocations = new Set<string>();
    const paramFileUsed = enableRegionResolution ? paramFileInput : undefined;

    if (enableRegionResolution) {
      const resolvedParamFilePath = path.resolve(workspaceRoot, paramFileInput);
      const workspaceResolved = path.resolve(workspaceRoot);
      if (
        resolvedParamFilePath !== workspaceResolved &&
        !resolvedParamFilePath.startsWith(`${workspaceResolved}${path.sep}`)
      ) {
        throw new Error(
          `Invalid param_file path: ${paramFileInput} (must be within the repository)`
        );
      }
      if (!fs.existsSync(resolvedParamFilePath)) {
        throw new Error(
          `param_file not found: ${paramFileInput} (resolved to ${resolvedParamFilePath})`
        );
      }
      if (!fs.statSync(resolvedParamFilePath).isFile()) {
        throw new Error(
          `param_file is not a file: ${paramFileInput} (resolved to ${resolvedParamFilePath})`
        );
      }
      log.info(`Using param file: ${paramFileInput}`);
      const paramFileContents = fs.readFileSync(resolvedParamFilePath, 'utf8');
      const parseResult = parseBicepParamFile(paramFileContents);
      if (parseResult.errors.length > 0) {
        log.warning(`Param file parse issues: ${parseResult.errors.join('; ')}`);
      }
      paramFileValues = parseResult.params;
      log.info(
        `Parsed ${Object.keys(parseResult.params).length} param value(s) from ${paramFileInput}`
      );
    } else if (mainRegionInput) {
      // Fallback: use main_region as the location value for region resolution
      enableRegionResolution = true;
      paramFileValues = { location: mainRegionInput };
      log.info(`No param_file provided; using main_region fallback: ${mainRegionInput}`);
    } else {
      log.info('No param_file or main_region provided; skipping region resolution.');
    }

    for (const compilation of successfulCompilations) {
      try {
        // Get the change type for this file
        const fileChange = fileChangeMap.get(compilation.filePath) || 'modified';

        // Convert ARM template object back to JSON string for extraction
        const armJson = JSON.stringify(compilation.armTemplate);
        const headExtraction = extractResourceMetadata(armJson, {
          paramValues: paramFileValues,
          enableRegionResolution,
        });
        for (const region of headExtraction.resolvedRegions) {
          resolvedRegions.add(region);
        }
        for (const token of headExtraction.unresolvedLocations) {
          unresolvedLocations.add(token);
        }

        if (fileChange === 'added') {
          // New file - all resources are added
          for (const resource of headExtraction.resources) {
            resourcesWithChange.push({ resource, change: 'added' });
          }
          log.debug(
            `Extracted ${headExtraction.resourceCount} added resource(s) from ${compilation.filePath}`
          );
        } else if (fileChange === 'removed') {
          // Deleted file - all resources are removed
          for (const resource of headExtraction.resources) {
            resourcesWithChange.push({ resource, change: 'removed' });
          }
          log.debug(
            `Extracted ${headExtraction.resourceCount} removed resource(s) from ${compilation.filePath}`
          );
        } else {
          // Modified file - need to diff against base branch version
          log.info(`Performing resource-level diff for modified file: ${compilation.filePath}`);

          // Convert absolute path back to repo-relative path for GitHub API
          const repoRelativePath = path.relative(workspaceRoot, compilation.filePath).replace(/\\/g, '/');
          const baseContent = await getBaseFileContent(octokit, prContext, repoRelativePath);

          if (baseContent) {
            // Fetch base-branch modules so module references in old file versions
            // resolve against base modules, not head-branch modules in the workspace.
            const repoRelativeModulesDir = `${path.dirname(repoRelativePath).replace(/\\/g, '/')}/modules`;
            const baseModuleFiles = await getBaseModuleFiles(octokit, prContext, repoRelativeModulesDir);

            // Compile base version
            const baseCompilation = await compileBicepContent(
              bicepCliPath,
              baseContent,
              compilation.filePath,
              baseModuleFiles
            );

            if (baseCompilation.success && baseCompilation.armTemplate) {
              // Extract resources from base
              const baseArmJson = JSON.stringify(baseCompilation.armTemplate);
              const baseExtraction = extractResourceMetadata(baseArmJson, {
                paramValues: paramFileValues,
                enableRegionResolution,
              });

              // Diff resources between base and head
              const diffResult = diffResources(baseExtraction.resources, headExtraction.resources);

              log.info(
                `Resource diff for ${compilation.filePath}: +${diffResult.added} added, -${diffResult.removed} removed, ~${diffResult.modified} modified, ${diffResult.unchanged} unchanged`
              );

              // Add diffed resources with appropriate change types
              for (const diff of diffResult.diffs) {
                // For removed resources there is no "new" state — use old values so the
                // API can look up the price (ProcessResources applies a -1 cost sign).
                const isRemoved = diff.change === 'removed';
                const resource: ResourceMetadata = {
                  type: diff.type,
                  kind: diff.kind,
                  sku: isRemoved ? diff.oldSku : diff.newSku,
                  tier: diff.tier,
                  shardCount: isRemoved ? diff.oldShardCount : diff.newShardCount,
                  region: isRemoved ? diff.oldRegion : diff.newRegion,
                  properties: diff.properties,
                  tags: diff.tags,
                  osType: isRemoved ? diff.oldOsType : diff.osType,
                  highAvailability: isRemoved ? diff.oldHighAvailability : diff.highAvailability,
                  licenseType: isRemoved ? diff.oldLicenseType : diff.licenseType,
                  messagingUnits: isRemoved ? diff.oldMessagingUnits : diff.messagingUnits,
                  capacityUnits: isRemoved ? diff.oldCapacityUnits : diff.capacityUnits,
                };

                resourcesWithChange.push({
                  resource,
                  change: diff.change === 'unchanged' ? 'modified' : diff.change,
                  oldSku: diff.oldSku,
                  oldRegion: diff.oldRegion,
                  oldShardCount: diff.oldShardCount,
                  oldOsType: diff.oldOsType,
                  oldHighAvailability: diff.oldHighAvailability,
                  oldLicenseType: diff.oldLicenseType,
                  oldMessagingUnits: diff.oldMessagingUnits,
                  oldCapacityUnits: diff.oldCapacityUnits,
                });
              }
            } else {
              // Base compilation failed - treat all head resources as modified (fallback)
              log.warning(
                `Could not compile base version of ${compilation.filePath}, falling back to file-level change`
              );
              for (const resource of headExtraction.resources) {
                resourcesWithChange.push({ resource, change: 'modified' });
              }
            }
          } else {
            // No base content (file is new despite being marked as modified)
            log.debug(`No base content for ${compilation.filePath}, treating as added`);
            for (const resource of headExtraction.resources) {
              resourcesWithChange.push({ resource, change: 'added' });
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warning(`Failed to extract resources from ${compilation.filePath}: ${errorMessage}`);
        // Continue processing other files
      }
    }

    if (resourcesWithChange.length === 0) {
      log.info('No resources found in compiled templates. Nothing to analyze.');
      return;
    }

    log.info(`Total resources detected: ${resourcesWithChange.length}`);

    // Sanitize resources with change tracking (privacy layer)
    const { sanitizeResourcesWithChanges } = await import('./iac/sanitize');
    const sanitizationResult = sanitizeResourcesWithChanges(resourcesWithChange);
    log.info(
      `Sanitized ${sanitizationResult.resourceCount} resource(s) for analysis`
    );

    // Get action inputs
    const apiKey = core.getInput('api_key') || undefined;
    const commentMode = (core.getInput('comment_mode') || 'update') as 'update' | 'new';
    const envInput = core.getInput('env').trim();

    // If no api_key, try GitHub OIDC token for sandbox mode
    let authToken = apiKey;
    if (!authToken) {
      try {
        log.info('No api_key provided — requesting OIDC token for sandbox mode');
        authToken = await core.getIDToken('resourcepulse');
        log.info('OIDC token obtained — using sandbox path');
      } catch {
        log.info('Could not obtain OIDC token (id-token: write permission required for sandbox mode)');
      }
    }
    // If no region data and no auth — nothing meaningful to send, skip analysis
    if (!enableRegionResolution && !authToken) {
      log.info(
        'No param_file, main_region, or api_key provided. Skipping analysis — nothing to send.'
      );
      return;
    }

    // Build backend call context
    const { analyzeResources } = await import('./backend/client');

    const envHint = envInput;
    const envSource = envInput ? 'workflow input' : 'none';
    const runAttemptRaw = process.env.GITHUB_RUN_ATTEMPT;
    const runAttempt = runAttemptRaw ? Number.parseInt(runAttemptRaw, 10) : 1;
    const runAttemptValue = Number.isFinite(runAttempt) ? runAttempt : 1;

    const callContext: BackendCallContext = {
      repo: {
        owner: prContext.owner,
        name: prContext.repo,
        fullName: prContext.fullName,
      },
      pr: {
        number: prContext.prNumber,
        headSha: prContext.sha,
      },
      run: {
        runId: process.env.GITHUB_RUN_ID || '',
        attempt: runAttemptValue,
      },
      context: {
        iacEngine: 'bicep',
        envHint,
        envSource,
        paramFileUsed,
        paramFileSource: 'workflow input',
        resolvedRegions: Array.from(resolvedRegions),
      },
    };

    // Analyze resources (backend or local fallback)
    const analysisResult = await analyzeResources(sanitizationResult.resources, {
      apiKey: authToken,
      callContext,
    });

    log.info(`Analysis completed using ${analysisResult.source} source`);

    // Format as PR comment
    const { formatPRComment } = await import('./format/markdown');
    const resolvedRegionsList = Array.from(resolvedRegions);
    const unresolvedLocationsList = Array.from(unresolvedLocations);
    let regionSummary = '';
    if (!enableRegionResolution) {
      regionSummary = 'Regions: unknown (no param_file or main_region provided)';
    } else if (resolvedRegionsList.length > 0) {
      regionSummary = `Regions: ${resolvedRegionsList.join(', ')}`;
    } else if (unresolvedLocationsList.length > 0) {
      regionSummary = 'Regions: unknown (unresolved locations)';
    } else {
      regionSummary = 'Regions: unknown (no location fields detected)';
    }

    const regionLines = ['**Region resolution**', regionSummary];
    regionLines.push(`Param file: ${paramFileUsed ?? 'none'}`);
    if (!paramFileUsed && mainRegionInput) {
      regionLines.push(`Main region (fallback): ${mainRegionInput}`);
    }
    if (unresolvedLocationsList.length > 0) {
      regionLines.push(`Unresolved: ${unresolvedLocationsList.join(', ')}`);
    }

    const markdownWithRegions = `${regionLines.join('\n')}\n\n${analysisResult.markdown}`;
    const commentBody = formatPRComment({ ...analysisResult, markdown: markdownWithRegions });

    // Post or update PR comment
    const { createOrUpdateComment } = await import('./github/comments');
    await createOrUpdateComment(octokit, prContext, commentBody, commentMode);

    // Set action outputs
    core.setOutput('resources_detected', resourcesWithChange.length.toString());

    // Block merge if a blocking policy rule fired (Pro only)
    if (analysisResult.blocked === true) {
      core.setOutput('analysis_status', 'blocked');
      core.setFailed('ResourcePulse: merge blocked by policy violation. See PR comment for details.');
      return;
    }

    core.setOutput('analysis_status', 'success');
    log.info('Azure IaC Reviewer completed successfully');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

void run();
