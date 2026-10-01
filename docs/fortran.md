# Fortran AST support

This branch adds Fortran to the existing Claude Context indexing engine. Milvus,
embedding providers and the MCP tools keep their existing configuration.

## Installation from source

Use Node.js 22 and pnpm 10.11.0. The Fortran grammar is a native Node addon;
install Python 3 and a C/C++ build toolchain (on Windows: Visual Studio Build
Tools with Desktop development with C++). GitHub must be reachable during installation.

```sh
npm install --global pnpm@10.11.0
pnpm install --frozen-lockfile
pnpm --filter @kirill-tokmakov/claude-context-core rebuild tree-sitter-fortran
pnpm build:core
pnpm build:mcp
pnpm --filter @kirill-tokmakov/claude-context-core test:fortran
```

For VS Code / GitHub Copilot, keep the `env` object from your existing working
Claude Context configuration and replace only the launch command and arguments:

```json
{
  "servers": {
    "claude-context": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/tools/claude-context/packages/mcp/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "Ollama",
        "OLLAMA_HOST": "http://127.0.0.1:11434",
        "EMBEDDING_MODEL": "YOUR_EXISTING_EMBEDDING_MODEL",
        "MILVUS_ADDRESS": "127.0.0.1:19530"
      }
    }
  }
}
```

The example paths, embedding model and service addresses are placeholders.
Use your current Milvus address, credentials, embedding model and provider.
If using an OpenAI-compatible embedding endpoint such as LM Studio, keep your
existing OpenAI provider settings instead of switching to Ollama.
The original `@zilliz/claude-context-mcp` package does not contain this patch.
Run the server where it can access the source files.

After restarting the MCP server, invoke `index_codebase` with `splitter: "ast"`
and `force: true` on the intended codebase to replace existing text-based chunks.
Force indexing recreates that codebase's collection; it is not required for a
new codebase. Keep the same codebase path and embedding model/dimension unless
you intentionally want a new index.

## Supported input

- `.f`, `.for`, `.f77`, `.f90`, `.f95`, `.f03`, `.f08` and their uppercase forms
  are discovered by default, including during incremental synchronization.
- Modules, submodules, programs, subroutines, functions, module procedures,
  derived-type definitions and interfaces are AST splitting units.
- Uppercase extensions do not run a Fortran preprocessor: macros and includes
  are indexed as source, not expanded or compiled.
- The grammar is pinned to upstream `tree-sitter-fortran` v0.2.0, commit
  `15199bffbe29285d6196224887be86dd7da200fa` (MIT), from
  <https://github.com/stadelmanma/tree-sitter-fortran>. Its ABI 14 and Node peer
  dependency match the existing Tree-sitter 0.21 runtime. The lockfile records
  the tarball integrity. The package is not available under this name on npm.
- Parse errors (including unsupported fixed-form/compiler-specific syntax) fall
  back to text splitting for the whole file. Recognition of `.f` does not imply
  complete fixed-form Fortran support.
- Oversized procedures are still split by the existing chunk-size rules. AST
  splitting is not a compiler, type checker, call graph or semantic analyzer.
- Existing parent/child chunk overlap behavior is retained.

## Verification boundaries

The added tests use the real native parser and splitter. The indexing pipeline
tests use deterministic mock embeddings and a mock vector database: they verify
file discovery, AST chunk metadata, generated documents and incremental file
hashing, but do not prove connectivity to a particular Milvus or embedding server.

## Verified in this change

Base: `zilliztech/claude-context` commit
`6fc318b4e3ce58e2898b00a9c3538ead9e24dee5` (core/MCP package version 0.1.15).
Tests ran on Linux x64, Node.js 22.23.3:

| Check | Result |
| --- | --- |
| TypeScript core build | Passed |
| TypeScript MCP build | Passed |
| Native Fortran and existing-language regression tests | 11 passed |
| Existing core Jest suite | 29 passed |
| Existing MCP suite | 6 passed |
| MCP stdio initialize + tools/list | Passed; all four tools advertised |

The native tests exposed and cover two AST extraction edge cases: anonymous
keyword tokens must not become chunks, and an exclusive end position at column
zero must not include the following line in chunk metadata.

Not tested: a live Milvus/Qwen deployment, Windows native compilation, or your
own Fortran source tree. No npm package has been published.
