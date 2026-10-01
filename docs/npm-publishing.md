# Publishing the Fortran fork to npm

Packages: `@kirill-tokmakov/claude-context-core` and
`@kirill-tokmakov/claude-context-mcp`, initially version `0.1.0`.
The original upstream MIT license and attribution are included in both packages.

## Build and verify

Use Node.js 22 and pnpm 10.11.0. Native dependencies need Python 3 and a C/C++ toolchain.

```sh
pnpm install --frozen-lockfile
pnpm build:core
pnpm build:mcp
pnpm --filter @kirill-tokmakov/claude-context-core test
pnpm --filter @kirill-tokmakov/claude-context-core test:fortran
pnpm --filter @kirill-tokmakov/claude-context-mcp test
mkdir -p artifacts
pnpm --filter @kirill-tokmakov/claude-context-core pack --pack-destination ./artifacts
pnpm --filter @kirill-tokmakov/claude-context-mcp pack --pack-destination ./artifacts
```

pnpm packing converts `workspace:*` to the core release version. Publish the core
archive first, then the MCP archive. Do not publish from the monorepo root.

## Publish

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish ./artifacts/kirill-tokmakov-claude-context-core-0.1.0.tgz --access public
npm publish ./artifacts/kirill-tokmakov-claude-context-mcp-0.1.0.tgz --access public
```

Confirm that `npm whoami` reports `kirill-tokmakov`. Complete any npm 2FA approval
in the npm login/publishing flow. Never commit credentials.

After both publishes succeed, configure the MCP client to run:

```sh
npx -y @kirill-tokmakov/claude-context-mcp@0.1.0
```

Keep your existing embedding and Milvus environment variables. npm installation
still compiles native addons; this release does not ship prebuilt Windows binaries.
The Fortran grammar is fetched from a pinned GitHub tarball.

The `Release` GitHub workflow is optional and requires a separately configured
`NPM_TOKEN` secret. It publishes only these two npm packages, not the VS Code extension.

## Release validation (2026-10-01)

- Node.js 22.23.3, Linux x64; pnpm 10.11.0.
- Core and MCP TypeScript builds passed.
- 29 core tests, 11 Fortran tests and 6 MCP tests passed.
- Both archives contain LICENSE and built output; MCP depends on the renamed core at `0.1.0`.
- Separate npm installation of both archives passed with native install scripts enabled.
- All 11 Fortran tests passed against that installed core.
- Installed MCP passed `--help`, stdio `initialize`, and `tools/list` (four tools).
- In the managed test environment, Node headers were supplied via `npm_config_nodedir`
  because its filesystem rejected node-gyp's tar ownership operation.
- Windows installation and live Milvus/embedding connections remain untested.

These checks validate the release archives; they do not mean npm publication has completed.
