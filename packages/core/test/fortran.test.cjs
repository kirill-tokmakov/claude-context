// Native Tree-sitter bindings must run outside Jest's per-suite VM contexts.
// Test the built package in Node's own test runner.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Parser = require('tree-sitter');
const { AstCodeSplitter } = require('../dist/splitter/ast-splitter');
const { LangChainCodeSplitter } = require('../dist/splitter/langchain-splitter');
const { Context } = require('../dist/context');
const { Embedding } = require('../dist/embedding');
const { FileSynchronizer } = require('../dist/sync/synchronizer');

const Fortran = require('tree-sitter-fortran');
const source = `module physics
  implicit none
  type :: particle
    real :: mass
  end type particle
  interface
    module subroutine advance(x)
      real, intent(inout) :: x
    end subroutine advance
  end interface
contains
  real function energy(m, v) result(e)
    real, intent(in) :: m, v
    e = 0.5 * m * v**2
  end function energy
end module physics

submodule (physics) implementation
contains
  module procedure advance
    x = x + 1.0
  end procedure advance
end submodule implementation

program demo
  use physics
  implicit none
  print *, energy(2.0, 3.0)
end program demo
`;

describe('Fortran AST splitting', () => {

    it('loads a grammar compatible with the existing tree-sitter runtime', () => {
        const parser = new Parser();
        parser.setLanguage(Fortran);
        assert.equal(parser.parse(source).rootNode.hasError, false);
    });

    for (const language of ['fortran', 'Fortran', 'f90', 'F90']) it(`extracts logical units for ${language} without fallback`, async t => {
        const fallback = t.mock.method(LangChainCodeSplitter.prototype, 'split');
        const splitter = new AstCodeSplitter(10000);
        splitter.setChunkOverlap(0);
        const chunks = await splitter.split(source, language, 'physics.F90');
        assert.equal(fallback.mock.callCount(), 0);
        assert.equal(AstCodeSplitter.isLanguageSupported(language), true);
        for (const start of ['module physics', 'type :: particle', 'interface',
            'module subroutine advance', 'real function energy',
            'submodule (physics)', 'module procedure advance', 'program demo']) {
            assert.ok(chunks.some(chunk => chunk.content.startsWith(start)), start);
        }
        for (const chunk of chunks) {
            assert.equal(chunk.metadata.language, language);
            assert.equal(chunk.metadata.filePath, 'physics.F90');
            assert.equal(source.split('\n').slice(chunk.metadata.startLine - 1, chunk.metadata.endLine)
                .join('\n').trim(), chunk.content.trim());
        }
    });

    it('preserves unsupported or malformed syntax through text fallback', async t => {
        const fallback = t.mock.method(LangChainCodeSplitter.prototype, 'split');
        const malformed = 'subroutine valid()\nend subroutine valid\n@@KEEP_THIS_UNKNOWN_SYNTAX@@';
        const chunks = await new AstCodeSplitter(10000).split(malformed, 'fortran', 'legacy.f');
        assert.ok(fallback.mock.callCount() > 0);
        assert.ok(chunks.map(chunk => chunk.content).join('\n').includes('@@KEEP_THIS_UNKNOWN_SYNTAX@@'));
    });

    it('splits oversized procedures without losing their statements', async t => {
        const lines = Array.from({ length: 80 }, (_, i) => `  x = x + ${i}.0`);
        const code = ['subroutine large(x)', '  real :: x', ...lines, 'end subroutine large'].join('\n');
        const fallback = t.mock.method(LangChainCodeSplitter.prototype, 'split');
        const splitter = new AstCodeSplitter(200);
        splitter.setChunkOverlap(0);
        const chunks = await splitter.split(code, 'fortran', 'large.f90');
        assert.equal(fallback.mock.callCount(), 0);
        assert.ok(chunks.length > 1);
        for (const line of code.split('\n')) {
            assert.ok(chunks.some(chunk => chunk.content.includes(line.trim())));
        }
    });

    for (const [language, code] of [
        ['cpp', 'int square(int x) { return x * x; }'],
        ['java', 'class Demo { int square(int x) { return x * x; } }'],
        ['python', 'def square(x):\n    return x * x'],
    ]) it(`keeps the ${language} AST parser working`, async t => {
        const fallback = t.mock.method(LangChainCodeSplitter.prototype, 'split');
        const chunks = await new AstCodeSplitter().split(code, language);
        assert.equal(fallback.mock.callCount(), 0);
        assert.ok(chunks.length > 0);
    });
});

class TestEmbedding extends Embedding {
    async detectDimension() { return 3; }
    async embed() { return { vector: [1, 0, 0], dimension: 3 }; }
    async embedBatch(texts) { return Promise.all(texts.map(() => this.embed())); }
    getDimension() { return 3; }
    getProvider() { return 'test'; }
}

it('indexes all Fortran extensions through the real AST pipeline and tracks edits', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-fortran-'));
    const code = 'subroutine update(x)\n  real :: x\n  x = x + 1.0\nend subroutine update\n';
    const extensions = ['.f', '.for', '.f77', '.f90', '.f95', '.f03', '.f08'];
    const names = extensions.flatMap(ext => ['code' + ext, 'code' + ext.toUpperCase()]);
    const documents = [];
    const database = {
        hasCollection: async () => false,
        createCollection: async () => {},
        createHybridCollection: async () => {},
        insert: async (_, docs) => documents.push(...docs),
        insertHybrid: async (_, docs) => documents.push(...docs),
    };
    const context = new Context({ embedding: new TestEmbedding(), vectorDatabase: database });
    const splitter = new AstCodeSplitter(10000);
    splitter.setChunkOverlap(0);
    const fallback = t.mock.method(LangChainCodeSplitter.prototype, 'split');
    try {
        for (const name of names) await fs.writeFile(path.join(root, name), code);
        const stats = await context.indexCodebase(root, undefined, false, [], [], splitter);
        assert.deepEqual(stats, { indexedFiles: 14, totalChunks: 14, status: 'completed' });
        assert.equal(fallback.mock.callCount(), 0);
        assert.equal(documents.length, 14);
        assert.deepEqual(documents.map(doc => doc.relativePath).sort(), [...names].sort());
        for (const doc of documents) {
            assert.ok(doc.content.includes('subroutine update(x)'));
            assert.equal(doc.metadata.language, 'fortran');
            assert.deepEqual(doc.vector, [1, 0, 0]);
        }
        const sync = new FileSynchronizer(root, [], context.getSupportedExtensions());
        // Exercise sync's real hashing path without persisting user-home snapshots.
        const hashes = await sync.generateFileHashes(root);
        assert.deepEqual([...hashes.keys()].sort(), [...names].sort());
        await fs.appendFile(path.join(root, 'code.F90'), '! changed\n');
        const changed = await sync.generateFileHashes(root);
        assert.notEqual(changed.get('code.F90'), hashes.get('code.F90'));
        assert.equal(changed.get('code.f90'), hashes.get('code.f90'));
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
