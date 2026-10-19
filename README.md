# splat-transform-test-suite
Simple cross platform test suite for @manycore/aholo-splat-transform

## Run locally

Use Node.js 24 and the pnpm version pinned in `package.json`. Place the test inputs
at `data/bear.sog` and `data/xiaozhen.ply`, then run:

```sh
pnpm install --frozen-lockfile
pnpm test
node -e "require('node:fs').mkdirSync('out/logs', { recursive: true })"
pnpm splat-transform lod:auto --ratio 0.3 ./data/bear.sog ./out/bear.spz > ./out/logs/bear-auto.log 2>&1
pnpm splat-transform lod:auto-chunk --type spz ./data/bear.sog ./out/bear > ./out/logs/bear-auto-chunk.log 2>&1
pnpm splat-transform lod:auto --ratio 0.3 ./data/xiaozhen.ply ./out/xiaozhen.spz > ./out/logs/xiaozhen-auto.log 2>&1
pnpm splat-transform lod:auto-chunk --type spz ./data/xiaozhen.ply ./out/xiaozhen > ./out/logs/xiaozhen-auto-chunk.log 2>&1
pnpm verify
```

Each conversion must exit successfully before verifying or updating baselines.
`pnpm test` exercises the verifier without requiring the input datasets or native
executable. CI runs these tests on every platform in its matrix.

## macOS Vulkan runtime

The 2.x native executable requires an external Vulkan loader and MoltenVK for
`splat-transform list:gpu` and GPU operations. Install and check the runtime on
Apple silicon macOS before running the suite:

```sh
brew install vulkan-loader molten-vk vulkan-tools
export VK_DRIVER_FILES="$(brew --prefix molten-vk)/etc/vulkan/icd.d/MoltenVK_icd.json"
vulkaninfo --summary
```

CI performs this setup in its macOS job and preserves `VK_DRIVER_FILES` for later
steps. The driver manifest uses Homebrew's `etc/vulkan/icd.d` location. The native
executable can locate the loader in Homebrew's default `/opt/homebrew/lib` directory.

## Baselines and tolerances

The baselines in `ci/baselines` were regenerated with
`@manycore/aholo-splat-transform@2.0.0-rc.0` on Windows x64 and checked against
Linux x64 output. The native C++ migration changes chunk partitioning and bounds:
`bear` has 4 blocks and 14 chunk files; `xiaozhen` has 35 blocks and 84 chunk files.
Each bundle also contains one `lod-meta.json` file.

Numeric comparisons use
`abs(actual - expected) <= max(absoluteTolerance, abs(expected) * relativeTolerance)`:

| Values | Absolute tolerance | Relative tolerance |
| --- | --- | --- |
| Generated point counts and nonzero LOD offsets | 1 point | 1% |
| `forwardBox` and `tree[].bound` min/max coordinates | `1e-6` | `1e-6` (0.0001%) |

Coordinate tolerance accommodates native floating-point differences across
platforms, including coordinates near zero. Boxes must still contain three finite
coordinates per side, with `min <= max` on each axis.

Metadata structure, input counts, SH degree, levels, file names and indices,
permanent-file selection, and zero offsets remain exact. Chunk ranges must be
contiguous; log counts must match metadata sums exactly. Rounded log percentages
must agree with their counts. Timings and directory prefixes are ignored.

After a dependency upgrade, run all four conversions above and review the output
changes. Replace these six baseline files from the successful run:

| Generated file (`<scene>` is `bear` or `xiaozhen`) | Baseline destination |
| --- | --- |
| `out/logs/<scene>-auto.log` | `ci/baselines/<scene>/auto.log` |
| `out/logs/<scene>-auto-chunk.log` | `ci/baselines/<scene>/auto-chunk.log` |
| `out/<scene>/lod-meta.json` | `ci/baselines/<scene>/lod-meta.json` |

Run `pnpm test` and `pnpm verify` after replacing the baselines. Recheck outputs
from other platforms against the same baselines before changing tolerances.
`SPLAT_TEST_OUT_DIR` and `SPLAT_TEST_BASELINE_DIR` can point the verifier at other
output or baseline directories; relative paths are resolved from the repository
root. The conversion commands above use `out` explicitly.
