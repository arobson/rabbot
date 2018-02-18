## Contributor Guide

This is intended to help you make a contribution to Rabbot that is likely to land. It includes basic instructions for getting the project running locally, ensuring CI will pass and reducing the chances that you will be asked to make changes by a maintainer or have the PR closed without comment for failing simple criteria.

A lot of the criteria here is to make it much easier for maintainers to accept or reject PRs without having to do additional work. It's also intended to save people time and effort in advance if they're not interested in meeting the criteria required to submit an acceptable PR.

### Setup

The current dev environment for Rabbot is:

 * Node 6 or 8
 * Docker (to run RabbitMQ in a container for integration tests)

It is recommended that you not use a RabbitMQ server running outside Docker as failing Rabbot integration tests may make a mess that you'll be stuck cleaning up :cry: It is much easier to just remove the Docker container and start over.

#### Included Docker Container

The repo includes a Dockerfile as well as npm commands to build, start and stop and remove the container:

 * `npm run build-image` - build Docker image (includes plugins needed for rabbot)
 * `npm run create-container` - creates a container named `rabbot` for tests
 * `npm run start-container` - starts the container if it was stopped
 * `npm run stop-container` - stops the container only
 * `npm run remove-container` - stops and removes the container entirely
 * `npm run bootstrap-container` - combines `build-container` & `create-container`

### A Note About Features or Big Refactors

There have been some occasions where a PR has conflicted with ongoing work, clashed with stated goals of the project or been a well-intended but undesired technology change.

The maintainers understand that a lot of work goes into making a PR to someone else's project and would like to avoid having to close a PR and leave folks who'd like to contribute feeling like their time and effort was not respected.

Please open an issue or send an email to a maintainer before undertaking large scale effort along these lines.

### Commit Style

Rabbot now uses [conventional commits](https://conventionalcommits.org/) so that going forward from 2.0.0, releases can be generated much more quickly (this includes automated generation of the CHANGELOG going forward).

PRs with commits that do not follow this style will be asked to fix their commit log. PRs that do not conform will eventually be closed out.

### Running Tests & Coverage

The expectation is for all PRs to include test coverage such that there is no drop in coverage. PRs that do not include changes to the spec folder are unlikely to be considered. A maintainer may ask you to add coverage. PRs that sit for long periods of time without tests are likely to be closed.

To see the coverage before submitting a PR, you can run `npm run coverage` to get a full coverage report.

#### New Features

New features without both behavior and integration tests will not be accepted. The expectation is that features have tests that demonstrate your addition will behave according to design during success and failure modes.

#### Bug Fixes

The expectation is that if you are changing a behavior that you include a test to demonstrate the correction addresses the behavior you are changing.

This is very important as Rabbot has changed drastically over the years and without good tests in place, regressions are likely to creep in. Please help ensure that your fixes stay fixed :smile:

### Style & Linting

Running `npm test`, `npm run lint` and `npm run lint-fix` are all ways to check/correct style/linting problems. The CI system also runs these and will fail a PR that violates the rule.

PRs that break or change style rules will be ignored and after a time, if not repaired, they will be rejected.

Rabbot now uses semistandard (standard + semicolons). This is less about it being a perfect format vs it being a low maintenance way to have tooling and automation around ensuring a *consistent* style stay in place across all PRs.
